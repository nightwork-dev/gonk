import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../src/registry.ts";
import { shape } from "../src/shape.ts";
import type { ToolContext, ToolDefinition, ToolEvent } from "../src/types.ts";
import { InMemoryWsEmitter, makeWsHandler, type WsProjectionConfig } from "../src/ws.ts";

type Caller = "agent" | "human";

const anyInput = shape<Record<string, unknown>>(
  (v): v is Record<string, unknown> => !!v && typeof v === "object",
  "expected object",
);

let handlerCalls: string[] = [];

function tool(
  name: string,
  opts: { readOnly: boolean; requiredRole?: string; throws?: boolean },
): ToolDefinition {
  return {
    name,
    description: name,
    input: anyInput,
    hints: { mcp: { annotations: { readOnly: opts.readOnly } } },
    ...(opts.requiredRole ? { authorization: { requiredRole: opts.requiredRole } } : {}),
    handler: async (input) => {
      handlerCalls.push(name);
      if (opts.throws) throw new Error(`boom in ${name}`);
      return { data: { ok: name, echo: input } };
    },
  };
}

// Host policy: interpret gonk's real `authorization.requiredRole` against the caller.
const config: WsProjectionConfig<Caller> = {
  authorize: (t, caller) => !t.authorization?.requiredRole || t.authorization.requiredRole === caller,
};

function setup(overrides: Partial<WsProjectionConfig<Caller>> = {}) {
  handlerCalls = [];
  const registry = new ToolRegistry();
  registry.register([
    tool("piece.get", { readOnly: true }),                          // read: no broadcast
    tool("draft.propose", { readOnly: false }),                     // unrestricted write: broadcast
    tool("draft.lock", { readOnly: false, requiredRole: "human" }), // restricted write: human-only
    tool("boom.op", { readOnly: false, throws: true }),             // handler throws
    { ...tool("hidden.op", { readOnly: false }), requires: () => false }, // registry SKIPS it
  ]);
  const emitter = new InMemoryWsEmitter();
  return { registry, emitter, handle: makeWsHandler(registry, { ...config, emitter, ...overrides }) };
}

