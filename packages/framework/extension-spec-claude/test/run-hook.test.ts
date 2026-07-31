import { describe, expect, it } from "vitest";

import { runClaudeHook, type ClaudeHookContext } from "../src/run-hook.ts";
import type { ExtensionSpec } from "@gonk/extension-spec";

function specWith(handler: (event: unknown, ctx: unknown) => void): ExtensionSpec {
  return { id: "t", description: "t", hooks: { session_start: handler } };
}

describe("runClaudeHook", () => {
  it("emits injected text as SessionStart additionalContext", async () => {
    const spec = specWith((_e, ctx) => (ctx as ClaudeHookContext).injectContext("hello"));
    const out = await runClaudeHook(spec, { specEvent: "session_start", payload: { cwd: "/tmp" } });
    expect(out.hookSpecificOutput?.hookEventName).toBe("SessionStart");
    expect(out.hookSpecificOutput?.additionalContext).toBe("hello");
  });

  it("passes cwd and source (e.g. 'compact') from the payload to the handler", async () => {
    let seen: { cwd?: string; source?: string | undefined } = {};
    const spec = specWith((_e, ctx) => {
      const c = ctx as ClaudeHookContext;
      seen = { cwd: c.cwd, source: c.source };
      c.injectContext("x");
    });
    await runClaudeHook(spec, {
      specEvent: "session_start",
      payload: { cwd: "/work", source: "compact" },
    });
    expect(seen).toEqual({ cwd: "/work", source: "compact" });
  });

  it("maps before_provider_request to UserPromptSubmit", async () => {
    const spec: ExtensionSpec = {
      id: "t",
      description: "t",
      hooks: { before_provider_request: (_e, ctx) => (ctx as ClaudeHookContext).injectContext("turn") },
    };
    const out = await runClaudeHook(spec, { specEvent: "before_provider_request", payload: {} });
    expect(out.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
  });

  it("invokes turn_complete handlers through Claude's Stop hook", async () => {
    let invoked = false;
    const spec: ExtensionSpec = {
      id: "t",
      description: "t",
      hooks: {
        turn_complete: (_event, ctx) => {
          invoked = true;
          (ctx as ClaudeHookContext).injectContext("run the completion check");
        },
      },
    };

    const out = await runClaudeHook(spec, {
      specEvent: "turn_complete",
      payload: { hook_event_name: "Stop" },
    });

    expect(invoked).toBe(true);
    expect(out).toEqual({
      hookSpecificOutput: {
        hookEventName: "Stop",
        additionalContext: "run the completion check",
      },
    });
  });

  it("invokes session_end handlers for side effects without emitting unsupported output", async () => {
    let invoked = false;
    const spec: ExtensionSpec = {
      id: "t",
      description: "t",
      hooks: {
        session_end: (_event, ctx) => {
          invoked = true;
          (ctx as ClaudeHookContext).injectContext("cannot be delivered");
        },
      },
    };

    const out = await runClaudeHook(spec, {
      specEvent: "session_end",
      payload: { hook_event_name: "SessionEnd", reason: "other" },
    });

    expect(invoked).toBe(true);
    expect(out).toEqual({});
  });

  it("returns {} when nothing is injected", async () => {
    const out = await runClaudeHook(specWith(() => {}), { specEvent: "session_start", payload: {} });
    expect(out).toEqual({});
  });

  it("returns {} for an event with no matching handler", async () => {
    const spec = specWith((_e, ctx) => (ctx as ClaudeHookContext).injectContext("x"));
    expect(await runClaudeHook(spec, { specEvent: "turn_complete", payload: {} })).toEqual({});
    expect(
      await runClaudeHook({ id: "t", description: "t" }, { specEvent: "session_start", payload: {} }),
    ).toEqual({});
  });

  it("ignores empty/whitespace injections", async () => {
    const spec = specWith((_e, ctx) => {
      const c = ctx as ClaudeHookContext;
      c.injectContext("   ");
      c.injectContext("");
    });
    expect(await runClaudeHook(spec, { specEvent: "session_start", payload: {} })).toEqual({});
  });
});
