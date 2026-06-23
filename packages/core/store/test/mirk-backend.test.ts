import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BackedBlobStore,
  BackedKvStore,
  BackedLogStore,
  BackedVectorStore,
  MirkStoreBackend,
} from "../src/index.ts";
import { mirkStoreDbPath } from "../src/mirk-backend.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-mirk-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function kv<T>() {
  return new BackedKvStore<T>(new MirkStoreBackend(dir));
}

function blob() {
  return new BackedBlobStore(new MirkStoreBackend(dir));
}

interface Rec {
  i: number;
  kind: string;
}

function log() {
  return new BackedLogStore<Rec>(new MirkStoreBackend(dir));
}

function vector() {
  return new BackedVectorStore(new MirkStoreBackend(dir));
}

function bruteForceCosine(a: number[], b: number[]): number {
  let dot = 0;
  let an = 0;
  let bn = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
    an += (a[i] ?? 0) ** 2;
    bn += (b[i] ?? 0) ** 2;
  }
  if (an === 0 || bn === 0) return 0;
  return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

const vectorCorpus: Array<{ id: string; vector: number[] }> = [
  { id: "a", vector: [1, 0, 0, 0] },
  { id: "b", vector: [0.9, 0.1, 0, 0] },
  { id: "c", vector: [0, 1, 0, 0] },
  { id: "d", vector: [0.5, 0.5, 0.5, 0.5] },
  { id: "e", vector: [-1, 0, 0, 0] },
  { id: "f", vector: [0.2, 0.8, 0.1, 0] },
  { id: "g", vector: [0, 0, 1, 0] },
  { id: "h", vector: [0.7, 0.7, 0, 0] },
];

