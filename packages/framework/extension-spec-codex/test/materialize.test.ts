import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionSpec } from "@gonk/extension-spec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  materializeCodexPlugin,
  readMaterializationManifest,
  unmaterializeCodexPlugin,
} from "../src/index.ts";

const noop = () => {};

function buildFixtureSpec(): ExtensionSpec {
  return {
    id: "memory",
    description: "Persistent memory: recall, store, list.",
    category: "substrate",
    defaultEnabled: true,
    command: {
      name: "memory",
      description: "Persistent memory across scope tiers.",
      subcommands: {
        recall: {
          description: "Semantic search across the scope chain.",
          positional: [{ name: "query", required: true }],
          handler: noop,
        },
        store: {
          description: "Store a curated entry.",
          positional: [{ name: "text", required: true }],
          handler: noop,
        },
        "experimental-summarize": {
          description: "Experimental: summarize a closed session.",
          handler: noop,
          requires: () => false,
        },
      },
    },
  };
}

function buildHookFixtureSpec(): ExtensionSpec {
  return {
    id: "persona",
    description: "Persona lifecycle fixture.",
    hooks: {
      session_start: noop,
      before_provider_request: noop,
      turn_complete: noop,
      unknown_event: noop,
    },
  };
}

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "codex-materialize-"));
});

