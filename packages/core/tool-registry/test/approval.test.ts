import { describe, expect, it } from "vitest";

import { isToolTier, resolveApproval, tierRank } from "../src/approval.ts";
import type { ToolApproval } from "../src/approval.ts";

describe("isToolTier", () => {
  it("accepts the three tiers and rejects everything else", () => {
    expect(isToolTier("read")).toBe(true);
    expect(isToolTier("write")).toBe(true);
    expect(isToolTier("exec")).toBe(true);
    expect(isToolTier("admin")).toBe(false);
    expect(isToolTier(undefined)).toBe(false);
    expect(isToolTier(42)).toBe(false);
    expect(isToolTier({ tier: "read" })).toBe(false);
  });
});

describe("tierRank", () => {
  it("orders read < write < exec", () => {
    expect(tierRank("read")).toBeLessThan(tierRank("write"));
    expect(tierRank("write")).toBeLessThan(tierRank("exec"));
  });
});

describe("resolveApproval", () => {
  it("returns undefined for an undeclared approval (caller picks the default)", () => {
    expect(resolveApproval(undefined, {})).toBeUndefined();
  });

  it("normalizes a bare-string tier to { tier, override:false }", () => {
    expect(resolveApproval("read", {})).toEqual({ tier: "read", override: false });
    expect(resolveApproval("exec", {})).toEqual({ tier: "exec", override: false });
  });

  it("carries override + reason from the object form", () => {
    expect(
      resolveApproval({ tier: "exec", override: true, reason: "destructive" }, {}),
    ).toEqual({ tier: "exec", override: true, reason: "destructive" });
  });

  it("defaults override to false and omits an absent reason", () => {
    expect(resolveApproval({ tier: "write" }, {})).toEqual({ tier: "write", override: false });
  });

  it("evaluates the function form against the call args", () => {
    const approval: ToolApproval = (args) =>
      (args as { action?: string }).action === "rename" ? "write" : "read";
    expect(resolveApproval(approval, { action: "query" })).toEqual({
      tier: "read",
      override: false,
    });
    expect(resolveApproval(approval, { action: "rename" })).toEqual({
      tier: "write",
      override: false,
    });
  });

  it("supports a function returning the object form (per-arg escalation)", () => {
    const approval: ToolApproval = (args) => {
      const cmd = (args as { command?: string }).command ?? "";
      return cmd.includes("rm -rf")
        ? { tier: "exec", override: true, reason: "destructive rm" }
        : "read";
    };
    expect(resolveApproval(approval, { command: "ls" })).toEqual({
      tier: "read",
      override: false,
    });
    expect(resolveApproval(approval, { command: "rm -rf /" })).toEqual({
      tier: "exec",
      override: true,
      reason: "destructive rm",
    });
  });

  it("returns undefined (NOT a tier) when a function throws — caller fails safe", () => {
    const approval: ToolApproval = () => {
      throw new Error("boom");
    };
    expect(resolveApproval(approval, {})).toBeUndefined();
  });

  it("returns undefined for a malformed object (bad tier) — caller fails safe", () => {
    expect(resolveApproval({ tier: "admin" } as never, {})).toBeUndefined();
    expect(resolveApproval({} as never, {})).toBeUndefined();
  });

  it("returns undefined for a bare invalid string", () => {
    expect(resolveApproval("danger" as never, {})).toBeUndefined();
  });
});
