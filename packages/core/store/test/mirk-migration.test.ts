import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MemoryScopeStore } from "@gonk/scope";
import type { SyncStore } from "@mirk/store";
import { SqliteAdapter } from "@mirk/store/sqlite";

import {
  BackedBlobStore,
  BackedKvStore,
  BackedLogStore,
  BackedVectorStore,
  bindGonkSyncState,
  FsStoreBackend,
} from "../src/index.ts";
import {
  importLegacyFsStore,
  inspectLegacyFsSource,
  LEGACY_BLOBS_COLLECTION,
  LEGACY_LOG_COLLECTION,
  LEGACY_META_COLLECTION,
  LEGACY_TTL_COLLECTION,
  LEGACY_VECTOR_COLLECTION,
  LegacyImportConflictError,
} from "../src/legacy-import.ts";
import { MirkStoreBackend } from "../src/mirk-backend.ts";

const storePackageVersion = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };
const mirkStorePackageVersion = JSON.parse(
  readFileSync(new URL("../node_modules/@mirk/store/package.json", import.meta.url), "utf8"),
) as { version: string };

let root: string;
let sourceDir: string;
let destinationPath: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gonk-store-explicit-migration-"));
  sourceDir = join(root, "legacy-source");
  destinationPath = join(root, "destination.db");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

interface LogRec {
  seq: number;
  kind: string;
}

function seedLegacyFsNamespace() {
  const backend = new FsStoreBackend(sourceDir);
  const kv = new BackedKvStore<unknown>(backend);
  const blob = new BackedBlobStore(backend);
  const log = new BackedLogStore<LogRec>(backend);
  const vector = new BackedVectorStore(backend);

  kv.set("kv.plain", { ok: true });
  kv.set("kv.ttl", "still alive", { ttlMs: 60 * 60 * 1000 });
  kv.set("kv.expired", "already gone", { ttlMs: -60 * 1000 });

  const logRecords: LogRec[] = [
    { seq: 0, kind: "first" },
    { seq: 1, kind: "second" },
    { seq: 2, kind: "third" },
  ];
  logRecords.forEach((record) => log.append(record));

  const blobBytes = new Uint8Array([0, 1, 2, 127, 128, 255]);
  blob.put("nested/payload.bin", blobBytes, { mimeType: "application/octet-stream" });

  vector.upsert("vec-a", [1, 0, 0], { label: "a", group: "seed" });
  vector.upsert("vec-b", [0.5, 0.5, 0], { label: "b", group: "seed" });

  const kvPath = join(sourceDir, "kv.json");
  const kvJson = JSON.parse(readFileSync(kvPath, "utf8")) as Record<string, unknown>;
  kvJson["kv.invalid"] = { value: "bad expiry", expiresAt: "tomorrow" };
  writeFileSync(kvPath, JSON.stringify(kvJson, null, 2));
  appendFileSync(join(sourceDir, "log.jsonl"), "{not-json}\n");
  appendFileSync(
    join(sourceDir, "vectors.jsonl"),
    `${JSON.stringify({ id: "vec-invalid", vector: ["not-a-number"], meta: {} })}\n`,
  );

  return { blobBytes, logRecords };
}

function destination(adapter: SqliteAdapter) {
  const scope = new MemoryScopeStore();
  const state = bindGonkSyncState(scope, {
    kv: () => adapter.kv,
    vector: () => adapter.vector,
  });
  return {
    state,
    options: {
      kind: "gonk-state" as const,
      state,
      tier: "global" as const,
      namespace: "legacy-fixture",
      identity: "test-sqlite",
      runExclusive: <T>(work: () => T) => adapter.transaction(work, "immediate"),
    },
  };
}

