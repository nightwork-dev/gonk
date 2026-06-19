import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { Logger, ToolDefinition } from "@gonk/tool-registry";

import { ToolRegistry } from "@gonk/tool-registry";

import { toAgentTool, resolveAdvertisedDescription } from "../src/to-agent-tool.ts";
import {
  registerGonkTools,
  type PiExtensionAPI,
  type PiToolSpec,
} from "../src/index.ts";

class FakePi implements PiExtensionAPI {
  registered: PiToolSpec[] = [];
  registerTool(spec: PiToolSpec): void {
    this.registered.push(spec);
  }
}

// =============================================================================
// Capability-degraded mode — adapter resolves which description to advertise
// =============================================================================

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
    name: "degradable_tool",
    description: "Full-capability description.",
    input: passthrough(),
    handler: async () => ({ data: 1 }),
    ...overrides,
  };
}

function makeCapturingLogger(): Logger & { warnings: { msg: string; meta?: unknown }[] } {
  const warnings: { msg: string; meta?: unknown }[] = [];
  return {
    debug: () => {},
    info: () => {},
    warn: (msg, meta) => warnings.push({ msg, meta }),
    error: () => {},
    warnings,
  };
}

describe("resolveAdvertisedDescription — capability-state predicate", () => {
  it("uses tool.description when capabilityFor returns 'full'", () => {
    const tool = makeTool({
      degradedDescription: "Degraded description.",
      capabilityFor: () => "full",
    });
    expect(resolveAdvertisedDescription(tool)).toBe("Full-capability description.");
  });

  it("uses degradedDescription when capabilityFor returns 'degraded'", () => {
    const tool = makeTool({
      degradedDescription: "Degraded description.",
      capabilityFor: () => "degraded",
    });
    expect(resolveAdvertisedDescription(tool)).toBe("Degraded description.");
  });

  it("falls back to description when capabilityFor returns 'degraded' but no degradedDescription is set", () => {
    const tool = makeTool({
      capabilityFor: () => "degraded",
    });
    expect(resolveAdvertisedDescription(tool)).toBe("Full-capability description.");
  });

  it("logs a warn and falls back to description when capabilityFor throws", () => {
    const log = makeCapturingLogger();
    const tool = makeTool({
      degradedDescription: "Degraded description.",
      capabilityFor: () => {
        throw new Error("predicate boom");
      },
    });
    expect(resolveAdvertisedDescription(tool, log)).toBe("Full-capability description.");
    expect(log.warnings).toHaveLength(1);
    expect(log.warnings[0]!.msg).toContain("degradable_tool");
    expect(log.warnings[0]!.msg).toContain("capabilityFor");
  });

  it("returns description when no capabilityFor is set (legacy tools unchanged)", () => {
    const tool = makeTool({});
    expect(resolveAdvertisedDescription(tool)).toBe("Full-capability description.");
  });
});

describe("toAgentTool — degraded description integration", () => {
  it("uses full description when capabilityFor() returns 'full', with cost/latency hints appended to it", () => {
    const tool = makeTool({
      degradedDescription: "Degraded description.",
      capabilityFor: () => "full",
      cost: "low",
      latency: "instant",
    });
    const agent = toAgentTool(tool);
    expect(agent.description).toBe(
      "Full-capability description. Cost: low. Latency: instant.",
    );
  });

  it("uses degraded description when capabilityFor() returns 'degraded', with cost/latency hints appended to it", () => {
    const tool = makeTool({
      degradedDescription: "Degraded description.",
      capabilityFor: () => "degraded",
      cost: "low",
      latency: "instant",
    });
    const agent = toAgentTool(tool);
    expect(agent.description).toBe(
      "Degraded description. Cost: low. Latency: instant.",
    );
  });

  it("falls back to full description with hints appended when capabilityFor throws", () => {
    const tool = makeTool({
      degradedDescription: "Degraded description.",
      capabilityFor: () => {
        throw new Error("nope");
      },
      cost: "low",
    });
    const agent = toAgentTool(tool);
    expect(agent.description).toBe("Full-capability description. Cost: low.");
  });
});

describe("registerGonkTools — degraded description integration", () => {
  it("advertises the degraded description through the Pi tool spec when capabilityFor returns 'degraded'", () => {
    const r = new ToolRegistry();
    r.register([
      makeTool({
        name: "degradable",
        degradedDescription: "Degraded description.",
        capabilityFor: () => "degraded",
        cost: "low",
      }),
    ]);
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    expect(pi.registered).toHaveLength(1);
    expect(pi.registered[0]?.description).toBe("Degraded description. Cost: low.");
  });

  it("advertises the full description through the Pi tool spec when capabilityFor returns 'full'", () => {
    const r = new ToolRegistry();
    r.register([
      makeTool({
        name: "degradable",
        degradedDescription: "Degraded description.",
        capabilityFor: () => "full",
        cost: "low",
      }),
    ]);
    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    expect(pi.registered[0]?.description).toBe("Full-capability description. Cost: low.");
  });
});