describe("MirkStoreBackend parity", () => {
  it("uses a real sqlite db file and persists across a fresh backend (anti-cheat)", () => {
    const a = new BackedKvStore<string>(new MirkStoreBackend(dir));
    a.set("x", "hello");

    const dbPath = mirkStoreDbPath(dir);
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath).subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");
    expect(existsSync(join(dir, "mirk-store.json"))).toBe(false);

    const b = new BackedKvStore<string>(new MirkStoreBackend(dir));
    expect(b.get("x")).toBe("hello");
  });

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
      store.patch("fresh", { a: 9 });
      expect(store.get("fresh")).toEqual({ a: 9 });
    });

    it("patch rejects a non-plain-object base (array and the typeof-null footgun)", () => {
      const store = kv();
      store.set("arr", [1, 2, 3]);
      expect(() => store.patch("arr", { a: 1 } as never)).toThrow(/not a plain object/);
      store.set("nul", null);
      expect(() => store.patch("nul", { a: 1 } as never)).toThrow(/not a plain object/);
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
      const b = new BackedKvStore<string>(new MirkStoreBackend(dir));
      expect(b.get("x")).toBe("hello");
    });

    it("expires a TTL entry: read returns undefined and prunes", () => {
      const store = kv<string>();
      store.set("temp", "v", { ttlMs: -1 });
      expect(store.get("temp")).toBeUndefined();
      expect(store.list()).toEqual([]);
    });

    it("keeps a non-expired TTL entry", () => {
      const store = kv<string>();
      store.set("temp", "v", { ttlMs: 60_000 });
      expect(store.get("temp")).toBe("v");
      expect(store.list()).toEqual(["temp"]);
    });
  });

  describe("BlobStore", () => {
    it("put/get/delete/list round-trip", () => {
      const store = blob();
      const bytes = new Uint8Array([1, 2, 3, 4]);
      expect(store.get("a")).toBeUndefined();
      store.put("a", bytes);
      expect(store.get("a")).toEqual(bytes);
      store.put("nested/b", new Uint8Array([9]), { mimeType: "application/octet-stream" });
      expect(store.list()).toEqual(["a", "nested/b"]);
      expect(store.list("nested/")).toEqual(["nested/b"]);
      store.delete("a");
      expect(store.get("a")).toBeUndefined();
      expect(store.list()).toEqual(["nested/b"]);
    });

    it("persists across a fresh store reopened from the same dir", () => {
      const a = blob();
      a.put("portrait", new Uint8Array([7, 7, 7]));
      const b = new BackedBlobStore(new MirkStoreBackend(dir));
      expect(b.get("portrait")).toEqual(new Uint8Array([7, 7, 7]));
    });
  });

  describe("LogStore", () => {
    it("append N, scan with a filter, readAt a known offset", () => {
      const store = log();
      const offsets: number[] = [];
      for (let i = 0; i < 5; i++) {
        offsets.push(store.append({ i, kind: i % 2 === 0 ? "even" : "odd" }));
      }
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
      expect(new Set(offsets).size).toBe(5);
      expect(store.scan().length).toBe(5);
      expect(store.scan((r) => r.kind === "even")).toEqual([
        { i: 0, kind: "even" },
        { i: 2, kind: "even" },
        { i: 4, kind: "even" },
      ]);
      expect(store.readAt(offsets[3]!)).toEqual({ i: 3, kind: "odd" });
      expect(store.readAt(offsets[0]!)).toEqual({ i: 0, kind: "even" });
      expect(store.readAt(999_999)).toBeUndefined();
    });

    it("rejects a non-serializable record instead of writing an unparseable line", () => {
      const store = new BackedLogStore<unknown>(new MirkStoreBackend(dir));
      expect(() => store.append(undefined)).toThrow(/not JSON-serializable/);
      expect(() => store.append(() => 1)).toThrow(/not JSON-serializable/);
      store.append({ ok: true });
      expect(store.scan()).toEqual([{ ok: true }]);
    });

    it("persists across a fresh store reopened from the same dir", () => {
      const a = log();
      const off = a.append({ i: 42, kind: "even" });
      const b = new BackedLogStore<Rec>(new MirkStoreBackend(dir));
      expect(b.scan()).toEqual([{ i: 42, kind: "even" }]);
      expect(b.readAt(off)).toEqual({ i: 42, kind: "even" });
    });
  });

  describe("VectorStore — KNN parity with brute-force JS cosine", () => {
    it("top-k ranking equals the brute-force baseline", () => {
      const store = vector();
      for (const e of vectorCorpus) store.upsert(e.id, e.vector, { tag: e.id });
      const query = [0.8, 0.2, 0, 0];
      const k = 4;
      const queryForMirk = Array.from(Float32Array.from(query));
      const baseline = vectorCorpus
        .map((e) => ({
          id: e.id,
          score: bruteForceCosine(queryForMirk, Array.from(Float32Array.from(e.vector))),
        }))
        .sort((x, y) => y.score - x.score || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
        .slice(0, k);
      const got = store.search(query, k);
      expect(got.map((m) => m.id)).toEqual(baseline.map((b) => b.id));
      for (let i = 0; i < got.length; i++) {
        expect(got[i]!.score).toBeCloseTo(baseline[i]!.score, 12);
      }
    });

    it("honors a metadata filter and returns meta", () => {
      const store = vector();
      store.upsert("keep1", [1, 0, 0, 0], { keep: true });
      store.upsert("drop", [0.99, 0.01, 0, 0], { keep: false });
      store.upsert("keep2", [0.9, 0.1, 0, 0], { keep: true });
      const got = store.search([1, 0, 0, 0], 5, (meta) => meta.keep === true);
      expect(got.map((m) => m.id)).toEqual(["keep1", "keep2"]);
      expect(got[0]!.meta).toEqual({ keep: true });
    });

    it("upsert overwrites, delete removes, and persists across reopen", () => {
      const a = vector();
      a.upsert("x", [1, 0, 0, 0], { v: 1 });
      a.upsert("x", [0, 1, 0, 0], { v: 2 });
      a.upsert("y", [0, 0, 1, 0]);
      a.delete("y");
      const b = new BackedVectorStore(new MirkStoreBackend(dir));
      const all = b.search([0, 1, 0, 0], 10);
      expect(all.map((m) => m.id)).toEqual(["x"]);
      expect(all[0]!.meta).toEqual({ v: 2 });
    });
  });
});
