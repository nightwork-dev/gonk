import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { ToolDefinition } from "@gonk/tool-registry";

import { toAgentTool } from "../src/to-agent-tool.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

function makeTool(overrides: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: "test_tool",
    description: "Base description.",
    input: passthrough(),
    handler: async () => ({ data: 1 }),
    ...overrides,
  };
}

describe("toAgentTool — cost / latency hints", () => {
  it("appends 'Cost: <class>' when only `cost` is set", () => {
    const tool = makeTool({ cost: "high" });
    const agent = toAgentTool(tool);
    expect(agent.description).toBe("Base description. Cost: high.");
  });

  it("appends 'Latency: <class>' when only `latency` is set", () => {
    const tool = makeTool({ latency: "minutes" });
    const agent = toAgentTool(tool);
    expect(agent.description).toBe("Base description. Latency: minutes.");
  });

  it("appends both 'Cost: <class>. Latency: <class>.' when both are set", () => {
    const tool = makeTool({ cost: "high", latency: "minutes" });
    const agent = toAgentTool(tool);
    expect(agent.description).toBe("Base description. Cost: high. Latency: minutes.");
  });

  it("leaves the description unchanged when neither field is set", () => {
    const tool = makeTool({});
    const agent = toAgentTool(tool);
    expect(agent.description).toBe("Base description.");
  });

  it("handles a description not ending in a period (adds the separator)", () => {
    const tool = makeTool({
      description: "No trailing period",
      cost: "low",
      latency: "instant",
    });
    const agent = toAgentTool(tool);
    expect(agent.description).toBe(
      "No trailing period. Cost: low. Latency: instant.",
    );
  });

  it("handles every cost/latency combination cleanly", () => {
    const costs = ["low", "moderate", "high"] as const;
    const latencies = ["instant", "seconds", "minutes"] as const;
    for (const cost of costs) {
      for (const latency of latencies) {
        const tool = makeTool({ cost, latency, description: "X." });
        const agent = toAgentTool(tool);
        expect(agent.description).toBe(`X. Cost: ${cost}. Latency: ${latency}.`);
      }
    }
  });
});

describe("toAgentTool — parameters schema", () => {
  it("falls back to a permissive object schema when the ToolDefinition has no inputJsonSchema", () => {
    // A ToolDefinition may carry only a Standard Schema validator and no
    // JSON Schema. The converter must still hand pi-agent-core a `parameters`
    // object — an undefined `parameters` makes pi-agent-core never serialize
    // the tool, so the model never sees it (the cause of a past "0 iterations"
    // bug). typebox's Type.Object yields the minimal `type: "object"` shape.
    const tool = makeTool({ name: "echo-no-schema" }); // makeTool sets no inputJsonSchema
    const converted = toAgentTool(tool);
    expect(converted.parameters).toBeDefined();
    expect((converted.parameters as { type?: string }).type).toBe("object");
  });

  it("passes the declared inputJsonSchema through as parameters when present", () => {
    const inputJsonSchema = {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    };
    const tool = makeTool({ name: "echo", inputJsonSchema });
    const converted = toAgentTool(tool);
    expect(converted.parameters).toEqual(inputJsonSchema);
  });
});
