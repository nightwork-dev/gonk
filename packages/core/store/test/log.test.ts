import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BackedLogStore, FsStoreBackend } from "../src/index.ts";

interface Rec {
  i: number;
  kind: string;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-log-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function log() {
  return new BackedLogStore<Rec>(new FsStoreBackend(dir));
}

describe("LogStore", () => {
  it("append N, scan with a filter, readAt a known offset", () => {
    const store = log();
    const offsets: number[] = [];
    for (let i = 0; i < 5; i++) {
      offsets.push(store.append({ i, kind: i % 2 === 0 ? "even" : "odd" }));
    }
    // offsets strictly increase
    expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
    expect(new Set(offsets).size).toBe(5);

    expect(store.scan().length).toBe(5);
    expect(store.scan((r) => r.kind === "even")).toEqual([
      { i: 0, kind: "even" },
      { i: 2, kind: "even" },
      { i: 4, kind: "even" },
    ]);

    // readAt resolves a known offset back to its record
    expect(store.readAt(offsets[3]!)).toEqual({ i: 3, kind: "odd" });
    expect(store.readAt(offsets[0]!)).toEqual({ i: 0, kind: "even" });
    // out-of-range offset returns undefined
    expect(store.readAt(999_999)).toBeUndefined();
  });

  it("rejects a non-serializable record instead of writing an unparseable line", () => {
    const store = new BackedLogStore<unknown>(new FsStoreBackend(dir));
    // JSON.stringify(undefined) === undefined, and a bare function/symbol too —
    // writing these would put a literal "undefined" line in the JSONL.
    expect(() => store.append(undefined)).toThrow(/not JSON-serializable/);
    expect(() => store.append(() => 1)).toThrow(/not JSON-serializable/);
    // A valid append still lands, and the log has no corrupt line.
    store.append({ ok: true });
    expect(store.scan()).toEqual([{ ok: true }]);
  });

  it("persists across a fresh store reopened from the same dir", () => {
    const a = log();
    const off = a.append({ i: 42, kind: "even" });
    const b = new BackedLogStore<Rec>(new FsStoreBackend(dir));
    expect(b.scan()).toEqual([{ i: 42, kind: "even" }]);
    expect(b.readAt(off)).toEqual({ i: 42, kind: "even" });
  });
});
