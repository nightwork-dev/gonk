import { describe, expect, it } from "vitest";

import { safeJoin, safeKeyPath } from "../src/path.ts";

const ROOT = "/srv/app";

describe("safeJoin", () => {
  it("resolves a normal relative path under the root", () => {
    expect(safeJoin(ROOT, "a/b.txt")).toBe("/srv/app/a/b.txt");
  });
  it("returns the root itself for an empty/`.` rel", () => {
    expect(safeJoin(ROOT, ".")).toBe(ROOT);
  });
  it("normalizes internal `..` that stays inside the root", () => {
    expect(safeJoin(ROOT, "a/../b")).toBe("/srv/app/b");
  });
  it("collapses a trailing separator on the root", () => {
    expect(safeJoin("/srv/app/", "x")).toBe("/srv/app/x");
  });
  it("throws on traversal past the root", () => {
    expect(() => safeJoin(ROOT, "../../etc/passwd")).toThrow(/escapes root/);
  });
  it("throws on an absolute rel", () => {
    expect(() => safeJoin(ROOT, "/etc/passwd")).toThrow(/escapes root/);
  });
  it("throws on a backslash-absolute rel", () => {
    expect(() => safeJoin(ROOT, "\\etc")).toThrow(/escapes root/);
  });
  it("treats backslashes as separators when judging traversal", () => {
    expect(() => safeJoin(ROOT, "..\\..\\x")).toThrow(/escapes root/);
  });
});

describe("safeKeyPath", () => {
  it("places a key under root/subdir", () => {
    expect(safeKeyPath(ROOT, "blobs", "k/v.bin")).toBe("/srv/app/blobs/k/v.bin");
  });
  it("collapses doubled separators", () => {
    expect(safeKeyPath(ROOT, "blobs", "a//b")).toBe("/srv/app/blobs/a/b");
  });
  it("rejects an absolute key", () => {
    expect(() => safeKeyPath(ROOT, "blobs", "/abs")).toThrow(/must be relative/);
  });
  it("rejects a traversing key", () => {
    expect(() => safeKeyPath(ROOT, "blobs", "../escape")).toThrow(/escapes root/);
  });
});