describe("explicit legacy FsStoreBackend importer", () => {
  const countOrZero = (count: () => number): number => {
    try {
      return count();
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("no such table:")) return 0;
      throw error;
    }
  };

  it("dry-runs, imports every valid family, reports invalid data, preserves source, and reruns as a no-op", () => {
    const seeded = seedLegacyFsNamespace();
    const before = inspectLegacyFsSource(sourceDir);
    const adapter = new SqliteAdapter({
      path: destinationPath,
      dimensions: 3,
    });

    try {
      const bound = destination(adapter);
      const dryRun = importLegacyFsStore({
        sourceDir,
        destination: bound.options,
        mode: "dry-run",
        packageVersions: { source: "0.4.0" },
      });
      expect(dryRun.status).toBe("dry-run");
      expect(dryRun.counts.kv).toMatchObject({
        discovered: 4,
        eligible: 2,
        written: 0,
        skipped: 1,
        invalid: 1,
      });
      expect(dryRun.counts.blob).toMatchObject({ discovered: 1, eligible: 1, written: 0 });
      expect(dryRun.counts.log).toMatchObject({
        discovered: 4,
        eligible: 3,
        written: 0,
        invalid: 1,
      });
      expect(dryRun.counts.vector).toMatchObject({
        discovered: 3,
        eligible: 2,
        written: 0,
        invalid: 1,
      });
      expect(bound.state.kv("global", "legacy-fixture").keys()).toEqual([]);
      expect(inspectLegacyFsSource(sourceDir)).toEqual(before);

      const applied = importLegacyFsStore({
        sourceDir,
        destination: bound.options,
        mode: "write",
        packageVersions: { source: "0.4.0" },
      });
      expect(applied.status).toBe("applied");
      expect(applied.counts.kv.written).toBe(2);
      expect(applied.counts.blob.written).toBe(1);
      expect(applied.counts.log.written).toBe(3);
      expect(applied.counts.vector.written).toBe(2);
      expect(applied.invalid).toHaveLength(3);
      expect(applied.skipped).toHaveLength(1);
      expect(applied.packages.source.version).toBe("0.4.0");
      expect(applied.packages.importer.version).toBe(storePackageVersion.version);
      expect(applied.packages.destination.version).toBe(mirkStorePackageVersion.version);
      expect(JSON.stringify(applied)).not.toContain(sourceDir);
      expect(applied.destination).toMatchObject({
        identity: "test-sqlite",
        tier: "global",
        namespace: "legacy-fixture",
        kvBackend: "sqlite",
        vectorBackend: "sqlite",
      });

      const stateKv = bound.state.kv("global", "legacy-fixture");
      expect(stateKv.get("kv.plain")).toEqual({ ok: true });
      expect(stateKv.has("kv.ttl")).toBe(false);
      expect(
        stateKv.getById(LEGACY_TTL_COLLECTION, "kv.ttl"),
      ).toMatchObject({ value: "still alive", expiresAt: expect.any(Number) });
      expect(stateKv.has("kv.expired")).toBe(false);
      expect(stateKv.has("kv.invalid")).toBe(false);

      const blob = stateKv.getById<{
        bytesBase64: string;
        mimeType: string;
        sha256: string;
      }>(LEGACY_BLOBS_COLLECTION, "nested/payload.bin");
      expect(Buffer.from(blob!.bytesBase64, "base64")).toEqual(Buffer.from(seeded.blobBytes));
      expect(blob!.mimeType).toBe("application/octet-stream");
      expect(blob!.sha256).toMatch(/^[a-f0-9]{64}$/);

      expect(
        stateKv
          .list<{ offset: number; record: LogRec }>(LEGACY_LOG_COLLECTION, {
            sortBy: "offset",
          })
          .map((entry) => entry.record),
      ).toEqual(seeded.logRecords);
      expect(
        bound.state
          .vector("global", "legacy-fixture")
          .get(LEGACY_VECTOR_COLLECTION, "vec-a"),
      ).toMatchObject({ id: "vec-a", metadata: { label: "a", group: "seed" } });

      const second = importLegacyFsStore({
        sourceDir,
        destination: bound.options,
        mode: "write",
        packageVersions: { source: "0.4.0" },
      });
      expect(second.status).toBe("already-imported");
      expect(second.priorReceiptSha256).toBe(applied.receiptSha256);
      expect(Object.values(second.counts).every((counts) => counts.written === 0)).toBe(true);
      expect(second.counts.kv.identical).toBe(2);
      expect(second.counts.blob.identical).toBe(1);
      expect(second.counts.log.identical).toBe(3);
      expect(second.counts.vector.identical).toBe(2);
      expect(
        stateKv.list(LEGACY_META_COLLECTION, {
          where: { id: applied.markerId },
        }),
      ).toHaveLength(1);
      expect(() =>
        importLegacyFsStore({
          sourceDir,
          destination: bound.options,
          mode: "write",
          packageVersions: { source: "9.9.9" },
        }),
      ).toThrow(LegacyImportConflictError);

      const stored = stateKv.getById<{ id: string; receipt: typeof applied }>(
        LEGACY_META_COLLECTION,
        applied.markerId,
      )!;
      stateKv.put(LEGACY_META_COLLECTION, {
        ...stored,
        receipt: { ...stored.receipt, receiptSha256: "0".repeat(64) },
      });
      expect(() =>
        importLegacyFsStore({
          sourceDir,
          destination: bound.options,
          mode: "write",
          packageVersions: { source: "0.4.0" },
        }),
      ).toThrow(LegacyImportConflictError);
      expect(inspectLegacyFsSource(sourceDir)).toEqual(before);
    } finally {
      adapter.close();
    }
  });

  it("refuses an ambiguous destination conflict before writing any other family", () => {
    seedLegacyFsNamespace();
    const before = inspectLegacyFsSource(sourceDir);
    const adapter = new SqliteAdapter({
      path: destinationPath,
      dimensions: 3,
    });
    adapter.kv.set("kv.plain", { conflicting: true });

    try {
      expect(() =>
        importLegacyFsStore({
          sourceDir,
          destination: {
            kind: "mirk-ports",
            kv: adapter.kv,
            vector: adapter.vector,
            namespace: "raw-legacy",
            identity: "conflict-fixture",
            runExclusive: <T>(work: () => T) => adapter.transaction(work, "immediate"),
          },
          mode: "write",
          packageVersions: { source: "0.4.0" },
        }),
      ).toThrow(LegacyImportConflictError);
      expect(adapter.kv.get("kv.plain")).toEqual({ conflicting: true });
      expect(countOrZero(() => adapter.kv.count(LEGACY_BLOBS_COLLECTION))).toBe(0);
      expect(countOrZero(() => adapter.kv.count(LEGACY_LOG_COLLECTION))).toBe(0);
      expect(countOrZero(() => adapter.vector.count(LEGACY_VECTOR_COLLECTION))).toBe(0);
      expect(countOrZero(() => adapter.kv.count(LEGACY_META_COLLECTION))).toBe(0);
      expect(inspectLegacyFsSource(sourceDir)).toEqual(before);
    } finally {
      adapter.close();
    }
  });

  it("ordinary MirkStoreBackend construction does not scan or import adjacent legacy files", () => {
    seedLegacyFsNamespace();
    expect(existsSync(join(sourceDir, "kv.json"))).toBe(true);

    const backend = new MirkStoreBackend(sourceDir);
    try {
      expect(new BackedKvStore<unknown>(backend).list()).toEqual([]);
      expect(new BackedBlobStore(backend).list()).toEqual([]);
      expect(new BackedLogStore<unknown>(backend).scan()).toEqual([]);
      expect(new BackedVectorStore(backend).search([1, 0, 0], 10)).toEqual([]);
    } finally {
      backend.close();
    }
  });

  it("imports blob keys ending in .mime with their MIME sidecars", () => {
    const backend = new FsStoreBackend(sourceDir);
    const blob = new BackedBlobStore(backend);
    blob.put("foo.mime", new Uint8Array([1, 2, 3]), { mimeType: "application/x-test" });
    blob.put("bare.mime", new Uint8Array([4, 5, 6]));
    const adapter = new SqliteAdapter({ path: destinationPath });

    try {
      const bound = destination(adapter);
      const receipt = importLegacyFsStore({
        sourceDir,
        destination: bound.options,
        mode: "write",
        packageVersions: { source: "0.4.0" },
      });
      expect(receipt.counts.blob).toMatchObject({
        discovered: 2,
        eligible: 2,
        written: 2,
        invalid: 0,
      });
      expect(
        bound.state
          .kv("global", "legacy-fixture")
          .getById<{ bytesBase64: string; mimeType: string }>(
            LEGACY_BLOBS_COLLECTION,
            "foo.mime",
          ),
      ).toEqual({
        id: "foo.mime",
        bytesBase64: Buffer.from([1, 2, 3]).toString("base64"),
        mimeType: "application/x-test",
        sha256: expect.any(String),
      });
      expect(
        bound.state
          .kv("global", "legacy-fixture")
          .getById<{ bytesBase64: string }>(LEGACY_BLOBS_COLLECTION, "bare.mime"),
      ).toEqual({
        id: "bare.mime",
        bytesBase64: Buffer.from([4, 5, 6]).toString("base64"),
        sha256: expect.any(String),
      });
    } finally {
      adapter.close();
    }
  });

  it("preserves legacy sidecar precedence for ambiguous .mime chains", () => {
    const backend = new FsStoreBackend(sourceDir);
    const blob = new BackedBlobStore(backend);
    blob.put("foo.mime", new Uint8Array([1, 2, 3]), { mimeType: "data/type" });
    blob.put("foo", new Uint8Array([4, 5, 6]), { mimeType: "text/plain" });
    expect(blob.list()).toEqual(["foo"]);
    const adapter = new SqliteAdapter({ path: destinationPath });

    try {
      const bound = destination(adapter);
      const receipt = importLegacyFsStore({
        sourceDir,
        destination: bound.options,
        mode: "write",
        packageVersions: { source: "0.4.0" },
      });
      expect(receipt.counts.blob).toMatchObject({
        discovered: 1,
        eligible: 1,
        written: 1,
        invalid: 0,
      });
      expect(
        bound.state
          .kv("global", "legacy-fixture")
          .getById<{ bytesBase64: string; mimeType: string }>(
            LEGACY_BLOBS_COLLECTION,
            "foo",
          ),
      ).toEqual({
        id: "foo",
        bytesBase64: Buffer.from([4, 5, 6]).toString("base64"),
        mimeType: "text/plain",
        sha256: expect.any(String),
      });
      expect(
        bound.state
          .kv("global", "legacy-fixture")
          .getById(LEGACY_BLOBS_COLLECTION, "foo.mime"),
      ).toBeNull();
    } finally {
      adapter.close();
    }
  });

  it("fails closed for an invalid runtime mode and refuses symlinked source entries", () => {
    seedLegacyFsNamespace();
    const adapter = new SqliteAdapter({
      path: destinationPath,
      dimensions: 3,
    });
    const bound = destination(adapter);
    try {
      expect(() =>
        importLegacyFsStore({
          sourceDir,
          destination: bound.options,
          mode: "dryrun" as never,
          packageVersions: { source: "0.4.0" },
        }),
      ).toThrow(/mode must be 'dry-run' or 'write'/);
      expect(() =>
        importLegacyFsStore({
          sourceDir,
          destination: {
            ...bound.options,
            kind: "bogus",
          } as never,
          mode: "dry-run",
          packageVersions: { source: "0.4.0" },
        }),
      ).toThrow(/destination kind must be 'gonk-state' or 'mirk-ports'/);
      expect(bound.state.kv("global", "legacy-fixture").keys()).toEqual([]);
    } finally {
      adapter.close();
    }

    const symlinkSource = join(root, "symlink-source");
    const outside = join(root, "outside-kv.json");
    mkdirSync(symlinkSource);
    writeFileSync(outside, JSON.stringify({ stolen: { value: "outside" } }));
    symlinkSync(outside, join(symlinkSource, "kv.json"));
    expect(() => inspectLegacyFsSource(symlinkSource)).toThrow(/must be a regular file, not a symlink/);

    const danglingSource = join(root, "dangling-symlink-source");
    mkdirSync(danglingSource);
    symlinkSync(join(root, "missing-kv.json"), join(danglingSource, "kv.json"));
    expect(() => inspectLegacyFsSource(danglingSource)).toThrow(
      /must be a regular file, not a symlink/,
    );

    const danglingBlobsSource = join(root, "dangling-blobs-source");
    mkdirSync(danglingBlobsSource);
    symlinkSync(join(root, "missing-blobs"), join(danglingBlobsSource, "blobs"));
    expect(() => inspectLegacyFsSource(danglingBlobsSource)).toThrow(
      /blobs entry must be a real directory, not a symlink/,
    );
  });

  it("rolls back a mid-import failure inside the host transaction and succeeds on retry", () => {
    seedLegacyFsNamespace();
    let adapter = new SqliteAdapter({
      path: destinationPath,
      dimensions: 3,
    });
    const failingKv = new Proxy(adapter.kv, {
      get(target, property) {
        if (property === "put") {
          return (collection: string, item: { id: string }) => {
            if (collection === LEGACY_BLOBS_COLLECTION) throw new Error("injected blob write failure");
            return target.put(collection, item);
          };
        }
        const value = Reflect.get(target, property, target) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      },
    }) as SyncStore;
    const common = {
      sourceDir,
      mode: "write" as const,
      packageVersions: { source: "0.4.0" },
    };

    try {
      expect(() =>
        importLegacyFsStore({
          ...common,
          destination: {
            kind: "mirk-ports",
            kv: failingKv,
            vector: adapter.vector,
            namespace: "rollback",
            identity: "rollback-fixture",
            runExclusive: <T>(work: () => T) => adapter.transaction(work, "immediate"),
          },
        }),
      ).toThrow("injected blob write failure");
      expect(adapter.kv.has("kv.plain")).toBe(false);
      expect(countOrZero(() => adapter.kv.count(LEGACY_TTL_COLLECTION))).toBe(0);
      expect(countOrZero(() => adapter.kv.count(LEGACY_BLOBS_COLLECTION))).toBe(0);
      expect(countOrZero(() => adapter.kv.count(LEGACY_META_COLLECTION))).toBe(0);

      // Reopen after rollback so Mirk rebuilds its collection-table cache.
      adapter.close();
      adapter = new SqliteAdapter({
        path: destinationPath,
        dimensions: 3,
      });
      const retry = importLegacyFsStore({
        ...common,
        destination: {
          kind: "mirk-ports",
          kv: adapter.kv,
          vector: adapter.vector,
          namespace: "rollback",
          identity: "rollback-fixture",
          runExclusive: <T>(work: () => T) => adapter.transaction(work, "immediate"),
        },
      });
      expect(retry.status).toBe("applied");
      expect(adapter.kv.get("kv.plain")).toEqual({ ok: true });
      expect(adapter.kv.count(LEGACY_BLOBS_COLLECTION)).toBe(1);
    } finally {
      adapter.close();
    }
  });
});
