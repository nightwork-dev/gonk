import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionSpec } from "@gonk/extension-spec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  materializeClaudePlugin,
  readMaterializationManifest,
  unmaterializeClaudePlugin,
} from "../src/index.ts";

// =============================================================================
// Synthetic fixture — realistic shape an actual gonk substrate would produce.
// Mirrors `pi-memory`'s buildMemorySpec output but with no live tools or
// handlers (handlers are required by the type but PR 1 doesn't execute them).
// =============================================================================

const noop = () => {};
const noopHook = () => {};

function buildFixtureSpec(): ExtensionSpec {
  return {
    id: "claude-memory",
    description:
      "Persistent memory: /memory (TUI), /memory recall <query>, /memory store <text>, /memory list.",
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
        list: {
          description: "List curated entries at a tier.",
          handler: noop,
        },
        // A `requires:false` subcommand to verify gating works.
        "experimental-summarize": {
          description: "Experimental: summarize a closed session.",
          handler: noop,
          requires: () => false,
        },
      },
    },
    hooks: {
      session_start: noopHook,
      turn_complete: noopHook,
      session_end: noopHook,
      // An unknown spec event — default placement should drop it.
      mystery_event: noopHook,
    },
  };
}

// =============================================================================
// Setup / teardown
// =============================================================================

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "claude-materialize-"));
});

