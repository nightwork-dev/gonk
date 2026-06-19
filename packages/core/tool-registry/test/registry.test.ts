import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import { MemoryScopeStore } from "@gonk/scope";

import {
  ToolError,
  ToolRegistry,
  inMemorySink,
  makeBaseContext,
  type ToolDefinition,
  type ToolEvent,
} from "../src/index.ts";

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
  it("invokes a sync tool and emits result", async () => {
    const r = new ToolRegistry();
    const tool: ToolDefinition<{ text: string }, { echoed: string }> = {
      name: "echo",
      description: "echo",
      input: requireString(),
      handler: async (input) => ({ data: { echoed: input.text } }),
    };
    r.register(tool);
    const events = await collect(r.invoke("echo", { text: "hi" }, makeBaseContext()));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "result", data: { echoed: "hi" } });
  });

  it("validates input and emits INVALID_INPUT on failure", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "echo",
      description: "echo",
      input: requireString(),
      handler: async () => ({ data: null }),
    });
    const events = await collect(r.invoke("echo", { wrong: 1 }, makeBaseContext()));
    expect(events[0]).toMatchObject({ type: "error", code: "INVALID_INPUT" });
  });

  it("emits TOOL_NOT_FOUND for missing tools", async () => {
    const r = new ToolRegistry();
    const events = await collect(r.invoke("ghost", {}, makeBaseContext()));
    expect(events[0]).toMatchObject({ type: "error", code: "TOOL_NOT_FOUND" });
  });

  it("converts ToolError throws into error events", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "boom",
      description: "boom",
      input: passthrough(),
      handler: async () => {
        throw new ToolError("BOOM", "kaboom");
      },
    });
    const events = await collect(r.invoke("boom", {}, makeBaseContext()));
    expect(events[0]).toMatchObject({ type: "error", code: "BOOM", message: "kaboom" });
  });

  it("propagates streaming events from async iterable handlers", async () => {
    const r = new ToolRegistry();
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
    const events = await collect(r.invoke("stream", {}, makeBaseContext()));
    expect(events).toHaveLength(3);
    expect(events[0]?.type).toBe("progress");
    expect(events[2]).toMatchObject({ type: "result", data: { ok: true } });
  });

  it("aborts a streaming handler when signal fires", async () => {
    const r = new ToolRegistry();
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
    const ctx = { ...makeBaseContext({ signal: ac.signal }) };
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
    const r = new ToolRegistry({ metrics: sink });
    r.register({
      name: "ok",
      description: "ok",
      input: passthrough(),
      handler: async () => ({ data: 1 }),
    });
    await collect(r.invoke("ok", {}, makeBaseContext()));
    const snap = sink.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.outcome).toBe("ok");
    expect(snap[0]?.tool).toBe("ok");
  });

  it("validates output strictly", async () => {
    const r = new ToolRegistry();
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
    const events = await collect(r.invoke("bad-out", {}, makeBaseContext()));
    expect(events[0]).toMatchObject({ type: "error", code: "OUTPUT_INVALID" });
  });

  it("supports cross-tool composition via ctx.invoke", async () => {
    const r = new ToolRegistry();
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
    const events = await collect(r.invoke("outer", {}, makeBaseContext()));
    expect(events[0]).toMatchObject({
      type: "result",
      data: { outer: true, inner: { inner: 42 } },
    });
  });

  it("detects cycles in cross-tool composition", async () => {
    const r = new ToolRegistry();
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
    const events = await collect(r.invoke("a", {}, makeBaseContext()));
    expect(events[0]).toMatchObject({ type: "result", data: { error: "CYCLE" } });
  });

  it("exposes ctx.input to duplex tools and is undefined when no input given", async () => {
    const r = new ToolRegistry();
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

    const ctx = { ...makeBaseContext(), input: inputStream };
    const events = await collect(r.invoke("duplex", {}, ctx));
    expect(events[0]).toMatchObject({ type: "result", data: { hadInput: true, count: 2 } });
    expect(seen).toHaveLength(2);
    expect((seen[0] as { type: string }).type).toBe("audio");
    expect((seen[1] as { type: string }).type).toBe("control");
  });

  it("does not forward parent's ctx.input to child tools via ctx.invoke", async () => {
    const r = new ToolRegistry();
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
    const ctx = { ...makeBaseContext(), input: inputStream };
    const events = await collect(r.invoke("parent", {}, ctx));
    expect(events[0]).toMatchObject({ type: "result", data: { childSawInput: false } });
  });

  it("threads ctx.scope to handlers and forwards to children via ctx.invoke", async () => {
    const r = new ToolRegistry();
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
    const ctx = { ...makeBaseContext(), scope };
    await collect(r.invoke("parent", {}, ctx));
    expect(seen.parent).toBe("v-from-persona");
    expect(seen.child).toBe("v-from-persona");
  });

  it("merges and extracts registries", async () => {
    const a = new ToolRegistry();
    a.register({ name: "x", description: "x", input: passthrough(), handler: async () => ({ data: 1 }) });
    const b = new ToolRegistry();
    b.register({ name: "y", description: "y", input: passthrough(), handler: async () => ({ data: 2 }) });
    const merged = a.merge(b);
    expect(merged.list().map((t) => t.name).sort()).toEqual(["x", "y"]);

    const sub = merged.extract(["y"]);
    expect(sub.list().map((t) => t.name)).toEqual(["y"]);
  });

  it("skips tools whose `requires` predicate returns false", () => {
    const r = new ToolRegistry();
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
