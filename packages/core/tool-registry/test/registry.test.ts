import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  ownerPrincipal,
  type AuthContext,
  type AuthSecurityReceipt,
  type AuthenticatedPrincipal,
} from "@gonk/auth";

import { MemoryScopeStore } from "@gonk/scope";

import {
  ToolError,
  ToolRegistry,
  inMemorySink,
  makeBaseContext,
  resolveInputJsonSchema,
  shape,
  withJsonSchema,
  type ToolDefinition,
  type ToolEvent,
  type ToolRegistryOptions,
} from "../src/index.ts";

// This suite exercises registry PLUMBING (validation, streaming, cycles,
// abort, composition) — not authorization/approval semantics, which
// `security.test.ts` owns. GR-83 made `ToolContext.auth` required, so every
// invocation here binds a fixed owner principal; `approvalMode: "bypass"`
// keeps these tests' tools (none declare an approval tier, so they'd
// otherwise default to "exec" and hit `APPROVAL_DENIED` the moment auth
// flows through) behaving exactly as they did before auth was mandatory.
const OWNER_AUTH: AuthContext = ownerPrincipal({ USER: "test", HOSTNAME: "test-host" });

function ownerRegistry(opts: ToolRegistryOptions = {}): ToolRegistry {
  return new ToolRegistry({
    ...opts,
    security: { approvalMode: "bypass", ...opts.security },
  });
}

function ownerCtx(
  overrides: Partial<Omit<Parameters<typeof makeBaseContext>[0], "auth">> = {}
) {
  return makeBaseContext({ ...overrides, auth: OWNER_AUTH });
}

// Minimal Standard Schema impl for tests — passes anything matching shape, fails otherwise.
function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => ({ value: value as T }),
    },
  };
}

function requireString(): StandardSchemaV1<unknown, { text: string }> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value) => {
        if (
          value &&
          typeof value === "object" &&
          "text" in value &&
          typeof (value as { text: unknown }).text === "string"
        ) {
          return { value: value as { text: string } };
        }
        return { issues: [{ message: "text required" }] };
      },
    },
  };
}