afterEach(() => {
  if (outDir && existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
});

// =============================================================================
// Tests
// =============================================================================

describe("materializeClaudePlugin", () => {
  it("writes plugin.json with the spec id, version, description, and component pointers", () => {
    const spec = buildFixtureSpec();
    const manifest = materializeClaudePlugin({
      spec,
      outDir,
      packageName: "@gonk/claude-memory",
      version: "1.2.3",
    });

    expect(manifest.pluginRoot).toBe(outDir);
    expect(manifest.specId).toBe("claude-memory");
    expect(manifest.packageName).toBe("@gonk/claude-memory");

    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".claude-plugin", "plugin.json"), "utf8"),
    );
    // NB: plugin.json does NOT reference hooks. Claude Code auto-loads the
    // standard hooks/hooks.json; referencing it here is a duplicate that makes
    // the whole hook load fail. The file is still written (asserted elsewhere).
    expect(pluginJson).toEqual({
      name: "@gonk/claude-memory",
      version: "1.2.3",
      description: spec.description,
      commands: "./commands/",
    });
  });

  it("writes one bare command file and one file per non-gated verb, alphabetized", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({ spec, outDir });

    const commandDir = join(outDir, "commands");
    const files = readdirSync(commandDir).sort();
    // Bare + recall + store + list — experimental-summarize is dropped via requires().
    expect(files).toEqual([
      "memory-list.md",
      "memory-recall.md",
      "memory-store.md",
      "memory.md",
    ]);

    const recall = readFileSync(join(commandDir, "memory-recall.md"), "utf8");
    expect(recall).toMatch(/^---\n/);
    expect(recall).toContain(`argument-hint: <query>`);
    expect(recall).toContain("$ARGUMENTS");
    expect(recall).toContain("# /memory recall");
  });

  it("writes the bare command file with a verb listing that excludes gated verbs", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({ spec, outDir });

    const bare = readFileSync(join(outDir, "commands", "memory.md"), "utf8");
    expect(bare).toContain("/memory recall");
    expect(bare).toContain("/memory store");
    expect(bare).toContain("/memory list");
    expect(bare).not.toContain("experimental-summarize");
  });

  it("maps session_start/turn_complete/session_end to SessionStart/Stop/SessionEnd and drops unknown events", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({ spec, outDir });

    const hooks = JSON.parse(readFileSync(join(outDir, "hooks", "hooks.json"), "utf8"));
    expect(Object.keys(hooks.hooks).sort()).toEqual(["SessionEnd", "SessionStart", "Stop"]);

    // SessionStart was produced by spec.hooks.session_start.
    const sessionStartCommands = hooks.hooks.SessionStart;
    expect(sessionStartCommands).toHaveLength(1);
    expect(sessionStartCommands[0].matcher).toBe("*");
    expect(sessionStartCommands[0].hooks[0]).toEqual({
      type: "command",
      command: "gonk-claude-hook claude-memory session_start",
      timeout: 5,
    });
  });

  it("uses a custom hookDispatchBinary when provided", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({
      spec,
      outDir,
      hookDispatchBinary: "/usr/local/bin/gonk",
    });

    const hooks = JSON.parse(readFileSync(join(outDir, "hooks", "hooks.json"), "utf8"));
    expect(hooks.hooks.SessionStart[0].hooks[0].command).toBe(
      "/usr/local/bin/gonk claude-memory session_start",
    );
  });

  it("emits a self-describing materialization manifest that lists every file written", () => {
    const spec = buildFixtureSpec();
    const result = materializeClaudePlugin({ spec, outDir });

    const sidecar = readMaterializationManifest(outDir);
    expect(sidecar).not.toBeNull();
    expect(sidecar!.specId).toBe("claude-memory");
    expect(sidecar!.written).toContain(".claude-plugin/plugin.json");
    expect(sidecar!.written).toContain("commands/memory.md");
    expect(sidecar!.written).toContain("commands/memory-recall.md");
    expect(sidecar!.written).toContain("hooks/hooks.json");
    expect(sidecar!.written).toContain(".gonk-materialize.json");
    // Returned manifest matches the sidecar on disk.
    expect(sidecar).toEqual(result);
  });

  it("is idempotent: a second materialize produces the same files and contents", () => {
    const spec = buildFixtureSpec();
    const first = materializeClaudePlugin({ spec, outDir });
    const beforeRecall = readFileSync(join(outDir, "commands", "memory-recall.md"), "utf8");

    const second = materializeClaudePlugin({ spec, outDir });
    const afterRecall = readFileSync(join(outDir, "commands", "memory-recall.md"), "utf8");

    expect(second.written).toEqual(first.written);
    expect(afterRecall).toEqual(beforeRecall);
  });

  it("sweeps obsolete files when the spec changes between materializations", () => {
    const v1 = buildFixtureSpec();
    materializeClaudePlugin({ spec: v1, outDir });
    expect(existsSync(join(outDir, "commands", "memory-store.md"))).toBe(true);

    // v2: drops the `store` verb entirely.
    const v2: ExtensionSpec = {
      ...v1,
      command: {
        ...v1.command!,
        subcommands: {
          recall: v1.command!.subcommands!.recall!,
        },
      },
    };
    materializeClaudePlugin({ spec: v2, outDir });
    expect(existsSync(join(outDir, "commands", "memory-store.md"))).toBe(false);
    expect(existsSync(join(outDir, "commands", "memory-recall.md"))).toBe(true);
  });

  it("omits hooks/hooks.json and the manifest hooks pointer when no hooks map", () => {
    const spec: ExtensionSpec = {
      id: "noop",
      description: "No hooks here.",
      command: {
        name: "noop",
        description: "noop",
        subcommands: { ping: { description: "ping", handler: noop } },
      },
    };
    materializeClaudePlugin({ spec, outDir });

    expect(existsSync(join(outDir, "hooks", "hooks.json"))).toBe(false);
    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(pluginJson.hooks).toBeUndefined();
    expect(pluginJson.commands).toBe("./commands/");
  });

  it("omits commands directory when the spec has no slash command", () => {
    const spec: ExtensionSpec = {
      id: "headless",
      description: "Tools-only extension, no slash command.",
      hooks: { session_start: noopHook },
    };
    materializeClaudePlugin({ spec, outDir });

    expect(existsSync(join(outDir, "commands"))).toBe(false);
    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".claude-plugin", "plugin.json"), "utf8"),
    );
    expect(pluginJson.commands).toBeUndefined();
    // hooks/hooks.json IS written (Claude Code auto-loads it)...
    expect(existsSync(join(outDir, "hooks", "hooks.json"))).toBe(true);
    // ...but plugin.json must NOT reference it (referencing the auto-loaded
    // standard file is a duplicate that makes the hook load fail entirely).
    expect(pluginJson.hooks).toBeUndefined();
  });

  it("respects a custom command placement policy", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({
      spec,
      outDir,
      commandPlacement: ({ verb }) => {
        if (verb === null) return "drop";
        return { filename: `custom-${verb}.md`, body: `body for ${verb}` };
      },
    });
    const files = readdirSync(join(outDir, "commands")).sort();
    expect(files).toEqual(["custom-list.md", "custom-recall.md", "custom-store.md"]);
    expect(readFileSync(join(outDir, "commands", "custom-recall.md"), "utf8")).toContain(
      "body for recall",
    );
  });
});

