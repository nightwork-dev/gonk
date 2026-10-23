import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { ExtensionSpec } from "@gonk/extension-spec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAX_BOUNDARY_CONTEXT_CHARS,
  type CodexActionContextHookContext,
  type CodexBoundaryHookContext,
  type CodexSideEffectHookContext,
  defaultCodexHookPlacement,
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
        placement: { kind: "boundary-context", event: "SessionStart" },
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
        placement: { kind: "boundary-context", event: "SessionStart" },
        payload: { hook_event_name: "SessionStart", source: "compact" },
      }),
    ).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "persona-floor:compact",
      },
    });
  });

  it("recognizes the current Codex fork start source", async () => {
    const spec: ExtensionSpec = {
      id: "persona",
      description: "fixture",
      hooks: {
        session_start: (_event, unknownCtx) => {
          (unknownCtx as CodexBoundaryHookContext).injectContext("restored-fork-floor");
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "session_start",
        placement: { kind: "boundary-context", event: "SessionStart" },
        payload: { hook_event_name: "SessionStart", source: "fork" },
      }),
    ).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: "restored-fork-floor",
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
    let called = false;
    const spec: ExtensionSpec = {
      id: "persona",
      description: "fixture",
      hooks: {
        session_start: (_event, ctx) => {
          called = true;
          expect("injectContext" in (ctx as object)).toBe(false);
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "session_start",
        placement: { kind: "boundary-context", event: "SessionStart" },
        payload: { hook_event_name: "UserPromptSubmit", source: "startup" },
      }),
    ).resolves.toEqual({});
    expect(called).toBe(false);
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
        placement: { kind: "boundary-context", event: "SessionStart" },
        payload: { hook_event_name: "SessionStart", source: "startup" },
      }),
    ).rejects.toThrow(/exceeds 16384 characters/);
  });

  it.each(["PreToolUse", "UserPromptSubmit"] as const)(
    "emits action context for a materialized %s placement",
    async (hookEventName) => {
      const spec: ExtensionSpec = {
        id: "review",
        description: "fixture",
        hooks: {
          before_tool: (_event, ctx) => {
            const actionContext = ctx as CodexActionContextHookContext;
            actionContext.injectContext(`review:${actionContext.hookEventName}`);
          },
        },
      };

      await expect(
        runCodexHook(spec, {
          specEvent: "before_tool",
          placement: { kind: "action-context", event: hookEventName },
          payload: { hook_event_name: hookEventName, tool_name: "Bash" },
        }),
      ).resolves.toEqual({
        hookSpecificOutput: { hookEventName, additionalContext: `review:${hookEventName}` },
      });
    },
  );

  it("emits action context only for an explicitly materialized supported event", async () => {
    let observed: CodexActionContextHookContext | undefined;
    const spec: ExtensionSpec = {
      id: "review",
      description: "fixture",
      hooks: {
        after_tool: (_event, ctx) => {
          const actionContext = ctx as CodexActionContextHookContext;
          observed = actionContext;
          actionContext.injectContext(`review:${actionContext.hookEventName}`);
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "after_tool",
        placement: { kind: "action-context", event: "PostToolUse" },
        payload: { hook_event_name: "PostToolUse", tool_name: "Bash" },
      }),
    ).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "review:PostToolUse",
      },
    });
    expect(observed?.kind).toBe("action-context");
  });

  it("does not let payload fields forge a materialized event or grant context", async () => {
    let calls = 0;
    let contextKind = "";
    const spec: ExtensionSpec = {
      id: "review",
      description: "fixture",
      hooks: {
        after_tool: (_event, ctx) => {
          calls += 1;
          contextKind = (ctx as { kind: string }).kind;
          if ("injectContext" in (ctx as object)) {
            (ctx as CodexActionContextHookContext).injectContext("must-not-appear");
          }
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "after_tool",
        placement: { kind: "side-effect", event: "UserPromptSubmit" },
        payload: { hook_event_name: "PostToolUse", source: "startup" },
      }),
    ).resolves.toEqual({});
    await expect(
      runCodexHook(spec, {
        specEvent: "after_tool",
        payload: { hook_event_name: "PostToolUse", source: "startup" },
      }),
    ).resolves.toEqual({});
    expect(calls).toBe(1);
    expect(contextKind).toBe("side-effect");
  });

  it("bounds explicitly opted-in action context", async () => {
    const spec: ExtensionSpec = {
      id: "review",
      description: "fixture",
      hooks: {
        after_tool: (_event, ctx) => {
          (ctx as CodexActionContextHookContext).injectContext(
            "x".repeat(MAX_BOUNDARY_CONTEXT_CHARS + 1),
          );
        },
      },
    };

    await expect(
      runCodexHook(spec, {
        specEvent: "after_tool",
        placement: { kind: "action-context", event: "UserPromptSubmit" },
        payload: { hook_event_name: "UserPromptSubmit", prompt: "hello" },
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
        placement: { kind: "boundary-context", event: "SessionStart" },
        payload: { hook_event_name: "SessionStart", source: "startup" },
      });
      await runCodexHook(spec, {
        specEvent: "before_provider_request",
        placement: { kind: "side-effect", event: "UserPromptSubmit" },
        payload: { hook_event_name: "UserPromptSubmit", prompt: "hello" },
      });
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(writes).toEqual([]);
  });
});

