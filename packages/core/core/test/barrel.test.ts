import { describe, expect, it } from "vitest";

import * as core from "../src/index.ts";

// The barrel is pure re-exports, so the failure mode is a broken/renamed
// re-export silently dropping a symbol. These assert the headline surface is
// present AND that a re-exported primitive actually works end-to-end.

describe("@gonk/core barrel", () => {
  it("re-exports the tool-registry surface", () => {
    expect(typeof core.ToolRegistry).toBe("function");
    expect(typeof core.makeBaseContext).toBe("function");
    expect(typeof core.shape).toBe("function");
    expect(typeof core.passthrough).toBe("function");
    expect(typeof core.ToolError).toBe("function");
  });

  it("re-exports the scope surface", () => {
    expect(typeof core.createScope).toBe("function");
    expect(typeof core.FsScopeStore).toBe("function");
    expect(typeof core.MemoryScopeStore).toBe("function");
    expect(typeof core.resolveTierHomes).toBe("function");
    expect(typeof core.substrateDir).toBe("function");
    expect(Array.isArray(core.SCOPE_RESOLUTION_ORDER)).toBe(true);
  });

  it("a re-exported ToolRegistry is functional, not just present", () => {
    const reg = new core.ToolRegistry();
    reg.register({
      name: "ping",
      description: "barrel smoke test",
      input: core.passthrough(),
      inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => ({ data: { ok: true } }),
    });
    expect(reg.list().map((t) => t.name)).toContain("ping");
  });
});
