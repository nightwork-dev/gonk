import { describe, expect, it } from "vitest";
import { parseSubcommandArgs, stripVerb } from "../src/parse-args.ts";

describe("parseSubcommandArgs", () => {
  it("returns empty for empty input", () => {
    const r = parseSubcommandArgs("");
    expect(r.positional).toEqual([]);
    expect(r.flags).toEqual({});
    expect(r.raw).toBe("");
  });

  it("parses positionals in order", () => {
    const r = parseSubcommandArgs("foo bar baz");
    expect(r.positional).toEqual(["foo", "bar", "baz"]);
    expect(r.flags).toEqual({});
  });

  it("parses --key value flags", () => {
    const r = parseSubcommandArgs("--prompt cat --n 3");
    expect(r.flags).toEqual({ prompt: "cat", n: "3" });
    expect(r.positional).toEqual([]);
  });

  it("parses --flag with no value as boolean true", () => {
    const r = parseSubcommandArgs("--open --quality high");
    expect(r.flags).toEqual({ open: true, quality: "high" });
  });

  it("parses --flag at end as boolean true", () => {
    const r = parseSubcommandArgs("foo --verbose");
    expect(r.positional).toEqual(["foo"]);
    expect(r.flags).toEqual({ verbose: true });
  });

  it("groups single-quoted multi-word tokens", () => {
    const r = parseSubcommandArgs("'hello world' session");
    expect(r.positional).toEqual(["hello world", "session"]);
  });

  it("groups double-quoted multi-word tokens", () => {
    const r = parseSubcommandArgs('"a cat sitting" png');
    expect(r.positional).toEqual(["a cat sitting", "png"]);
  });

  it("preserves the raw string for free-text consumers", () => {
    const input = "hello   world  with   spacing";
    const r = parseSubcommandArgs(input);
    expect(r.raw).toBe(input);
  });

  it("mixes positionals, flags, and quoted strings", () => {
    const r = parseSubcommandArgs("--prompt 'a black cat' --quality high mypath");
    expect(r.positional).toEqual(["mypath"]);
    expect(r.flags).toEqual({ prompt: "a black cat", quality: "high" });
  });

  it("handles flag value that looks like another flag", () => {
    const r = parseSubcommandArgs("--first --second value");
    // First flag has no value (next token starts with --), so it's boolean.
    expect(r.flags).toEqual({ first: true, second: "value" });
  });
});

describe("stripVerb", () => {
  it("strips a single verb prefix and trims", () => {
    expect(stripVerb("instructions hello world", "instructions")).toBe(
      "hello world",
    );
  });

  it("strips a verb followed by no args", () => {
    expect(stripVerb("listen", "listen")).toBe("");
  });

  it("returns empty when input is just the verb", () => {
    expect(stripVerb("preset", "preset")).toBe("");
  });

  it("does not strip if verb is a prefix of a longer word", () => {
    expect(stripVerb("listening for input", "listen")).toBe(
      "listening for input",
    );
  });

  it("escapes regex metacharacters in the verb", () => {
    // Improbable, but make sure verb arg can't be interpreted as regex.
    expect(stripVerb("a.b foo", "a.b")).toBe("foo");
    expect(stripVerb("ab foo", "a.b")).toBe("ab foo");
  });
});
