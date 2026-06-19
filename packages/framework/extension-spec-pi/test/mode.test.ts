import { describe, expect, it } from "vitest";

import { isInteractiveMode } from "../src/index.ts";

describe("isInteractiveMode", () => {
  it("treats tui and rpc as interactive — a user can answer", () => {
    expect(isInteractiveMode("tui")).toBe(true);
    expect(isInteractiveMode("rpc")).toBe(true);
  });

  it("treats headless one-shot modes (json/print) as non-interactive", () => {
    expect(isInteractiveMode("json")).toBe(false);
    expect(isInteractiveMode("print")).toBe(false);
  });

  it("treats absence (older pi without ctx.mode) as interactive — preserves prior behavior", () => {
    expect(isInteractiveMode(undefined)).toBe(true);
  });
});
