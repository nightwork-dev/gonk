import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { canonicalPath } from "../src/canonical-path.ts";
import { canonical } from "../src/resolver.ts";
import { resolveSessionId, resolveStableSessionId } from "../src/session-id.ts";

describe("resolveSessionId", () => {
  it("returns a non-empty explicit id unchanged", () => {
    expect(resolveSessionId({ explicitId: "018f2f78-0000-7000-8000-real-session" })).toBe(
      "018f2f78-0000-7000-8000-real-session",
    );
  });

  it("falls back to a unique pi-<pid>-<uuid> id when no explicit id exists", () => {
    const a = resolveSessionId({ pid: 4242 });
    const b = resolveSessionId({ pid: 4242 });

    expect(a).toMatch(/^pi-4242-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(b).toMatch(/^pi-4242-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(a).not.toBe(b);
  });
});

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

  it("unifies a real directory and a symlink to it", () => {
    const root = mkdtempSync(join(tmpdir(), "gonk-session-id-symlink-"));
    const realDir = join(root, "real");
    const symlinkPath = join(root, "link");
    try {
      mkdirSync(realDir);
      symlinkSync(realDir, symlinkPath, process.platform === "win32" ? "junction" : "dir");

      expect(resolveStableSessionId({ cwd: realDir })).toBe(
        resolveStableSessionId({ cwd: symlinkPath }),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("unifies differently-cased paths on case-insensitive filesystems", () => {
    if (process.platform !== "darwin" && process.platform !== "win32") return;

    const realDir = mkdtempSync(join(tmpdir(), "GonkSessionCase-"));
    try {
      const parent = dirname(realDir);
      const name = basename(realDir);
      const swappedName = [...name]
        .map((ch) => {
          const upper = ch.toUpperCase();
          const lower = ch.toLowerCase();
          return ch === upper ? lower : upper;
        })
        .join("");
      const differentlyCased = join(parent, swappedName);

      if (!existsSync(differentlyCased)) return;
      const realStat = statSync(realDir);
      const casedStat = statSync(differentlyCased);
      if (realStat.dev !== casedStat.dev || realStat.ino !== casedStat.ino) return;

      expect(resolveStableSessionId({ cwd: realDir })).toBe(
        resolveStableSessionId({ cwd: differentlyCased }),
      );
    } finally {
      rmSync(realDir, { recursive: true, force: true });
    }
  });

  it("canonicalPath falls back to path.resolve for non-existent paths without throwing", () => {
    const cwd = join(tmpdir(), `gonk-session-id-missing-${process.pid}-${Date.now()}`);
    expect(existsSync(cwd)).toBe(false);

    expect(canonicalPath(cwd)).toBe(resolve(cwd));
  });

  it("falls back to path.resolve for non-existent paths without throwing", () => {
    const cwd = join(tmpdir(), `gonk-session-id-missing-${process.pid}-${Date.now()}`);
    expect(existsSync(cwd)).toBe(false);

    const a = resolveStableSessionId({ cwd });
    const b = resolveStableSessionId({ cwd });

    expect(a).toMatch(/^pi-cwd-[0-9a-f]{12}$/);
    expect(a).toBe(b);
    expect(a).toBe(
      `pi-cwd-${createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 12)}`,
    );
  });

  it("session ids and resolver homes share the same canonical path helper", () => {
    const cwd = mkdtempSync(join(tmpdir(), "gonk-shared-canonical-"));
    try {
      const fromResolver = canonical(cwd);
      const fromSharedHelper = canonicalPath(cwd);
      expect(fromResolver).toBe(fromSharedHelper);
      expect(resolveStableSessionId({ cwd })).toBe(
        `pi-cwd-${createHash("sha256").update(fromResolver).digest("hex").slice(0, 12)}`,
      );
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
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
