import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  ToolRegistry,
  makeBaseContext,
  type ToolDefinition,
  type ToolEvent,
} from "@gonk/tool-registry";

import { createOrchestrator } from "../src/index.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

function tool(name: string, opts: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: opts.description ?? `tool ${name}`,
    visibility: opts.visibility ?? "on-demand",
    input: passthrough(),
    handler: async () => ({ data: { name } }),
    ...(opts.tags ? { tags: opts.tags } : {}),
    ...(opts.keywords ? { keywords: opts.keywords } : {}),
    ...(opts.category ? { category: opts.category } : {}),
  };
}

async function collect(stream: AsyncIterable<ToolEvent>): Promise<ToolEvent[]> {
  const out: ToolEvent[] = [];
  for await (const e of stream) out.push(e);
  return out;
}

describe("Orchestrator", () => {
  it("activeSet returns always-tools sorted by name plus committed pins", async () => {
    const r = new ToolRegistry();
    r.register([
      tool("z-always", { visibility: "always" }),
      tool("a-always", { visibility: "always" }),
      tool("b-ondemand", { visibility: "on-demand" }),
      tool("c-ondemand", { visibility: "on-demand" }),
    ]);
    const orch = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });

    expect(orch.activeSet().map((t) => t.name)).toEqual(["a-always", "z-always"]);

    orch.pin("c-ondemand");
    orch.pin("b-ondemand");
    expect(orch.activeSet().map((t) => t.name)).toEqual(["a-always", "z-always"]);

    await orch.commitPins();
    expect(orch.activeSet().map((t) => t.name)).toEqual([
      "a-always",
      "z-always",
      "c-ondemand",
      "b-ondemand",
    ]);
  });

  it("unpin tombstones a committed pin until next commit", async () => {
    const r = new ToolRegistry();
    r.register([
      tool("a", { visibility: "on-demand" }),
      tool("b", { visibility: "on-demand" }),
    ]);
    const orch = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });

    orch.pin("a");
    orch.pin("b");
    await orch.commitPins();
    expect(orch.activeSet().map((t) => t.name)).toEqual(["a", "b"]);

    orch.unpin("a");
    // Still active until commit.
    expect(orch.activeSet().map((t) => t.name)).toEqual(["a", "b"]);

    const diff = await orch.commitPins();
    expect(diff.tombstoned).toEqual(["a"]);
    expect(orch.activeSet().map((t) => t.name)).toEqual(["b"]);
  });

  it("re-pinning an unpinned tool cancels the tombstone", async () => {
    const r = new ToolRegistry();
    r.register(tool("a", { visibility: "on-demand" }));
    const orch = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });

    orch.pin("a");
    await orch.commitPins();
    orch.unpin("a");
    orch.pin("a");
    await orch.commitPins();
    expect(orch.activeSet().map((t) => t.name)).toEqual(["a"]);
  });

  it("respects per-adapter visibility hints", () => {
    const r = new ToolRegistry();
    r.register({
      ...tool("hybrid"),
      visibility: "on-demand",
      hints: { mcp: { visibility: "always" }, pi: { visibility: "on-demand" } },
    });
    const mcp = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });
    const pi = createOrchestrator({ registries: [r], scope: "pi", registerMetaTools: false });
    expect(mcp.activeSet().map((t) => t.name)).toEqual(["hybrid"]);
    expect(pi.activeSet().map((t) => t.name)).toEqual([]);
  });

  it("default search ranks name matches highest", () => {
    const r = new ToolRegistry();
    r.register([
      // "todo" is a standalone name token here (name weight 3×)
      tool("todo", { keywords: ["create", "task"], tags: ["tasks"] }),
      // "todo" only appears in description/tags (body weight 1×)
      tool("tasklist", { description: "manage todo items", tags: ["todo"] }),
      tool("watch-clock"),
    ]);
    const orch = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });
    const results = orch.search("todo");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.tool.name).toBe("todo"); // name token match wins over body match
  });

  it("recommend skips already-active tools", () => {
    const r = new ToolRegistry();
    r.register([
      tool("a", { keywords: ["alpha"] }),
      tool("b", { keywords: ["alpha"] }),
    ]);
    const orch = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });
    const results = orch.recommend({ recentText: ["mention alpha"], activeTools: ["a"] });
    expect(results.map((r) => r.tool.name)).toEqual(["b"]);
  });

  it("registers meta-tools by default and they execute", async () => {
    const r = new ToolRegistry();
    r.register([
      tool("a-thing", { visibility: "on-demand", description: "the a thing" }),
    ]);
    const orch = createOrchestrator({ registries: [r], scope: "mcp" });

    expect(r.has("list_tools")).toBe(true);
    expect(r.has("find_tools")).toBe(true);
    expect(r.has("load_tool")).toBe(true);
    expect(r.has("unload_tool")).toBe(true);
    expect(r.has("get_tool")).toBe(true);

    const events = await collect(orch.invoke("find_tools", { query: "thing" }, makeBaseContext()));
    const result = events.find((e) => e.type === "result");
    expect(result).toBeDefined();
    const data = (result as { data: { results: { name: string }[] } }).data;
    expect(data.results.some((r) => r.name === "a-thing")).toBe(true);
  });

  it("load_tool meta-tool queues a pin that activates after commit", async () => {
    const r = new ToolRegistry();
    r.register(tool("payload", { visibility: "on-demand" }));
    const orch = createOrchestrator({ registries: [r], scope: "mcp" });

    await collect(orch.invoke("load_tool", { name: "payload" }, makeBaseContext()));
    expect(orch.activeSet().map((t) => t.name)).not.toContain("payload");

    await orch.commitPins();
    expect(orch.activeSet().map((t) => t.name)).toContain("payload");
  });

  it("invokes pinStore.save on commit", async () => {
    const r = new ToolRegistry();
    r.register(tool("a", { visibility: "on-demand" }));
    const saved: string[][] = [];
    const orch = createOrchestrator({
      registries: [r],
      scope: "pi",
      registerMetaTools: false,
      pinStore: {
        load: () => [],
        save: (pins) => {
          saved.push(pins.slice());
        },
      },
    });

    orch.pin("a");
    await orch.commitPins();
    expect(saved).toEqual([["a"]]);
  });

  it("loads persisted pins on construction", () => {
    const r = new ToolRegistry();
    r.register(tool("persisted", { visibility: "on-demand" }));
    const orch = createOrchestrator({
      registries: [r],
      scope: "pi",
      registerMetaTools: false,
      pinStore: { load: () => ["persisted"], save: () => {} },
    });
    expect(orch.activeSet().map((t) => t.name)).toEqual(["persisted"]);
  });

  it("markUsed records timestamps reachable via usedSince", async () => {
    const r = new ToolRegistry();
    r.register(tool("a", { visibility: "always" }));
    const orch = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });
    const before = Date.now();
    orch.markUsed("a");
    expect(orch.usedSince(before - 1)).toContain("a");
    expect(orch.usedSince(Date.now() + 1000)).not.toContain("a");
  });

  it("orchestrator.invoke routes through the registry it found", async () => {
    const r1 = new ToolRegistry();
    r1.register(tool("only-in-1"));
    const r2 = new ToolRegistry();
    r2.register(tool("only-in-2"));
    const orch = createOrchestrator({
      registries: [r1, r2],
      scope: "mcp",
      registerMetaTools: false,
    });

    const events = await collect(orch.invoke("only-in-2", {}, makeBaseContext()));
    expect(events[0]).toMatchObject({ type: "result", data: { name: "only-in-2" } });
  });
});

