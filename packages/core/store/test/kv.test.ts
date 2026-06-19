import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BackedKvStore, FsStoreBackend } from "../src/index.ts";
import type { KvEntry, StoreBackend } from "../src/index.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-kv-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function kv<T>() {
  return new BackedKvStore<T>(new FsStoreBackend(dir));
}

describe("KvStore", () => {
  it("set/get/delete round-trip", () => {
    const store = kv<{ n: number }>();
    expect(store.get("a")).toBeUndefined();
    store.set("a", { n: 1 });
    expect(store.get("a")).toEqual({ n: 1 });
    store.delete("a");
    expect(store.get("a")).toBeUndefined();
  });

  it("patch shallow-merges into the stored object", () => {
    const store = kv<{ a?: number; b?: number }>();
    store.set("k", { a: 1 });
    store.patch("k", { b: 2 });
    expect(store.get("k")).toEqual({ a: 1, b: 2 });
    // patch a missing key starts from {}
    store.patch("fresh", { a: 9 });
    expect(store.get("fresh")).toEqual({ a: 9 });
  });

  it("patch rejects a non-plain-object base (array and the typeof-null footgun)", () => {
    const store = kv();
    store.set("arr", [1, 2, 3]);
    expect(() => store.patch("arr", { a: 1 } as never)).toThrow(/not a plain object/);

    // `typeof null === "object"` — the array/non-object guard alone let null
    // slip through; the plain-object guard catches it.
    store.set("nul", null);
    expect(() => store.patch("nul", { a: 1 } as never)).toThrow(/not a plain object/);
  });

  it("patch guard rejects a class instance held in memory", () => {
    // The FS backend round-trips through JSON, so a class instance read back is
    // already a plain object — the class-instance leak only bites an in-memory
    // backend. Exercise the guard directly against such a backend.
    class Box {
      constructor(public n = 1) {}
    }
    const inMemory = new Map<string, KvEntry>();
    const backend: StoreBackend = {
      kvGet: (k) => inMemory.get(k),
      kvSet: (k, e) => void inMemory.set(k, e),
      kvDelete: (k) => void inMemory.delete(k),
      kvEntries: () => [...inMemory.entries()].map(([key, entry]) => ({ key, entry })),
      blobPut() {},
      blobGet: () => undefined,
      blobDelete() {},
      blobList: () => [],
      logAppend: () => 0,
      logScan: () => [],
      logReadAt: () => undefined,
      vectorUpsert() {},
      vectorSearch: () => [],
      vectorDelete() {},
    };
    const store = new BackedKvStore<unknown>(backend);
    store.set("inst", new Box());
    expect(() => store.patch("inst", { a: 1 } as never)).toThrow(/not a plain object/);
  });

  it("list returns sorted keys, prefix-filterable", () => {
    const store = kv<number>();
    store.set("user.b", 1);
    store.set("user.a", 2);
    store.set("other", 3);
    expect(store.list()).toEqual(["other", "user.a", "user.b"]);
    expect(store.list("user.")).toEqual(["user.a", "user.b"]);
  });

  it("entries returns key/value pairs in one read, sorted + prefix-filterable", () => {
    const store = kv<number>();
    store.set("user.b", 1);
    store.set("user.a", 2);
    store.set("other", 3);
    expect(store.entries()).toEqual([
      { key: "other", value: 3 },
      { key: "user.a", value: 2 },
      { key: "user.b", value: 1 },
    ]);
    expect(store.entries("user.")).toEqual([
      { key: "user.a", value: 2 },
      { key: "user.b", value: 1 },
    ]);
  });

  it("entries excludes (and prunes) an expired TTL entry", () => {
    const store = kv<string>();
    store.set("keep", "v", { ttlMs: 60_000 });
    store.set("gone", "v", { ttlMs: -1 });
    expect(store.entries().map((e) => e.key)).toEqual(["keep"]);
  });

  it("persists across a fresh store reopened from the same dir", () => {
    const a = kv<string>();
    a.set("x", "hello");
    const b = new BackedKvStore<string>(new FsStoreBackend(dir));
    expect(b.get("x")).toBe("hello");
  });

  it("expires a TTL entry: read returns undefined and prunes", () => {
    const store = kv<string>();
    store.set("temp", "v", { ttlMs: -1 }); // already expired
    expect(store.get("temp")).toBeUndefined();
    // pruned from the underlying backend, so list no longer reports it
    expect(store.list()).toEqual([]);
  });

  it("keeps a non-expired TTL entry", () => {
    const store = kv<string>();
    store.set("temp", "v", { ttlMs: 60_000 });
    expect(store.get("temp")).toBe("v");
    expect(store.list()).toEqual(["temp"]);
  });
});