afterEach(() => {
  if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

describe("materializeCodexPlugin", () => {
  it("writes plugin.json with Codex pointers and interface metadata", () => {
    const spec = buildFixtureSpec();
    const manifest = materializeCodexPlugin({
      spec,
      outDir,
      packageName: "@gonk/codex-memory",
      version: "1.2.3",
      interface: {
        displayName: "gonk Memory for Codex",
        capabilities: ["Interactive", "Write"],
      },
      mcpServerEntry: { command: "node", args: ["./dist/mcp-server.js"], cwd: "." },
    });

    expect(manifest.pluginRoot).toBe(outDir);
    expect(manifest.specId).toBe("memory");
    expect(manifest.packageName).toBe("@gonk/codex-memory");

    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".codex-plugin", "plugin.json"), "utf8"),
    );
    expect(pluginJson.name).toBe("codex-memory");
    expect(pluginJson.version).toBe("1.2.3");
    expect(pluginJson.skills).toBe("./skills/");
    expect(pluginJson.mcpServers).toBe("./.mcp.json");
    expect(pluginJson.interface.displayName).toBe("gonk Memory for Codex");
    expect(pluginJson.interface.capabilities).toEqual(["Interactive", "Write"]);
  });

  it("emits .mcp.json keyed with the gonk-prefixed Codex server identity by default", () => {
    materializeCodexPlugin({
      spec: buildFixtureSpec(),
      outDir,
      mcpServerEntry: { command: "node", args: ["./dist/mcp-server.js"], cwd: "." },
    });

    const parsed = JSON.parse(readFileSync(join(outDir, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, { command: string; args?: string[]; cwd?: string }>;
    };
    expect(Object.keys(parsed.mcpServers)).toEqual(["gonk-memory"]);
    expect(parsed.mcpServers["gonk-memory"]).toEqual({
      command: "node",
      args: ["./dist/mcp-server.js"],
      cwd: ".",
    });
  });

  it("writes a default Codex skill and filters gated verbs from its body", () => {
    materializeCodexPlugin({ spec: buildFixtureSpec(), outDir });

    const files = readdirSync(join(outDir, "skills")).sort();
    expect(files).toEqual(["gonk-memory"]);
    const skill = readFileSync(join(outDir, "skills", "gonk-memory", "SKILL.md"), "utf8");
    expect(skill).toMatch(/^---\n/);
    expect(skill).toContain("name: gonk-memory");
    expect(skill).toContain("description: Persistent memory across scope tiers.");
    expect(skill).toContain("- recall: Semantic search across the scope chain.");
    expect(skill).toContain("- store: Store a curated entry.");
    expect(skill).not.toContain("experimental-summarize");
  });

  it("supports explicit skills and quotes frontmatter values that need YAML quoting", () => {
    materializeCodexPlugin({
      spec: { id: "knowledge", description: "Knowledge tools." },
      outDir,
      skills: [
        {
          name: "gonk-knowledge",
          description: "Use knowledge: query, fetch, write.",
          body: "# gonk Knowledge\n\nUse it.",
        },
      ],
    });

    const skill = readFileSync(join(outDir, "skills", "gonk-knowledge", "SKILL.md"), "utf8");
    expect(skill).toContain('description: "Use knowledge: query, fetch, write."');
  });

  it("materializes cache-safe Codex hook mappings and manifest wiring", () => {
    mkdirSync(join(outDir, "dist"), { recursive: true });
    writeFileSync(join(outDir, "dist", "hook-spec.cjs"), "module.exports = {};\n");
    const manifest = materializeCodexPlugin({
      spec: buildHookFixtureSpec(),
      outDir,
    });

    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".codex-plugin", "plugin.json"), "utf8"),
    );
    expect(pluginJson.hooks).toBe("./hooks/hooks.json");

    const hooks = JSON.parse(readFileSync(join(outDir, "hooks", "hooks.json"), "utf8"));
    expect(hooks).toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: "startup|resume|clear|compact",
            hooks: [
              {
                type: "command",
                command: 'node "$PLUGIN_ROOT/hooks/gonk-codex-hook.mjs" persona session_start',
                timeout: 5,
              },
            ],
          },
        ],
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "$PLUGIN_ROOT/hooks/gonk-codex-hook.mjs" persona turn_complete',
                timeout: 5,
              },
            ],
          },
        ],
        UserPromptSubmit: [
          {
            hooks: [
              {
                type: "command",
                command: 'node "$PLUGIN_ROOT/hooks/gonk-codex-hook.mjs" persona before_provider_request',
                timeout: 5,
              },
            ],
          },
        ],
      },
    });
    expect(manifest.written).toContain("hooks/hooks.json");
    expect(manifest.written).toContain("hooks/gonk-codex-hook.mjs");
    expect(JSON.stringify(hooks)).not.toContain("unknown_event");
  });

  it("refuses to write outside the plugin root when a skill name traverses", () => {
    const escapeTarget = join(tmpdir(), "codex-skill-escape", "SKILL.md");
    if (existsSync(escapeTarget)) rmSync(escapeTarget, { force: true });

    expect(() =>
      materializeCodexPlugin({
        spec: { id: "bad", description: "Bad." },
        outDir,
        skills: [{ name: "../../../../tmp/codex-skill-escape", description: "bad", body: "bad" }],
      }),
    ).toThrow(/escapes root/);
    expect(existsSync(escapeTarget)).toBe(false);
  });

  it("emits a self-describing materialization manifest and is idempotent", () => {
    const spec = buildFixtureSpec();
    const first = materializeCodexPlugin({ spec, outDir });
    const before = readFileSync(join(outDir, "skills", "gonk-memory", "SKILL.md"), "utf8");

    const second = materializeCodexPlugin({ spec, outDir });
    const after = readFileSync(join(outDir, "skills", "gonk-memory", "SKILL.md"), "utf8");

    expect(second.written).toEqual(first.written);
    expect(after).toEqual(before);

    const sidecar = readMaterializationManifest(outDir);
    expect(sidecar).toEqual(second);
    expect(sidecar!.written).toContain(".codex-plugin/plugin.json");
    expect(sidecar!.written).toContain("skills/gonk-memory/SKILL.md");
    expect(sidecar!.written).toContain(".gonk-materialize.json");
  });

  it("sweeps obsolete skills and stale .mcp.json across materialization runs", () => {
    const spec = buildFixtureSpec();
    materializeCodexPlugin({
      spec,
      outDir,
      mcpServerEntry: { command: "node", args: ["./dist/mcp-server.js"], cwd: "." },
    });
    expect(existsSync(join(outDir, ".mcp.json"))).toBe(true);
    expect(existsSync(join(outDir, "skills", "gonk-memory", "SKILL.md"))).toBe(true);

    materializeCodexPlugin({
      spec: { id: "headless", description: "No skills or MCP." },
      outDir,
    });

    expect(existsSync(join(outDir, ".mcp.json"))).toBe(false);
    expect(existsSync(join(outDir, "skills", "gonk-memory", "SKILL.md"))).toBe(false);
    expect(existsSync(join(outDir, ".codex-plugin", "plugin.json"))).toBe(true);
  });

  it("sweeps obsolete generated hooks", () => {
    mkdirSync(join(outDir, "dist"), { recursive: true });
    writeFileSync(join(outDir, "dist", "hook-spec.cjs"), "module.exports = {};\n");
    materializeCodexPlugin({ spec: buildHookFixtureSpec(), outDir });
    expect(existsSync(join(outDir, "hooks", "hooks.json"))).toBe(true);

    materializeCodexPlugin({ spec: { id: "headless", description: "No hooks." }, outDir });
    expect(existsSync(join(outDir, "hooks", "hooks.json"))).toBe(false);
    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".codex-plugin", "plugin.json"), "utf8"),
    );
    expect(pluginJson.hooks).toBeUndefined();
  });

  it("refuses to activate hooks without the consumer's bundled hook spec", () => {
    expect(() => materializeCodexPlugin({ spec: buildHookFixtureSpec(), outDir })).toThrow(
      /dist\/hook-spec\.cjs to exist/,
    );
    expect(existsSync(join(outDir, "hooks", "hooks.json"))).toBe(false);
  });

  it("rejects spec ids that could alter the generated shell command", () => {
    expect(() =>
      materializeCodexPlugin({ spec: { id: "bad;echo-pwned", description: "bad" }, outDir }),
    ).toThrow(/Invalid ExtensionSpec id/);
  });

  it("rejects hook dispatch overrides that are not plugin-root anchored", () => {
    mkdirSync(join(outDir, "dist"), { recursive: true });
    writeFileSync(join(outDir, "dist", "hook-spec.cjs"), "module.exports = {};\n");
    expect(() =>
      materializeCodexPlugin({
        spec: buildHookFixtureSpec(),
        outDir,
        hookDispatchBinary: "gonk-codex-hook",
      }),
    ).toThrow(/anchored through \$PLUGIN_ROOT/);
  });
});

describe("unmaterializeCodexPlugin", () => {
  it("removes materialized files while leaving unrelated files alone", () => {
    materializeCodexPlugin({ spec: buildFixtureSpec(), outDir });

    const foreign = join(outDir, "foreign.txt");
    writeFileSync(foreign, "keep");

    const { removed } = unmaterializeCodexPlugin({ outDir });
    expect(removed).toContain(".codex-plugin/plugin.json");
    expect(removed).toContain("skills/gonk-memory/SKILL.md");
    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(join(outDir, ".codex-plugin", "plugin.json"))).toBe(false);
  });
});