describe("tool_explain meta-tool", () => {
  it("returns a structured record including cost, latency, capabilities, and inputJsonSchema", async () => {
    const r = new ToolRegistry();
    const richJsonSchema: Record<string, unknown> = {
      type: "object",
      properties: { foo: { type: "string" } },
      required: ["foo"],
      additionalProperties: false,
    };
    r.register({
      name: "rich-tool",
      description: "A rich tool with all metadata.",
      visibility: "on-demand",
      category: "rlm",
      cost: "high",
      latency: "minutes",
      tags: ["expensive", "rlm"],
      keywords: ["query", "synthesize"],
      relatedTo: ["other-tool"],
      capabilities: { readsFs: true, network: true, longRunning: true },
      hints: { mcp: { annotations: { readOnly: true } } },
      input: passthrough(),
      inputJsonSchema: richJsonSchema,
      handler: async () => ({ data: {} }),
    });
    const orch = createOrchestrator({ registries: [r], scope: "mcp" });
    expect(r.has("tool_explain")).toBe(true);

    const events = await collect(
      orch.invoke("tool_explain", { name: "rich-tool" }, makeBaseContext()),
    );
    const result = events.find((e) => e.type === "result");
    expect(result).toBeDefined();
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.name).toBe("rich-tool");
    expect(data.description).toBe("A rich tool with all metadata.");
    expect(data.visibility).toBe("on-demand");
    expect(data.category).toBe("rlm");
    expect(data.cost).toBe("high");
    expect(data.latency).toBe("minutes");
    expect(data.tags).toEqual(["expensive", "rlm"]);
    expect(data.keywords).toEqual(["query", "synthesize"]);
    expect(data.relatedTo).toEqual(["other-tool"]);
    expect(data.capabilities).toEqual({ readsFs: true, network: true, longRunning: true });
    expect(data.hints).toEqual({ mcp: { annotations: { readOnly: true } } });
    expect(data.inputJsonSchema).toEqual(richJsonSchema);
  });

  it("returns { error: 'TOOL_NOT_FOUND' } for an unknown name", async () => {
    const r = new ToolRegistry();
    r.register(tool("known"));
    const orch = createOrchestrator({ registries: [r], scope: "mcp" });

    const events = await collect(
      orch.invoke("tool_explain", { name: "no-such-tool" }, makeBaseContext()),
    );
    const result = events.find((e) => e.type === "result");
    expect(result).toBeDefined();
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data).toEqual({ error: "TOOL_NOT_FOUND" });
  });

  it("omits absent optional fields rather than emitting undefined", async () => {
    const r = new ToolRegistry();
    r.register(tool("plain", { description: "A plain tool with minimal metadata." }));
    const orch = createOrchestrator({ registries: [r], scope: "mcp" });

    const events = await collect(
      orch.invoke("tool_explain", { name: "plain" }, makeBaseContext()),
    );
    const result = events.find((e) => e.type === "result");
    const data = (result as { data: Record<string, unknown> }).data;
    expect(data.name).toBe("plain");
    expect("cost" in data).toBe(false);
    expect("latency" in data).toBe(false);
    expect("capabilities" in data).toBe(false);
    expect("inputJsonSchema" in data).toBe(false);
  });

  it("reports the effective visibility (resolves per-adapter hints)", async () => {
    const r = new ToolRegistry();
    r.register({
      ...tool("hybrid"),
      visibility: "on-demand",
      hints: { mcp: { visibility: "always" } },
    });
    const orch = createOrchestrator({ registries: [r], scope: "mcp" });

    const events = await collect(
      orch.invoke("tool_explain", { name: "hybrid" }, makeBaseContext()),
    );
    const result = events.find((e) => e.type === "result");
    const data = (result as { data: Record<string, unknown> }).data;
    // Effective visibility under mcp scope is "always" (the hint).
    expect(data.visibility).toBe("always");
  });
});