describe("mcpServerEntry", () => {
  it("emits .mcp.json keyed by spec.id when mcpServerEntry is set", () => {
    const spec = buildFixtureSpec();
    const manifest = materializeClaudePlugin({
      spec,
      outDir,
      mcpServerEntry: {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"],
        env: { GONK_LOG_LEVEL: "info" },
      },
    });

    const mcpPath = join(outDir, ".mcp.json");
    expect(existsSync(mcpPath)).toBe(true);
    expect(manifest.written).toContain(".mcp.json");

    const parsed = JSON.parse(readFileSync(mcpPath, "utf8")) as {
      mcpServers: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
    };
    expect(Object.keys(parsed.mcpServers)).toEqual([spec.id]);
    const entry = parsed.mcpServers[spec.id]!;
    expect(entry.command).toBe("node");
    expect(entry.args).toEqual(["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"]);
    expect(entry.env).toEqual({ GONK_LOG_LEVEL: "info" });
  });

  it("sets plugin.json's mcpServers field to ./.mcp.json when mcpServerEntry is set", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({
      spec,
      outDir,
      mcpServerEntry: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"] },
    });

    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { mcpServers?: string };
    expect(pluginJson.mcpServers).toBe("./.mcp.json");
  });

  it("does not emit .mcp.json or set plugin.json mcpServers when mcpServerEntry is absent", () => {
    const spec = buildFixtureSpec();
    const manifest = materializeClaudePlugin({ spec, outDir });

    expect(existsSync(join(outDir, ".mcp.json"))).toBe(false);
    expect(manifest.written).not.toContain(".mcp.json");

    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { mcpServers?: string };
    expect(pluginJson.mcpServers).toBeUndefined();
  });

  it("omits args/env from .mcp.json when not provided", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({
      spec,
      outDir,
      mcpServerEntry: { command: "/usr/local/bin/gonk-claude-server" },
    });

    const parsed = JSON.parse(readFileSync(join(outDir, ".mcp.json"), "utf8")) as {
      mcpServers: Record<string, Record<string, unknown>>;
    };
    const entry = parsed.mcpServers[spec.id]!;
    expect(entry.command).toBe("/usr/local/bin/gonk-claude-server");
    expect(entry.args).toBeUndefined();
    expect(entry.env).toBeUndefined();
  });

  it("sweeps a stale .mcp.json when a later run drops mcpServerEntry", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({
      spec,
      outDir,
      mcpServerEntry: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"] },
    });
    expect(existsSync(join(outDir, ".mcp.json"))).toBe(true);

    // Re-materialize without mcpServerEntry — the sidecar manifest should
    // remember the prior .mcp.json and sweep it.
    materializeClaudePlugin({ spec, outDir });
    expect(existsSync(join(outDir, ".mcp.json"))).toBe(false);

    const pluginJson = JSON.parse(
      readFileSync(join(outDir, ".claude-plugin", "plugin.json"), "utf8"),
    ) as { mcpServers?: string };
    expect(pluginJson.mcpServers).toBeUndefined();
  });
});

describe("unmaterializeClaudePlugin", () => {
  it("removes every file that materialize wrote, leaving unrelated files alone", () => {
    const spec = buildFixtureSpec();
    materializeClaudePlugin({ spec, outDir });

    // Plant a file we don't own.
    const foreign = join(outDir, "foreign.txt");
    writeFileSync(foreign, "leave me be");

    const { removed } = unmaterializeClaudePlugin({ outDir });
    expect(removed).toContain(".claude-plugin/plugin.json");
    expect(removed).toContain("commands/memory.md");
    expect(removed).toContain("hooks/hooks.json");

    expect(existsSync(foreign)).toBe(true);
    expect(existsSync(join(outDir, ".claude-plugin", "plugin.json"))).toBe(false);
    expect(existsSync(join(outDir, "commands"))).toBe(false);
  });
});
