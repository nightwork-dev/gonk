import { describe, it, expect } from "vitest";
import { argvToRawArgs } from "../src/dispatch.ts";

describe("argvToRawArgs", () => {
  it("joins simple positional args", () => {
    expect(argvToRawArgs(["gen", "a", "cat"])).toBe("gen a cat");
  });

  it("re-quotes args containing spaces", () => {
    expect(argvToRawArgs(["gen", "a cat"])).toBe(`gen 'a cat'`);
  });

  it("preserves flags", () => {
    expect(argvToRawArgs(["gen", "a cat", "--n", "3"])).toBe(`gen 'a cat' --n 3`);
  });

  it("wraps args containing single quotes in double quotes", () => {
    expect(argvToRawArgs(["gen", "it's hot"])).toBe(`gen "it's hot"`);
  });

  it("returns empty string for empty argv", () => {
    expect(argvToRawArgs([])).toBe("");
  });

  it("preserves boolean flags", () => {
    expect(argvToRawArgs(["set", "key", "--clear"])).toBe("set key --clear");
  });

  it("throws when arg contains both single and double quotes", () => {
    expect(() => argvToRawArgs(['it\'s "hot"'])).toThrow(/cannot represent/);
  });
});