async function collect(stream: AsyncIterable<ToolEvent>): Promise<ToolEvent[]> {
  const out: ToolEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("ToolRegistry", () => {
  it("atomically replaces one source-owned catalog", async () => {
    const r = ownerRegistry();
    const tool = (name: string, value: string): ToolDefinition => ({
      name,
      description: name,
      input: passthrough(),
      handler: async () => ({ data: { value } }),
    });

    r.replaceSource("remote-a", [
      tool("remote-a.old", "old"),
      tool("remote-a.kept", "v1"),
    ]);
    expect(r.list().map((entry) => entry.name).sort()).toEqual([
      "remote-a.kept",
      "remote-a.old",
    ]);

    r.replaceSource("remote-a", [
      tool("remote-a.kept", "v2"),
      tool("remote-a.new", "new"),
    ]);

    expect(r.has("remote-a.old")).toBe(false);
    expect(r.list().map((entry) => entry.name).sort()).toEqual([
      "remote-a.kept",
      "remote-a.new",
    ]);
    await expect(
      collect(r.invoke("remote-a.old", {}, ownerCtx()))
    ).resolves.toMatchObject([{ type: "error", code: "TOOL_NOT_FOUND" }]);
    await expect(
      collect(r.invoke("remote-a.kept", {}, ownerCtx()))
    ).resolves.toMatchObject([{ type: "result", data: { value: "v2" } }]);
  });

  it("retains the last complete source catalog when replacement fails", () => {
    const r = ownerRegistry();
    const original: ToolDefinition = {
      name: "remote-a.original",
      description: "original",
      input: passthrough(),
      handler: async () => ({ data: true }),
    };
    r.replaceSource("remote-a", original);

    expect(() =>
      r.replaceSource("remote-a", [
        { ...original, name: "remote-a.duplicate" },
        { ...original, name: "remote-a.duplicate" },
      ])
    ).toThrow("Duplicate tool in source catalog remote-a");
    expect(r.list().map((entry) => entry.name)).toEqual([
      "remote-a.original",
    ]);
  });

  it("never exposes a partially built source catalog to concurrent readers", () => {
    const r = ownerRegistry();
    const observed: string[][] = [];
    const tool = (name: string): ToolDefinition => ({
      name,
      description: name,
      input: passthrough(),
      handler: async () => ({ data: true }),
    });
    r.replaceSource("remote-a", [
      tool("remote-a.old-1"),
      tool("remote-a.old-2"),
    ]);

    const candidate = [tool("remote-a.new-1"), tool("remote-a.new-2")];
    candidate[1] = {
      ...candidate[1]!,
      requires: () => {
        observed.push(r.list().map((entry) => entry.name).sort());
        return true;
      },
    };
    r.replaceSource("remote-a", candidate);
    observed.push(r.list().map((entry) => entry.name).sort());

    expect(observed).toEqual([
      ["remote-a.old-1", "remote-a.old-2"],
      ["remote-a.new-1", "remote-a.new-2"],
    ]);
  });

  it("rejects collisions across local registrations and source catalogs", () => {
    const r = ownerRegistry();
    const tool: ToolDefinition = {
      name: "shared-name",
      description: "shared",
      input: passthrough(),
      handler: async () => ({ data: true }),
    };
    r.register(tool);
    expect(() => r.replaceSource("remote-a", tool)).toThrow(
      "conflicts with registered tool"
    );

    const sourced = ownerRegistry();
    sourced.replaceSource("remote-a", tool);
    expect(() => sourced.register(tool, { overwrite: true })).toThrow(
      "owned by a source catalog"
    );
    expect(() => sourced.replaceSource("remote-b", tool)).toThrow(
      "conflicts with source remote-a"
    );
  });

  it("keeps runtime validation and advertised JSON Schema on one annotated Standard Schema value", async () => {
    const inputSchema = shape<{ text: string }>(
      (value): value is { text: string } =>
        Boolean(value) &&
        typeof value === "object" &&
        typeof (value as { text?: unknown }).text === "string",
      "expected { text: string }",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      }
    );
    const r = ownerRegistry();
    const tool: ToolDefinition<{ text: string }, { echoed: string }> = {
      name: "echo",
      description: "echo",
      input: inputSchema,
      handler: async (input) => ({ data: { echoed: input.text } }),
    };
    r.register(tool);

    expect(resolveInputJsonSchema(tool)).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    });
    await expect(
      collect(r.invoke("echo", { wrong: true }, ownerCtx()))
    ).resolves.toMatchObject([{ type: "error", code: "INVALID_INPUT" }]);
  });

  it("lets external Standard Schema libraries attach one JSON Schema projection with withJsonSchema", () => {
    const schema = withJsonSchema(requireString(), {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });

    expect(resolveInputJsonSchema({ input: schema })).toEqual({
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
    });
  });

  it("invokes a sync tool and emits result", async () => {
    const r = ownerRegistry();
    const tool: ToolDefinition<{ text: string }, { echoed: string }> = {
      name: "echo",
      description: "echo",
      input: requireString(),
      handler: async (input) => ({ data: { echoed: input.text } }),
    };
    r.register(tool);
    const events = await collect(r.invoke("echo", { text: "hi" }, ownerCtx()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "result", data: { echoed: "hi" } });
  });

  it("carries the same terminal metadata through promise and streaming handlers", async () => {
    const metadata = {
      provenance: {
        sourceKind: "http",
        sourceId: "example",
        sourceRevision: "rev-1",
        evidenceAnchors: [{ kind: "response", value: "response:1" }],
      },
      freshness: { state: "fresh" as const, checkedAt: "2026-08-11T00:00:00Z" },
      cache: { policy: "reusable" as const, guidance: "safe to reuse" },
      size: { original: 10, returned: 10, unit: "bytes" as const },
      truncation: { truncated: false as const },
    };
    const r = ownerRegistry();
    r.register([
      {
        name: "metadata.promise",
        description: "promise result metadata",
        input: passthrough(),
        handler: async () => ({ data: { ok: true }, metadata }),
      },
      {
        name: "metadata.stream",
        description: "stream result metadata",
        input: passthrough(),
        handler: async function* () {
          yield { type: "result", data: { ok: true }, metadata };
        },
      },
    ]);

    await expect(
      collect(r.invoke("metadata.promise", {}, ownerCtx()))
    ).resolves.toEqual([{ type: "result", data: { ok: true }, metadata }]);
    await expect(
      collect(r.invoke("metadata.stream", {}, ownerCtx()))
    ).resolves.toEqual([{ type: "result", data: { ok: true }, metadata }]);
  });

  it("validates input and emits INVALID_INPUT on failure", async () => {
    const r = ownerRegistry();
    r.register({
      name: "echo",
      description: "echo",
      input: requireString(),
      handler: async () => ({ data: null }),
    });
    const events = await collect(r.invoke("echo", { wrong: 1 }, ownerCtx()));
    expect(events[0]).toMatchObject({ type: "error", code: "INVALID_INPUT" });
  });

  it("emits TOOL_NOT_FOUND for missing tools", async () => {
    const r = ownerRegistry();
    const events = await collect(r.invoke("ghost", {}, ownerCtx()));
    expect(events[0]).toMatchObject({ type: "error", code: "TOOL_NOT_FOUND" });
  });

  it("converts ToolError throws into error events", async () => {
    const r = ownerRegistry();
    r.register({
      name: "boom",
      description: "boom",
      input: passthrough(),
      handler: async () => {
        throw new ToolError("BOOM", "kaboom");
      },
    });
    const events = await collect(r.invoke("boom", {}, ownerCtx()));
    expect(events[0]).toMatchObject({ type: "error", code: "BOOM", message: "kaboom" });
  });

  it("propagates streaming events from async iterable handlers", async () => {
    const r = ownerRegistry();
    r.register({
      name: "stream",
      description: "stream",
      input: passthrough(),
      handler: async function* () {
        yield { type: "progress", message: "1" } as ToolEvent;
        yield { type: "progress", message: "2" } as ToolEvent;
        yield { type: "result", data: { ok: true } } as ToolEvent;
      },
    });
    const events = await collect(r.invoke("stream", {}, ownerCtx()));
    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("progress");
    expect(events[2]).toMatchObject({ type: "result", data: { ok: true } });
  });

  it("aborts a streaming handler when signal fires", async () => {
    const r = ownerRegistry();
    const ac = new AbortController();
    r.register({
      name: "loop",
      description: "loop",
      input: passthrough(),
      handler: async function* (_input, ctx) {
        let i = 0;
        while (!ctx.signal.aborted) {
          yield { type: "progress", message: String(i++) } as ToolEvent;
          await new Promise((res) => setTimeout(res, 50));
        }
        yield { type: "result", data: { i } } as ToolEvent;
      },
    });
    const ctx = { ...ownerCtx({ signal: ac.signal }) };
    const stream = r.invoke("loop", {}, ctx);
    const events: ToolEvent[] = [];
    setTimeout(() => ac.abort(), 30);
    for await (const e of stream) {
      events.push(e);
      if (events.length > 100) break;
    }
    const last = events[events.length - 1]!;
    expect(last.type).toBe("error");
    expect((last as { code: string }).code).toBe("ABORTED");
  });

  it("records metrics", async () => {
    const sink = inMemorySink();
    const r = ownerRegistry({ metrics: sink });
    r.register({
      name: "ok",
      description: "ok",
      input: passthrough(),
      handler: async () => ({ data: 1 }),
    });
    await collect(r.invoke("ok", {}, ownerCtx()));
    const snap = sink.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.outcome).toBe("ok");
    expect(snap[0]?.tool).toBe("ok");
  });

  it("validates output strictly", async () => {
    const r = ownerRegistry();
    const failingOutput: StandardSchemaV1<unknown, unknown> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: () => ({ issues: [{ message: "bad" }] }),
      },
    };
    r.register({
      name: "bad-out",
      description: "bad-out",
      input: passthrough(),
      output: failingOutput,
      validateOutput: "strict",
      handler: async () => ({ data: { anything: true } }),
    });
    const events = await collect(r.invoke("bad-out", {}, ownerCtx()));
    expect(events[0]).toMatchObject({ type: "error", code: "OUTPUT_INVALID" });
  });

  it("supports cross-tool composition via ctx.invoke", async () => {
    const r = ownerRegistry();
    r.register({
      name: "inner",
      description: "inner",
      input: passthrough(),
      handler: async () => ({ data: { inner: 42 } }),
    });
    r.register({
      name: "outer",
      description: "outer",
      input: passthrough(),
      handler: async (_i, ctx) => {
        let inner: unknown;
        for await (const e of ctx.invoke("inner", {})) {
          if (e.type === "result") inner = e.data;
        }
        return { data: { outer: true, inner } };
      },
    });
    const events = await collect(r.invoke("outer", {}, ownerCtx()));
    expect(events[0]).toMatchObject({
      type: "result",
      data: { outer: true, inner: { inner: 42 } },
    });
  });

  it("detects cycles in cross-tool composition", async () => {
    const r = ownerRegistry();
    r.register({
      name: "a",
      description: "a",
      input: passthrough(),
      handler: async (_i, ctx) => {
        for await (const e of ctx.invoke("a", {})) {
          if (e.type === "error") return { data: { error: e.code } };
        }
        return { data: { error: null } };
      },
    });
    const events = await collect(r.invoke("a", {}, ownerCtx()));
    expect(events[0]).toMatchObject({ type: "result", data: { error: "CYCLE" } });
  });

  it("exposes ctx.input to duplex tools and is undefined when no input given", async () => {
    const r = ownerRegistry();
    const seen: unknown[] = [];
    r.register({
      name: "duplex",
      description: "duplex",
      input: passthrough(),
      capabilities: { duplex: true },
      handler: async (_i, ctx) => {
        if (!ctx.input) return { data: { hadInput: false } };
        for await (const chunk of ctx.input) {
          seen.push(chunk);
          if (seen.length >= 2) break;
        }
        return { data: { hadInput: true, count: seen.length } };
      },
    });

    const inputStream = (async function* () {
      yield { type: "audio" as const, pcm: new Uint8Array([1, 2, 3]), sampleRate: 16000, channels: 1 };
      yield { type: "control" as const, op: "end-turn" as const };
    })();

    const ctx = { ...ownerCtx(), input: inputStream };
    const events = await collect(r.invoke("duplex", {}, ctx));
    expect(events[0]).toMatchObject({ type: "result", data: { hadInput: true, count: 2 } });
    expect(seen).toHaveLength(2);
    expect((seen[0] as { type: string }).type).toBe("audio");
    expect((seen[1] as { type: string }).type).toBe("control");
  });

  it("does not forward parent's ctx.input to child tools via ctx.invoke", async () => {
    const r = ownerRegistry();
    let childSawInput = false;
    r.register({
      name: "child",
      description: "child",
      input: passthrough(),
      handler: async (_i, ctx) => ({ data: { hasInput: ctx.input !== undefined } }),
    });
    r.register({
      name: "parent",
      description: "parent",
      input: passthrough(),
      handler: async (_i, ctx) => {
        for await (const e of ctx.invoke("child", {})) {
          if (e.type === "result") childSawInput = (e.data as { hasInput: boolean }).hasInput;
        }
        return { data: { childSawInput } };
      },
    });
    const inputStream = (async function* () {
      yield { type: "text" as const, text: "hi" };
    })();
    const ctx = { ...ownerCtx(), input: inputStream };
    const events = await collect(r.invoke("parent", {}, ctx));
    expect(events[0]).toMatchObject({ type: "result", data: { childSawInput: false } });
  });

  it("threads ctx.scope to handlers and forwards to children via ctx.invoke", async () => {
    const r = ownerRegistry();
    const seen = { parent: undefined as string | undefined, child: undefined as string | undefined };

    r.register({
      name: "child",
      description: "child",
      input: passthrough(),
      handler: async (_i, ctx) => {
        seen.child = ctx.scope?.get<string>("k");
        return { data: { ok: true } };
      },
    });
    r.register({
      name: "parent",
      description: "parent",
      input: passthrough(),
      handler: async (_i, ctx) => {
        seen.parent = ctx.scope?.get<string>("k");
        for await (const _ of ctx.invoke("child", {})) void _;
        return { data: { ok: true } };
      },
    });

    const scope = new MemoryScopeStore();
    scope.set("k", "v-from-persona", "persona");
    const ctx = { ...ownerCtx(), scope };
    await collect(r.invoke("parent", {}, ctx));
    expect(seen.parent).toBe("v-from-persona");
    expect(seen.child).toBe("v-from-persona");
  });

  it("merges and extracts registries", async () => {
    const a = ownerRegistry();
    a.register({ name: "x", description: "x", input: passthrough(), handler: async () => ({ data: 1 }) });
    const b = ownerRegistry();
    b.register({ name: "y", description: "y", input: passthrough(), handler: async () => ({ data: 2 }) });
    const merged = a.merge(b);
    expect(merged.list().map((t) => t.name).sort()).toEqual(["x", "y"]);

    const sub = merged.extract(["y"]);
    expect(sub.list().map((t) => t.name)).toEqual(["y"]);
  });

  it("skips tools whose `requires` predicate returns false", () => {
    const r = ownerRegistry();
    r.register({
      name: "always",
      description: "always-on",
      input: passthrough(),
      handler: async () => ({ data: 1 }),
    });
    r.register({
      name: "configured",
      description: "config-gated, configured",
      input: passthrough(),
      handler: async () => ({ data: 2 }),
      requires: () => true,
    });
    r.register({
      name: "unconfigured",
      description: "config-gated, NOT configured",
      input: passthrough(),
      handler: async () => ({ data: 3 }),
      requires: () => false,
    });
    expect(r.list().map((t) => t.name).sort()).toEqual(["always", "configured"]);
    expect(r.has("unconfigured")).toBe(false);
    expect(r.get("unconfigured")).toBeUndefined();
  });
});

