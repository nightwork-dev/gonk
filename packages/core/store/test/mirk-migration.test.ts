import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BackedBlobStore,
  BackedKvStore,
  BackedLogStore,
  BackedVectorStore,
  FsStoreBackend,
  MirkStoreBackend,
} from "../src/index.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-mirk-migration-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface LogRec {
  seq: number;
  kind: string;
}

function seedLegacyFsNamespace() {
  const backend = new FsStoreBackend(dir);
  const kv = new BackedKvStore<unknown>(backend);
  const blob = new BackedBlobStore(backend);
  const log = new BackedLogStore<LogRec>(backend);
  const vector = new BackedVectorStore(backend);

  kv.set("kv.plain", { ok: true });
  kv.set("kv.ttl", "still alive", { ttlMs: 60 * 60 * 1000 });
  kv.set("kv.expired", "already gone", { ttlMs: -60 * 1000 });
  const ttlEntry = backend.kvGet("kv.ttl");
  expect(ttlEntry?.expiresAt).toEqual(expect.any(Number));

  const logRecords: LogRec[] = [
    { seq: 0, kind: "first" },
    { seq: 1, kind: "second" },
    { seq: 2, kind: "third" },
  ];
  const logOffsets = logRecords.map((record) => log.append(record));

  const blobBytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  blob.put("nested/payload.bin", blobBytes, { mimeType: "application/octet-stream" });

  vector.upsert("vec-a", [1, 0, 0], { label: "a", group: "seed" });
  vector.upsert("vec-b", [0.5, 0.5, 0], { label: "b", group: "seed" });

  return { blobBytes, logOffsets, logRecords, ttlExpiresAt: ttlEntry!.expiresAt };
}

describe("MirkStoreBackend legacy FsStoreBackend migration", () => {
  it("copy-forwards every legacy facet once without deleting fs files", () => {
    const seeded = seedLegacyFsNamespace();
    const legacyPaths = [
      join(dir, "kv.json"),
      join(dir, "log.jsonl"),
      join(dir, "vectors.jsonl"),
      join(dir, "blobs", "nested", "payload.bin"),
      join(dir, "blobs", "nested", "payload.bin.mime"),
    ];
    for (const path of legacyPaths) expect(existsSync(path)).toBe(true);

    const firstBackend = new MirkStoreBackend(dir);
    const firstKv = new BackedKvStore<unknown>(firstBackend);
    const firstBlob = new BackedBlobStore(firstBackend);
    const firstLog = new BackedLogStore<LogRec>(firstBackend);
    const firstVector = new BackedVectorStore(firstBackend);

    expect(firstKv.get("kv.plain")).toEqual({ ok: true });
    expect(firstKv.get("kv.ttl")).toBe("still alive");
    expect(firstBackend.kvGet("kv.ttl")?.expiresAt).toBe(seeded.ttlExpiresAt);
    expect(firstKv.get("kv.expired")).toBeUndefined();
    expect(firstKv.list()).toEqual(["kv.plain", "kv.ttl"]);

    expect(firstLog.scan()).toEqual(seeded.logRecords);
    expect(firstLog.readAt(seeded.logOffsets[1]!)).toEqual({ seq: 1, kind: "second" });

    expect(firstBlob.get("nested/payload.bin")).toEqual(seeded.blobBytes);
    expect(firstBlob.list()).toEqual(["nested/payload.bin"]);

    const firstMatches = firstVector.search([1, 0, 0], 10);
    expect(firstMatches.map((m) => m.id)).toEqual(["vec-a", "vec-b"]);
    expect(firstMatches[0]!.meta).toEqual({ label: "a", group: "seed" });

    firstBackend.close();

    const secondBackend = new MirkStoreBackend(dir);
    const secondKv = new BackedKvStore<unknown>(secondBackend);
    const secondBlob = new BackedBlobStore(secondBackend);
    const secondLog = new BackedLogStore<LogRec>(secondBackend);
    const secondVector = new BackedVectorStore(secondBackend);

    expect(secondKv.list()).toEqual(["kv.plain", "kv.ttl"]);
    expect(secondLog.scan()).toEqual(seeded.logRecords);
    expect(secondLog.scan()).toHaveLength(seeded.logRecords.length);
    expect(secondBlob.list()).toEqual(["nested/payload.bin"]);
    expect(secondVector.search([1, 0, 0], 10).map((m) => m.id)).toEqual(["vec-a", "vec-b"]);

    for (const path of legacyPaths) expect(existsSync(path)).toBe(true);
    secondBackend.close();
  });

  it("leaves a fresh namespace empty and working", () => {
    const backend = new MirkStoreBackend(dir);
    const kv = new BackedKvStore<string>(backend);
    const blob = new BackedBlobStore(backend);
    const log = new BackedLogStore<{ ok: boolean }>(backend);
    const vector = new BackedVectorStore(backend);

    expect(kv.list()).toEqual([]);
    expect(blob.list()).toEqual([]);
    expect(log.scan()).toEqual([]);
    expect(vector.search([1, 0], 5)).toEqual([]);

    kv.set("fresh", "ok");
    blob.put("fresh.bin", new Uint8Array([9, 8, 7]));
    const offset = log.append({ ok: true });
    vector.upsert("fresh-vec", [1, 0], { fresh: true });

    expect(kv.get("fresh")).toBe("ok");
    expect(blob.get("fresh.bin")).toEqual(new Uint8Array([9, 8, 7]));
    expect(log.readAt(offset)).toEqual({ ok: true });
    expect(vector.search([1, 0], 1)[0]?.meta).toEqual({ fresh: true });

    backend.close();
  });
});
