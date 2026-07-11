import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { ExtensionSpec } from "@gonk/extension-spec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_BOUNDARY_CONTEXT_CHARS,
  type CodexBoundaryHookContext,
  type CodexSideEffectHookContext,
  runCodexHook,
  materializeCodexPlugin,
} from "../src/index.ts";

let pluginRoot: string;

beforeEach(() => {
  pluginRoot = mkdtempSync(join(tmpdir(), "codex-hook-runtime-"));
});

afterEach(() => {
  if (pluginRoot && existsSync(pluginRoot)) rmSync(pluginRoot, { recursive: true, force: true });
});

describe("runCodexHook", () => {
  it("emits deterministic context at startup and post-compaction boundaries", async () => {
    const spec: ExtensionSpec = {
      id: "persona",
      description: "fixture",
      hooks: {
        session_start: (_event, unknownCtx) => {
          const ctx = unknownCtx as CodexBoundaryHookContext;
          ctx.injectContext(`persona-floor:${ctx.source}`);
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "session_start",
        payload: { hook_event_name: "SessionStart", source: "startup" },
      }),
    ).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "persona-floor:startup",
      },
    });
    await expect(
      runCodexHook(spec, {
        specEvent: "session_start",
        payload: { hook_event_name: "SessionStart", source: "compact" },
      }),
    ).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "persona-floor:compact",
      },
    });
  });

  it("gives non-boundary handlers no injection surface and emits no context", async () => {
    let observed: CodexSideEffectHookContext | undefined;
    const spec: ExtensionSpec = {
      id: "memory",
      description: "fixture",
      hooks: {
        before_provider_request: (_event, ctx) => {
          observed = ctx as CodexSideEffectHookContext;
        },
      },
    };

    await expect(
      runCodexHook(spec, { specEvent: "before_provider_request", payload: { prompt: "hello" } }),
    ).resolves.toEqual({});
    expect(observed?.kind).toBe("side-effect");
    expect("injectContext" in (observed ?? {})).toBe(false);
  });

  it("does not trust a context-bearing spec event on a non-boundary host event", async () => {
    let hadInjectionSurface = true;
    const spec: ExtensionSpec = {
      id: "persona",
      description: "fixture",
      hooks: {
        session_start: (_event, ctx) => {
          hadInjectionSurface = "injectContext" in (ctx as object);
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "session_start",
        payload: { hook_event_name: "UserPromptSubmit", source: "startup" },
      }),
    ).resolves.toEqual({});
    expect(hadInjectionSurface).toBe(false);
  });

  it("rejects an unbounded boundary floor instead of mutating the prompt", async () => {
    const spec: ExtensionSpec = {
      id: "persona",
      description: "fixture",
      hooks: {
        session_start: (_event, unknownCtx) => {
          const ctx = unknownCtx as CodexBoundaryHookContext;
          ctx.injectContext("x".repeat(MAX_BOUNDARY_CONTEXT_CHARS + 1));
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "session_start",
        payload: { hook_event_name: "SessionStart", source: "startup" },
      }),
    ).rejects.toThrow(/exceeds 16384 characters/);
  });

  it("suppresses direct handler stdout in the exported runtime", async () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      const spec: ExtensionSpec = {
        id: "persona",
        description: "fixture",
        hooks: {
          session_start: (_event, unknownCtx) => {
            console.log("boundary-noise");
            process.stdout.write("boundary-raw-noise");
            (unknownCtx as CodexBoundaryHookContext).injectContext("fixed-floor");
          },
          before_provider_request: () => {
            console.log("turn-noise");
            process.stdout.write("turn-raw-noise");
          },
        },
      };
      await runCodexHook(spec, {
        specEvent: "session_start",
        payload: { hook_event_name: "SessionStart", source: "startup" },
      });
      await runCodexHook(spec, {
        specEvent: "before_provider_request",
        payload: { hook_event_name: "UserPromptSubmit", prompt: "hello" },
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(writes).toEqual([]);
  });
});

describe("gonk-codex-hook executable", () => {
  it("loads the generated plugin fixture and clamps turn-hook stdout to empty JSON", () => {
    const distDir = join(pluginRoot, "dist");
    const marker = join(pluginRoot, "turn-fired.txt");
    // The host contract loads dist/hook-spec.cjs from PLUGIN_ROOT.
    mkdirSync(distDir, { recursive: true });
    writeFileSync(
      join(distDir, "hook-spec.cjs"),
      [
        "const fs = require('node:fs');",
        "console.log('toplevel-noise');",
        "process.stdout.write('TOPLEVEL-INJECTED');",
        "module.exports = { default: () => {",
        "  console.log('factory-noise');",
        "  process.stdout.write('FACTORY-INJECTED');",
        "  return {",
        "  id: 'fixture', description: 'fixture', hooks: {",
        "    session_start: (_event, ctx) => {",
        "      console.log('boundary-noise');",
        "      process.stdout.write('boundary-raw-noise');",
        "      ctx.injectContext('fixed-floor');",
        "    },",
        "    before_provider_request: (_event, ctx) => {",
        "      console.log('turn-noise');",
        "      process.stdout.write('turn-raw-noise');",
        "      fs.writeFileSync(process.env.HOOK_MARKER, String('injectContext' in ctx));",
        "    }",
        "  }",
        "  };",
        "} };",
      ].join("\n"),
    );

    materializeCodexPlugin({
      spec: {
        id: "fixture",
        description: "fixture",
        hooks: { session_start: () => {}, before_provider_request: () => {} },
      },
      outDir: pluginRoot,
    });

    const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
    const boundaryCommand = hooks.hooks.SessionStart[0].hooks[0].command as string;
    const turnCommand = hooks.hooks.UserPromptSubmit[0].hooks[0].command as string;

    const boundary = runGeneratedCommand(
      boundaryCommand,
      { hook_event_name: "SessionStart", source: "compact" },
      marker,
    );
    expect(boundary.status).toBe(0);
    expect(boundary.stderr).toBe("");
    expect(JSON.parse(boundary.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "fixed-floor",
      },
    });

    const turn = runGeneratedCommand(
      turnCommand,
      { hook_event_name: "UserPromptSubmit", prompt: "hello" },
      marker,
    );
    expect(turn.status).toBe(0);
    expect(turn.stdout).toBe("{}");
    expect(readFileSync(marker, "utf8")).toBe("false");
  });
});

function runGeneratedCommand(command: string, payload: unknown, marker: string) {
  return spawnSync(command, {
    shell: true,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: { ...process.env, PLUGIN_ROOT: pluginRoot, HOOK_MARKER: marker },
  });
}
