import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { resolveStableSessionId } from "../src/session-id.ts";

describe("resolveStableSessionId", () => {
  it("returns pi-cwd-<12-hex-chars> for a non-empty cwd", () => {
    const result = resolveStableSessionId({ cwd: "/some/dir" });
    expect(result).toMatch(/^pi-cwd-[0-9a-f]{12}$/);
  });

  it("two calls with the same cwd return the same id", () => {
    const a = resolveStableSessionId({ cwd: "/foo/bar" });
    const b = resolveStableSessionId({ cwd: "/foo/bar" });
    expect(a).toBe(b);
  });

  it("two calls with different cwds return different ids", () => {
    const a = resolveStableSessionId({ cwd: "/foo/bar" });
    const b = resolveStableSessionId({ cwd: "/foo/baz" });
    expect(a).not.toBe(b);
  });

  it("empty cwd falls back to pi-<pid> using the pid opt", () => {
    const result = resolveStableSessionId({ cwd: "", pid: 99999 });
    expect(result).toBe("pi-99999");
  });

  it("path canonicalization: /a/b/../c produces the same id as /a/c", () => {
    const canonical = resolve("/a/b/../c"); // resolves to /a/c on all platforms
    const withDotDot = resolveStableSessionId({ cwd: "/a/b/../c" });
    const direct = resolveStableSessionId({ cwd: "/a/c" });
    // Sanity-check that resolve actually normalized the path
    expect(canonical).toBe("/a/c");
    expect(withDotDot).toBe(direct);
  });

  it("digest matches sha256 of the canonical path", () => {
    const cwd = "/some/specific/dir";
    const expected = `pi-cwd-${createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12)}`;
    expect(resolveStableSessionId({ cwd })).toBe(expected);
  });
});
