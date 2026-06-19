import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { homedir } from "node:os";

import { sessionMemoryDbPath } from "../src/session-id.ts";

// Stash the original HOME so we can restore it after each test.
let originalHome: string | undefined;

beforeEach(() => {
  originalHome = process.env.HOME;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
});

describe("sessionMemoryDbPath", () => {
  it("returns the correct path with explicit homeRoot", () => {
    const result = sessionMemoryDbPath({
      homeRoot: "/foo/bar",
      sessionId: "pi-cwd-abc123def456",
      name: "triples",
    });
    expect(result).toBe(
      "/foo/bar/.agents/sessions/pi-cwd-abc123def456/memory/triples.db",
    );
  });

  it("appends .db suffix to the name", () => {
    const result = sessionMemoryDbPath({
      homeRoot: "/home/user",
      sessionId: "pi-cwd-000000000000",
      name: "cost-log",
    });
    expect(result).toBe(
      "/home/user/.agents/sessions/pi-cwd-000000000000/memory/cost-log.db",
    );
  });

  it("uses process.env.HOME when homeRoot is not provided and HOME is set", () => {
    process.env.HOME = "/env/home";
    const result = sessionMemoryDbPath({
      sessionId: "pi-cwd-abc123def456",
      name: "sessions",
    });
    expect(result).toBe(
      "/env/home/.agents/sessions/pi-cwd-abc123def456/memory/sessions.db",
    );
  });

  it("falls back to os.homedir() when process.env.HOME is unset", () => {
    delete process.env.HOME;
    const expected = `${homedir()}/.agents/sessions/pi-cwd-abc123/memory/triples.db`;
    const result = sessionMemoryDbPath({
      sessionId: "pi-cwd-abc123",
      name: "triples",
    });
    expect(result).toBe(expected);
  });

  it("treats empty-string HOME the same as homedir() (both empty on macOS when HOME='')", () => {
    // On macOS/Linux, os.homedir() itself reads HOME from the environment.
    // When HOME="" both process.env.HOME and homedir() return "". This is a
    // degenerate environment — there is no meaningful home to fall back to.
    // The important contract is that the implementation uses homedir(), not
    // process.cwd(). With both returning "", the result matches: it uses the
    // homedir() return value (even if degenerate).
    process.env.HOME = "";
    const fallback = homedir(); // also "" in this environment on macOS
    const result = sessionMemoryDbPath({
      sessionId: "pi-cwd-abc123",
      name: "triples",
    });
    // Result must match what we'd get by passing homedir() explicitly as homeRoot.
    const direct = sessionMemoryDbPath({
      homeRoot: fallback,
      sessionId: "pi-cwd-abc123",
      name: "triples",
    });
    expect(result).toBe(direct);
  });

  it("normalizes path segments: trailing slash on homeRoot is absorbed", () => {
    const withSlash = sessionMemoryDbPath({
      homeRoot: "/foo/bar/",
      sessionId: "pi-cwd-abc123",
      name: "triples",
    });
    const withoutSlash = sessionMemoryDbPath({
      homeRoot: "/foo/bar",
      sessionId: "pi-cwd-abc123",
      name: "triples",
    });
    expect(withSlash).toBe(withoutSlash);
  });

  it("normalizes .. segments in homeRoot", () => {
    const result = sessionMemoryDbPath({
      homeRoot: "/foo/baz/../bar",
      sessionId: "pi-cwd-abc123",
      name: "triples",
    });
    expect(result).toBe(
      "/foo/bar/.agents/sessions/pi-cwd-abc123/memory/triples.db",
    );
  });
});