describe("registry → WS projection", () => {
  it("unrestricted write: authorized → result + broadcast", async () => {
    const { handle, emitter } = setup();
    const reply = await handle({ op: "draft.propose", reqId: "r1", caller: "agent", input: { x: 1 } });
    expect(reply).toMatchObject({ type: "result", reqId: "r1", result: { ok: "draft.propose" } });
    expect(emitter.sent).toEqual([{ type: "broadcast", op: "draft.propose", payload: { ok: "draft.propose", echo: { x: 1 } } }]);
  });

  it("read op (readOnly): result but NO broadcast", async () => {
    const { handle, emitter } = setup();
    const reply = await handle({ op: "piece.get", reqId: "r2", caller: "human", input: {} });
    expect(reply).toMatchObject({ type: "result", reqId: "r2" });
    expect(emitter.sent).toHaveLength(0);
  });

  it("authorization is enforced BEFORE the handler runs (denied caller never invokes)", async () => {
    const { handle, emitter } = setup();
    const reply = await handle({ op: "draft.lock", reqId: "r3", caller: "agent", input: {} });
    expect(reply).toEqual({ type: "error", reqId: "r3", message: "Not authorized to invoke draft.lock" });
    expect(handlerCalls).not.toContain("draft.lock");
    expect(emitter.sent).toHaveLength(0);
  });

  it("restricted write does NOT broadcast by default, even for an authorized caller (disclosure-safe default)", async () => {
    const { handle, emitter } = setup();
    const reply = await handle({ op: "draft.lock", reqId: "r4", caller: "human", input: {} });
    expect(reply).toMatchObject({ type: "result", reqId: "r4" });
    expect(emitter.sent).toHaveLength(0); // restricted op is not fanned to all clients by default
  });

  it("host may deliberately opt a restricted write into broadcast via shouldBroadcast override", async () => {
    const { handle, emitter } = setup({ shouldBroadcast: (t) => t.hints?.mcp?.annotations?.readOnly === false });
    const reply = await handle({ op: "draft.lock", reqId: "r4b", caller: "human", input: {} });
    expect(reply).toMatchObject({ type: "result", reqId: "r4b" });
    expect(emitter.sent).toEqual([{ type: "broadcast", op: "draft.lock", payload: { ok: "draft.lock", echo: {} } }]);
  });

  it("handler error → error reply, no broadcast", async () => {
    const { handle, emitter } = setup();
    const reply = await handle({ op: "boom.op", reqId: "r5", caller: "agent", input: {} });
    expect(reply).toMatchObject({ type: "error", reqId: "r5", message: /boom in boom\.op/ });
    expect(emitter.sent).toHaveLength(0);
  });

  it("unknown op → error", async () => {
    const { handle } = setup();
    expect(await handle({ op: "nope.op", reqId: "r6", caller: "agent" })).toEqual({
      type: "error", reqId: "r6", message: "No such op: nope.op",
    });
  });

  it("a requires()=>false tool is not advertised (WS surface == registry at construction)", async () => {
    const { handle } = setup();
    const reply = await handle({ op: "hidden.op", reqId: "r7", caller: "human", input: {} });
    expect(reply).toMatchObject({ type: "error", message: "No such op: hidden.op" });
  });

  // ── regressions from the GLM-REVIEW-WS PoCs (flipped to the corrected behavior) ──

  it("result-then-error stream → FAILURE reply, no broadcast (any error is terminal)", async () => {
    const registry = new ToolRegistry();
    registry.register([{
      name: "flaky.op", description: "f", input: anyInput,
      hints: { mcp: { annotations: { readOnly: false } } },
      handler: async function* (): AsyncIterable<ToolEvent> {
        yield { type: "result", data: { partial: "here you go" } };
        yield { type: "error", code: "INTERNAL", message: "actually it blew up" };
      },
    }]);
    const emitter = new InMemoryWsEmitter();
    const handle = makeWsHandler(registry, { ...config, emitter });
    const reply = await handle({ op: "flaky.op", reqId: "z", caller: "agent", input: {} });
    expect(reply).toEqual({ type: "error", reqId: "z", message: "actually it blew up" });
    expect(emitter.sent).toHaveLength(0);
  });

  it("multiple result events → LAST result wins (tail not silently dropped)", async () => {
    const registry = new ToolRegistry();
    registry.register([{
      name: "multi.op", description: "m", input: anyInput,
      handler: async function* (): AsyncIterable<ToolEvent> {
        yield { type: "result", data: { n: 1 } };
        yield { type: "result", data: { n: 2 } };
      },
    }]);
    const handle = makeWsHandler(registry, { ...config, emitter: new InMemoryWsEmitter() });
    const reply = await handle({ op: "multi.op", caller: "agent", input: {} });
    expect(reply).toMatchObject({ type: "result", result: { n: 2 } });
  });

  it("authorize/makeContext throwing → error reply, not an unhandled rejection", async () => {
    const registry = new ToolRegistry();
    registry.register([tool("piece.get", { readOnly: true })]);
    const handle = makeWsHandler(registry, {
      authorize: () => { throw new Error("policy exploded"); },
    });
    await expect(handle({ op: "piece.get", reqId: "e", caller: "agent", input: {} }))
      .resolves.toEqual({ type: "error", reqId: "e", message: "policy exploded" });
  });

  it("makeContext throwing → error reply", async () => {
    const registry = new ToolRegistry();
    registry.register([tool("piece.get", { readOnly: true })]);
    const handle = makeWsHandler(registry, {
      authorize: () => true,
      makeContext: () => { throw new Error("ctx build failed"); },
    });
    await expect(handle({ op: "piece.get", reqId: "m", caller: "agent", input: {} }))
      .resolves.toEqual({ type: "error", reqId: "m", message: "ctx build failed" });
  });

  it("shouldBroadcast throwing (post-commit) → result still returned, broadcast suppressed", async () => {
    // The mutation has COMMITTED. A broadcast-policy failure must NOT mask the
    // success as a client-facing error — the caller gets its result, nothing fans
    // out. (Regression: previously the outer catch turned this into an error reply.)
    const emitter = new InMemoryWsEmitter();
    const registry = new ToolRegistry();
    registry.register([tool("draft.propose", { readOnly: false })]);
    const handle = makeWsHandler(registry, {
      authorize: () => true,
      shouldBroadcast: () => { throw new Error("policy boom"); },
      emitter,
    });
    await expect(handle({ op: "draft.propose", reqId: "sb", caller: "agent", input: {} }))
      .resolves.toMatchObject({ type: "result", reqId: "sb", result: { ok: "draft.propose" } });
    expect(emitter.sent).toHaveLength(0);
  });

  it("emitter.broadcast throwing (post-commit) → result still returned", async () => {
    // Same guarantee for the emitter itself failing after a committed mutation.
    const throwingEmitter = { broadcast: () => { throw new Error("socket gone"); } };
    const registry = new ToolRegistry();
    registry.register([tool("draft.propose", { readOnly: false })]);
    const handle = makeWsHandler(registry, {
      authorize: () => true,
      emitter: throwingEmitter,
    });
    await expect(handle({ op: "draft.propose", reqId: "eb", caller: "agent", input: {} }))
      .resolves.toMatchObject({ type: "result", reqId: "eb", result: { ok: "draft.propose" } });
  });

  it("authorize receives the request input (input-aware policy)", async () => {
    const seen: unknown[] = [];
    const registry = new ToolRegistry();
    registry.register([tool("piece.get", { readOnly: true })]);
    const handle = makeWsHandler(registry, {
      authorize: (_t, _c, input) => { seen.push(input); return true; },
    });
    await handle({ op: "piece.get", caller: "agent", input: { scoped: 42 } });
    expect(seen).toEqual([{ scoped: 42 }]);
  });

  it("fail-closed default: blank/empty authorization fields still suppress broadcast (NEW-2)", async () => {
    const emitter = new InMemoryWsEmitter();
    const registry = new ToolRegistry();
    registry.register([
      { name: "empty.callers", description: "e", input: anyInput,
        hints: { mcp: { annotations: { readOnly: false } } },
        authorization: { allowedCallers: [] },
        handler: async () => ({ data: { s: 1 } }) },
      { name: "blank.role", description: "b", input: anyInput,
        hints: { mcp: { annotations: { readOnly: false } } },
        authorization: { requiredRole: "" },
        handler: async () => ({ data: { s: 2 } }) },
    ]);
    const handle = makeWsHandler(registry, { authorize: () => true, emitter });
    await handle({ op: "empty.callers", caller: "agent", input: {} });
    await handle({ op: "blank.role", caller: "agent", input: {} });
    expect(emitter.sent).toHaveLength(0); // both restricted-by-declaration → no default broadcast
  });

  it("TRANSITIVE AUTHORITY (documented, not a guarantee): ctx.invoke composes at the entered tool's authority, not re-authorized against the caller", async () => {
    const seen: string[] = [];
    const composer: ToolDefinition = {
      name: "compose.op", description: "c", input: anyInput,
      handler: async (_i, ctx: ToolContext) => {
        for await (const _e of ctx.invoke("draft.lock", { via: "compose" })) { /* consume */ }
        return { data: { composed: true } };
      },
    };
    const draftLock: ToolDefinition = {
      name: "draft.lock", description: "d", input: anyInput,
      authorization: { requiredRole: "human" },
      handler: async () => { seen.push("draft.lock-ran"); return { data: { locked: true } }; },
    };
    const registry = new ToolRegistry();
    registry.register([composer, draftLock]);
    const handle = makeWsHandler(registry, { ...config, emitter: new InMemoryWsEmitter() });

    // agent may enter compose.op (unrestricted); its composed draft.lock is NOT re-authorized.
    await handle({ op: "compose.op", reqId: "c1", caller: "agent", input: {} });
    expect(seen).toContain("draft.lock-ran");
    // but the agent CANNOT reach draft.lock directly — the entry gate holds.
    expect(await handle({ op: "draft.lock", reqId: "c2", caller: "agent", input: {} }))
      .toMatchObject({ type: "error", message: /Not authorized/ });
    // CONTRACT: do not expose a tool that composes ops the caller must not reach.
    // A stronger guarantee needs a registry-level re-authorize hook (out of scope).
  });
});