describe("gonk-codex-hook executable", () => {
  it("runs materialized action context only for its authorized Codex event", () => {
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
        "    },",
        "    after_tool: (_event, ctx) => {",
        "      console.log('action-noise');",
        "      process.stdout.write('action-raw-noise');",
        "      ctx.injectContext('action-floor:' + ctx.hookEventName);",
        "      fs.writeFileSync(process.env.HOOK_MARKER, ctx.kind);",
        "    },",
        "    session_end: (_event, ctx) => {",
        "      fs.writeFileSync(process.env.HOOK_MARKER, ctx.kind);",
        "    },",
        "    interrupt: (_event, ctx) => {",
        "      fs.writeFileSync(process.env.HOOK_MARKER, ctx.kind);",
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
        hooks: {
          session_start: () => {},
          before_provider_request: () => {},
          after_tool: () => {},
          session_end: () => {},
          interrupt: () => {},
        },
      },
      outDir: pluginRoot,
      hookPlacement: (input) => {
        if (input.specEvent === "after_tool") {
          const placement = { kind: "action-context", event: "PostToolUse", matcher: "Bash" } as const;
          return [{ ...placement, command: input.dispatchCommand(placement) }];
        }
        if (input.specEvent === "session_end" || input.specEvent === "interrupt") {
          const placement = {
            kind: "side-effect",
            event: input.specEvent === "session_end" ? "SessionEnd" : "Interrupt",
          } as const;
          return [{ ...placement, command: input.dispatchCommand(placement) }];
        }
        return defaultCodexHookPlacement(input);
      },
    });

    const hooks = JSON.parse(readFileSync(join(pluginRoot, "hooks", "hooks.json"), "utf8"));
    const boundaryCommand = hooks.hooks.SessionStart[0].hooks[0].command as string;
    const turnCommand = hooks.hooks.UserPromptSubmit[0].hooks[0].command as string;

    const actionCommand = hooks.hooks.PostToolUse[0].hooks[0].command as string;
    const sessionEndCommand = hooks.hooks.SessionEnd[0].hooks[0].command as string;
    const interruptCommand = hooks.hooks.Interrupt[0].hooks[0].command as string;

    const boundary = runGeneratedCommand(
      boundaryCommand,
      { hook_event_name: "SessionStart", source: "fork" },
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

    const action = runGeneratedCommand(
      actionCommand,
      { hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: "done" },
      marker,
    );
    expect(action.status).toBe(0);
    expect(action.stderr).toBe("");
    expect(JSON.parse(action.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "action-floor:PostToolUse",
      },
    });
    expect(readFileSync(marker, "utf8")).toBe("action-context");

    writeFileSync(marker, "sentinel");
    const rootlessAction = runGeneratedCommand(
      actionCommand.replaceAll("$PLUGIN_ROOT", pluginRoot),
      { hook_event_name: "PostToolUse", tool_name: "Bash", tool_response: "done" },
      marker,
      { pluginRoot: null },
    );
    expect(rootlessAction.status).toBe(0);
    expect(rootlessAction.stderr).toBe("");
    expect(JSON.parse(rootlessAction.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: "action-floor:PostToolUse",
      },
    });
    expect(readFileSync(marker, "utf8")).toBe("action-context");

    writeFileSync(marker, "sentinel");
    const forged = runGeneratedCommand(
      actionCommand,
      { hook_event_name: "UserPromptSubmit", prompt: "forged" },
      marker,
    );
    expect(forged.status).toBe(0);
    expect(forged.stdout).toBe("{}");
    expect(readFileSync(marker, "utf8")).toBe("sentinel");

    writeFileSync(marker, "sentinel");
    const forgedDefault = runGeneratedCommand(
      turnCommand,
      { hook_event_name: "PostToolUse", prompt: "forged" },
      marker,
    );
    expect(forgedDefault.status).toBe(0);
    expect(forgedDefault.stdout).toBe("{}");
    expect(readFileSync(marker, "utf8")).toBe("sentinel");

    for (const [command, hookEventName] of ([
      [sessionEndCommand, "SessionEnd"],
      [interruptCommand, "Interrupt"],
    ] as const)) {
      const lifecycle = runGeneratedCommand(command, { hook_event_name: hookEventName }, marker);
      expect(lifecycle.status).toBe(0);
      expect(lifecycle.stdout).toBe("{}");
      expect(readFileSync(marker, "utf8")).toBe("side-effect");
    }
  });
});

function runGeneratedCommand(
  command: string,
  payload: unknown,
  marker: string,
  options: { pluginRoot?: string | null } = {},
) {
  const env: NodeJS.ProcessEnv = { ...process.env, HOOK_MARKER: marker };
  delete env.PLUGIN_ROOT;
  delete env.CLAUDE_PLUGIN_ROOT;
  if (options.pluginRoot !== null) env.PLUGIN_ROOT = options.pluginRoot ?? pluginRoot;
  return spawnSync(command, {
    shell: true,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env,
  });
}