// =============================================================================
// withPrincipal — the "explicit once, ambient never" bound invoker (GR-83).
// =============================================================================

function namedAuth(
  id: string,
  authorize: AuthContext["authorize"] = () => ({
    outcome: "allow",
    reason: `${id} allowed`,
  })
): AuthContext {
  const principal: AuthenticatedPrincipal = {
    id: `principal:${id}`,
    kind: "human",
    identity: { issuer: "test", subject: id, method: "session" },
    roles: [],
    scopes: [],
  };
  return { principal, authorize };
}

/** A base context with no `auth` field at all — proves the bound-invoker
 *  path never needs one threaded per call (unlike `ownerCtx()`, which
 *  always bakes one in for the direct-`invoke` comparison path). */
function bareCtx() {
  return {
    signal: new AbortController().signal,
    log: { debug() {}, info() {}, warn() {}, error() {} },
    cwd: process.cwd(),
    env: process.env,
  };
}

describe("ToolRegistry.withPrincipal", () => {
  function receiptRegistry(receipts: AuthSecurityReceipt[]): ToolRegistry {
    let counter = 0;
    return new ToolRegistry({
      security: {
        approvalMode: "bypass",
        requestId: () => `req-${counter++}`,
        now: () => "2026-08-07T00:00:00.000Z",
        auditSink: {
          write: (receipt) => {
            receipts.push(receipt);
          },
        },
      },
    });
  }

  function registerFixtures(registry: ToolRegistry): void {
    registry.register([
      {
        name: "greet",
        description: "greet",
        input: passthrough(),
        handler: async () => ({ data: { greeted: true } }),
      },
      {
        name: "blocked",
        description: "blocked",
        input: passthrough(),
        handler: async () => ({ data: { leaked: true } }),
      },
    ]);
  }

  it("produces identical result payloads to explicit per-call auth", async () => {
    const auth = namedAuth("alice", ({ action, resource }) => ({
      outcome: action === "tool.invoke" && resource.target === "blocked" ? "deny" : "allow",
      reason: resource.target === "blocked" ? "blocked by policy" : "ok",
    }));

    const direct = receiptRegistry([]);
    registerFixtures(direct);
    const directResult = await collect(direct.invoke("greet", {}, { ...bareCtx(), auth }));

    const bound = receiptRegistry([]);
    registerFixtures(bound);
    const boundInvoker = bound.withPrincipal(auth);
    const boundResult = await collect(boundInvoker.invoke("greet", {}, bareCtx()));

    expect(boundResult).toEqual(directResult);
    expect(directResult).toEqual([
      { type: "result", data: { greeted: true }, display: undefined },
    ]);
  });

  it("produces identical rejection behavior for a denied tool", async () => {
    const auth = namedAuth("alice", ({ action, resource }) => ({
      outcome: action === "tool.invoke" && resource.target === "blocked" ? "deny" : "allow",
      reason: resource.target === "blocked" ? "blocked by policy" : "ok",
    }));

    const direct = receiptRegistry([]);
    registerFixtures(direct);
    const directResult = await collect(direct.invoke("blocked", {}, { ...bareCtx(), auth }));

    const bound = receiptRegistry([]);
    registerFixtures(bound);
    const boundResult = await collect(bound.withPrincipal(auth).invoke("blocked", {}, bareCtx()));

    expect(boundResult).toEqual(directResult);
    expect(directResult).toMatchObject([
      { type: "error", code: "AUTHORIZATION_DENIED", message: "blocked by policy" },
    ]);
  });

  it("produces identical authorization receipts (principal id, action, outcome) to explicit per-call auth", async () => {
    const auth = namedAuth("alice");

    const directReceipts: AuthSecurityReceipt[] = [];
    const direct = receiptRegistry(directReceipts);
    registerFixtures(direct);
    await collect(direct.invoke("greet", {}, { ...bareCtx(), auth }));

    const boundReceipts: AuthSecurityReceipt[] = [];
    const bound = receiptRegistry(boundReceipts);
    registerFixtures(bound);
    await collect(bound.withPrincipal(auth).invoke("greet", {}, bareCtx()));

    // Both paths produce a tool.discover + tool.invoke authorization receipt,
    // both attributing "principal:alice", both "allow". requestId is the only
    // field that legitimately differs (each registry has its own counter).
    const strip = (rs: AuthSecurityReceipt[]) =>
      rs.map((r) => {
        const { requestId: _requestId, ...rest } = r;
        return rest;
      });
    expect(strip(boundReceipts)).toEqual(strip(directReceipts));
    expect(directReceipts).toHaveLength(2);
    for (const receipt of directReceipts) {
      expect(receipt.principalId).toBe("principal:alice");
      expect(receipt.kind).toBe("authorization");
      expect((receipt as { outcome: string }).outcome).toBe("allow");
    }
  });

  it("does not bleed auth state between two bound registries invoked interleaved", async () => {
    const receipts: AuthSecurityReceipt[] = [];
    const registry = receiptRegistry(receipts);
    registry.register({
      name: "slow-echo",
      description: "slow echo",
      input: passthrough(),
      handler: async (input, ctx) => {
        // Yield control mid-handler so the two concurrent invocations below
        // genuinely interleave rather than running back-to-back.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { data: { who: ctx.auth.principal.id, input } };
      },
    });

    const alice = registry.withPrincipal(namedAuth("alice"));
    const bob = registry.withPrincipal(namedAuth("bob"));

    const [aliceResult, bobResult] = await Promise.all([
      collect(alice.invoke("slow-echo", { tag: "a" }, bareCtx())),
      collect(bob.invoke("slow-echo", { tag: "b" }, bareCtx())),
    ]);

    expect(aliceResult).toEqual([
      { type: "result", data: { who: "principal:alice", input: { tag: "a" } }, display: undefined },
    ]);
    expect(bobResult).toEqual([
      { type: "result", data: { who: "principal:bob", input: { tag: "b" } }, display: undefined },
    ]);

    // Every recorded receipt attributes the invocation to the principal
    // that actually made it — no cross-contamination under concurrency.
    const invokeReceipts = receipts.filter(
      (r) => r.kind === "authorization" && r.action === "tool.invoke"
    );
    expect(invokeReceipts).toHaveLength(2);
    expect(invokeReceipts.map((r) => r.principalId).sort()).toEqual([
      "principal:alice",
      "principal:bob",
    ]);
  });

  it("a bound invoker sees a tool registered AFTER binding (dynamic, not a snapshot)", async () => {
    const registry = ownerRegistry();
    const bound = registry.withPrincipal(OWNER_AUTH);

    // Nothing registered yet — the tool doesn't exist from either view.
    const before = await collect(bound.invoke("late-tool", {}, bareCtx()));
    expect(before).toMatchObject([{ type: "error", code: "TOOL_NOT_FOUND" }]);

    // Register AFTER the bound invoker was created.
    registry.register({
      name: "late-tool",
      description: "registered after binding",
      input: passthrough(),
      handler: async () => ({ data: { ok: true } }),
    });

    const after = await collect(bound.invoke("late-tool", {}, bareCtx()));
    expect(after).toMatchObject([{ type: "result", data: { ok: true } }]);
  });
});
