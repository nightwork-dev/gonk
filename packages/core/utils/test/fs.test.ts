import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWriteBytes, atomicWriteJson, atomicWriteText } from "../src/fs.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-utils-fs-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("atomic writes", () => {
  it("writes text and creates parent dirs", () => {
    const p = join(dir, "nested/deep/file.txt");
    atomicWriteText(p, "hello");
    expect(readFileSync(p, "utf8")).toBe("hello");
  });
  it("writes bytes", () => {
    const p = join(dir, "b.bin");
    atomicWriteBytes(p, new Uint8Array([1, 2, 3]));
    expect([...readFileSync(p)]).toEqual([1, 2, 3]);
  });
  it("writes pretty JSON with a trailing newline", () => {
    const p = join(dir, "x.json");
    atomicWriteJson(p, { b: 1, a: 2 });
    const raw = readFileSync(p, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(JSON.parse(raw)).toEqual({ b: 1, a: 2 });
  });
  it("leaves no temp files behind", () => {
    const p = join(dir, "y.txt");
    atomicWriteText(p, "v");
    expect(readdirSync(dir).filter((f) => f.includes(".tmp."))).toEqual([]);
  });
});
