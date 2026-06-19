import { describe, expect, it } from "vitest";

import { probePiModel } from "../src/probe-model.ts";

describe("probePiModel", () => {
  it("returns provider + id when ctx.model has both", () => {
    const r = probePiModel({ model: { provider: "anthropic", id: "claude-opus-4-8" } });
    expect(r).toEqual({ provider: "anthropic", id: "claude-opus-4-8" });
  });

  it("includes displayName when present and a string", () => {
    const r = probePiModel({
      model: { provider: "openai", id: "gpt-5.5", displayName: "GPT-5.5" },
    });
    expect(r).toEqual({ provider: "openai", id: "gpt-5.5", displayName: "GPT-5.5" });
  });

  it("omits displayName when it is not a string", () => {
    const r = probePiModel({ model: { provider: "p", id: "m", displayName: 42 } });
    expect(r).toEqual({ provider: "p", id: "m" });
    expect(r).not.toHaveProperty("displayName");
  });

  it("returns undefined when provider or id is missing (partial model)", () => {
    expect(probePiModel({ model: { provider: "p" } })).toBeUndefined();
    expect(probePiModel({ model: { id: "m" } })).toBeUndefined();
    expect(probePiModel({ model: { provider: 1, id: "m" } })).toBeUndefined();
  });

  it("returns undefined when ctx.model is absent or not an object", () => {
    expect(probePiModel({})).toBeUndefined();
    expect(probePiModel({ model: null })).toBeUndefined();
    expect(probePiModel({ model: "claude" })).toBeUndefined();
  });

  it("returns undefined for a non-object ctx (CLI/MCP hosts)", () => {
    expect(probePiModel(undefined)).toBeUndefined();
    expect(probePiModel(null)).toBeUndefined();
    expect(probePiModel("ctx")).toBeUndefined();
  });
});
