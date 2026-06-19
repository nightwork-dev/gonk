import { beforeEach, describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import { ToolRegistry, type ToolDefinition, type ToolEvent } from "@gonk/tool-registry";
import { createOrchestrator } from "@gonk/tool-orchestrator";
import { MemoryScopeStore } from "@gonk/scope";

import {
  clearGonkTools,
  findGonkTool,
  listGonkTools,
  registerGonkTools,
  type PiExtensionAPI,
  type PiToolResult,
  type PiToolSpec,
  type PiToolUpdate,
} from "../src/index.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

class FakePi implements PiExtensionAPI {
  registered: PiToolSpec[] = [];
  registerTool(spec: PiToolSpec): void {
    this.registered.push(spec);
  }
}

describe("registerGonkTools", () => {
  it("registers each tool from a registry as a Pi tool", () => {
    const r = new ToolRegistry();
    r.register([
      {
        name: "echo",
        description: "echo input",
        input: passthrough(),
        inputJsonSchema: { type: "object", properties: { text: { type: "string" } } },
        handler: async (input: { text: string }) => ({ data: { echoed: input.text } }),
      },
      {
        name: "compute",
        description: "compute",
        input: passthrough(),
        handler: async () => ({ data: 1 }),
      },
    ] as ToolDefinition[]);

    const pi = new FakePi();
    const result = registerGonkTools({ pi, source: r });
    expect(result.registered).toEqual(["echo", "compute"]);
    expect(pi.registered).toHaveLength(2);
    expect(pi.registered[0]?.name).toBe("echo");
    expect(pi.registered[0]?.parameters).toMatchObject({
      type: "object",
      properties: { text: { type: "string" } },
    });
  });

  it("uses the orchestrator's activeSet when given an Orchestrator", async () => {
    const r = new ToolRegistry();
    r.register([
      { name: "always", description: "a", visibility: "always", input: passthrough(), handler: async () => ({ data: 1 }) },
      { name: "ondemand", description: "o", visibility: "on-demand", input: passthrough(), handler: async () => ({ data: 2 }) },
    ] as ToolDefinition[]);
    const orch = createOrchestrator({ registries: [r], scope: "pi", registerMetaTools: false });
    const pi = new FakePi();
    registerGonkTools({ pi, source: orch });
    expect(pi.registered.map((s) => s.name)).toEqual(["always"]);

    orch.pin("ondemand");
    await orch.commitPins();
    const pi2 = new FakePi();
    registerGonkTools({ pi: pi2, source: orch });
    expect(pi2.registered.map((s) => s.name).sort()).toEqual(["always", "ondemand"]);
  });

  it("skips duplex tools and reports them in skipped[]", () => {
    const r = new ToolRegistry();
    r.register([
      { name: "ok", description: "ok", input: passthrough(), handler: async () => ({ data: 1 }) },
      {
        name: "voice",
        description: "voice",
        input: passthrough(),
        capabilities: { duplex: true },
        handler: async () => ({ data: 2 }),
      },
    ] as ToolDefinition[]);
    const pi = new FakePi();
    const result = registerGonkTools({ pi, source: r });
    expect(result.registered).toEqual(["ok"]);
    expect(result.skipped[0]?.name).toBe("voice");
    expect(result.skipped[0]?.reason).toContain("duplex");
  });

  it("filter callback can exclude tools", () => {
    const r = new ToolRegistry();
    r.register([
      { name: "a", description: "a", input: passthrough(), handler: async () => ({ data: 1 }) },
      { name: "b", description: "b", input: passthrough(), handler: async () => ({ data: 2 }) },
    ] as ToolDefinition[]);
    const pi = new FakePi();
    registerGonkTools({ pi, source: r, filter: (t) => t.name !== "b" });
    expect(pi.registered.map((s) => s.name)).toEqual(["a"]);
  });

  it("execute() dispatches through the registry and returns content + details", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "say",
      description: "say",
      input: passthrough(),
      handler: async (input: { text: string }) => ({
        data: { said: input.text },
        display: `said: ${input.text}`,
      }),
    });
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const spec = pi.registered[0]!;
    const result = await spec.execute(
      "call-1",
      { text: "hi" },
      new AbortController().signal,
      undefined,
      undefined,
    );
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "said: hi" }]);
    expect(result.details).toEqual({ said: "hi" });
  });

  it("execute() forwards progress and data to onUpdate", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "stream",
      description: "stream",
      input: passthrough(),
      handler: async function* () {
        yield { type: "progress", message: "step-1" } as ToolEvent;
        yield { type: "data", chunk: { n: 1 } } as ToolEvent;
        yield { type: "result", data: { ok: true } } as ToolEvent;
      },
    });
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const updates: PiToolUpdate[] = [];
    await pi.registered[0]!.execute(
      "call",
      {},
      new AbortController().signal,
      (u) => updates.push(u),
      undefined,
    );
    const progressUpdate = updates.find(
      (u) => (u.details as { progress?: boolean; chunk?: unknown } | undefined)?.progress === true
        && !("chunk" in (u.details as object)),
    );
    expect(progressUpdate).toBeDefined();
    expect(progressUpdate!.content[0]).toEqual({ type: "text", text: "step-1" });
    expect((progressUpdate!.details as { message: string }).message).toBe("step-1");
    const dataUpdate = updates.find(
      (u) => (u.details as { chunk?: unknown } | undefined)?.chunk !== undefined,
    );
    expect(dataUpdate).toBeDefined();
    expect((dataUpdate!.details as { chunk: { n: number } }).chunk).toEqual({ n: 1 });
  });

  it("execute() returns isError content when the tool errors", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "boom",
      description: "boom",
      input: passthrough(),
      handler: async () => {
        throw new Error("kaboom");
      },
    });
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const result: PiToolResult = await pi.registered[0]!.execute(
      "call",
      {},
      new AbortController().signal,
      undefined,
      undefined,
    );
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("kaboom");
  });

  it("threads ctx.scope into handlers when scope is provided", async () => {
    const r = new ToolRegistry();
    let observed: unknown;
    r.register({
      name: "read-key",
      description: "read",
      input: passthrough(),
      handler: async (_i, ctx) => {
        observed = ctx.scope?.get("k");
        return { data: { observed } };
      },
    });
    const scope = new MemoryScopeStore();
    scope.set("k", "v-from-scope", "session");
    const pi = new FakePi();
    registerGonkTools({ pi, source: r, scope });
    await pi.registered[0]!.execute(
      "call",
      {},
      new AbortController().signal,
      undefined,
      undefined,
    );
    expect(observed).toBe("v-from-scope");
  });

  it("aborts the underlying tool when Pi's signal aborts", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "loop",
      description: "loop",
      input: passthrough(),
      handler: async function* (_i, ctx) {
        while (!ctx.signal.aborted) {
          yield { type: "progress", message: "tick" } as ToolEvent;
          await new Promise((res) => setTimeout(res, 20));
        }
        yield { type: "result", data: 0 } as ToolEvent;
      },
    });
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 25);
    const result = await pi.registered[0]!.execute(
      "call",
      {},
      ac.signal,
      undefined,
      undefined,
    );
    expect(result.isError).toBe(true);
  });

  it("renders mixed display blocks into Pi content", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "rich",
      description: "rich",
      input: passthrough(),
      handler: async () => ({
        data: { ok: true },
        display: [
          { type: "markdown" as const, markdown: "# title" },
          { type: "code" as const, language: "ts", code: "x" },
          { type: "image" as const, mimeType: "image/png", data: "BASE64" },
        ],
      }),
    });
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const result = await pi.registered[0]!.execute(
      "call",
      {},
      new AbortController().signal,
      undefined,
      undefined,
    );
    expect(result.content).toEqual([
      { type: "text", text: "# title" },
      { type: "text", text: "```ts\nx\n```" },
      { type: "image", mimeType: "image/png", data: "BASE64" },
    ]);
  });

  it("uses options.register when provided (pi-ext-kit ext.tool integration)", () => {
    const r = new ToolRegistry();
    r.register({
      name: "echo",
      description: "echo",
      input: passthrough(),
      handler: async () => ({ data: 1 }),
    });
    const pi = new FakePi();
    const captured: PiToolSpec[] = [];
    registerGonkTools({
      pi,
      source: r,
      register: (spec) => captured.push(spec),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.name).toBe("echo");
    // pi.registerTool should NOT have been called when register is provided
    expect(pi.registered).toHaveLength(0);
  });

  it("respects pi alias hints (hints.pi.piName)", () => {
    const r = new ToolRegistry();
    r.register({
      name: "internal-name",
      description: "x",
      input: passthrough(),
      hints: { pi: { piName: "public-name" } },
      handler: async () => ({ data: 1 }),
    });
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    expect(pi.registered[0]?.name).toBe("public-name");
    expect(pi.registered[0]?.label).toBe("internal-name");
  });
});

