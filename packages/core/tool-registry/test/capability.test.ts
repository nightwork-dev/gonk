import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { ToolDefinition } from "../src/types.ts";

// =============================================================================
// Capability-degraded mode — type-shape check on ToolDefinition
// =============================================================================
//
// The substrate exposes `capabilityFor` + `degradedDescription` so host
// adapters (tool-registry-pi, MCP, etc.) can pick which description to
// advertise at registration time. The registry itself does not consume these
// fields — they are pure metadata for adapters. This test just pins the
// shape so a future refactor that drops or renames either field fails loudly
// here rather than silently in downstream packages.

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

describe("ToolDefinition — capability-degraded shape", () => {
  it("accepts capabilityFor + degradedDescription with the documented signatures", () => {
    const tool: ToolDefinition = {
      name: "shape_check",
      description: "Full.",
      degradedDescription: "Degraded.",
      capabilityFor: () => "full",
      input: passthrough(),
      handler: async () => ({ data: null }),
    };

    expect(tool.capabilityFor?.()).toBe("full");
    expect(tool.degradedDescription).toBe("Degraded.");
  });

  it("permits capabilityFor returning 'degraded'", () => {
    const tool: ToolDefinition = {
      name: "shape_check",
      description: "Full.",
      degradedDescription: "Degraded.",
      capabilityFor: () => "degraded",
      input: passthrough(),
      handler: async () => ({ data: null }),
    };

    expect(tool.capabilityFor?.()).toBe("degraded");
  });

  it("treats both fields as optional so legacy tools compile unchanged", () => {
    const tool: ToolDefinition = {
      name: "legacy",
      description: "No capability metadata.",
      input: passthrough(),
      handler: async () => ({ data: null }),
    };

    expect(tool.capabilityFor).toBeUndefined();
    expect(tool.degradedDescription).toBeUndefined();
  });
});