describe("process-wide gonk registry", () => {
  // Each test owns the process registry; clearing up front guarantees that.
  beforeEach(() => {
    clearGonkTools();
  });

  it("registerGonkTools mirrors each registered tool into the process registry", () => {
    const r = new ToolRegistry();
    r.register([
      {
        name: "alpha",
        description: "alpha tool",
        input: passthrough(),
        handler: async () => ({ data: 1 }),
      },
      {
        name: "beta",
        description: "beta tool",
        input: passthrough(),
        handler: async () => ({ data: 2 }),
      },
    ] as ToolDefinition[]);

    registerGonkTools({ pi: new FakePi(), source: r });
    const names = listGonkTools()
      .map((t) => t.name)
      .sort();
    expect(names).toContain("alpha");
    expect(names).toContain("beta");
    expect(findGonkTool("alpha")?.description).toBe("alpha tool");
  });

  it("does not record duplex/filtered tools (which were skipped)", () => {
    const r = new ToolRegistry();
    r.register([
      {
        name: "ok",
        description: "ok",
        input: passthrough(),
        handler: async () => ({ data: 1 }),
      },
      {
        name: "voice",
        description: "voice",
        input: passthrough(),
        capabilities: { duplex: true },
        handler: async () => ({ data: 2 }),
      },
      {
        name: "filtered",
        description: "filtered",
        input: passthrough(),
        handler: async () => ({ data: 3 }),
      },
    ] as ToolDefinition[]);

    registerGonkTools({
      pi: new FakePi(),
      source: r,
      filter: (t) => t.name !== "filtered",
    });

    expect(findGonkTool("ok")).toBeDefined();
    expect(findGonkTool("voice")).toBeUndefined();
    expect(findGonkTool("filtered")).toBeUndefined();
  });

  it("re-registration overwrites the prior entry (last-write-wins)", () => {
    const r1 = new ToolRegistry();
    r1.register({
      name: "shared",
      description: "v1",
      input: passthrough(),
      handler: async () => ({ data: 1 }),
    });
    registerGonkTools({ pi: new FakePi(), source: r1 });
    expect(findGonkTool("shared")?.description).toBe("v1");

    const r2 = new ToolRegistry();
    r2.register({
      name: "shared",
      description: "v2",
      input: passthrough(),
      handler: async () => ({ data: 2 }),
    });
    registerGonkTools({ pi: new FakePi(), source: r2 });
    expect(findGonkTool("shared")?.description).toBe("v2");
  });

  it("clearGonkTools empties the registry", () => {
    const r = new ToolRegistry();
    r.register({
      name: "ephemeral",
      description: "x",
      input: passthrough(),
      handler: async () => ({ data: 1 }),
    });
    registerGonkTools({ pi: new FakePi(), source: r });
    expect(findGonkTool("ephemeral")).toBeDefined();
    clearGonkTools();
    expect(findGonkTool("ephemeral")).toBeUndefined();
    expect(listGonkTools()).toHaveLength(0);
  });
});
