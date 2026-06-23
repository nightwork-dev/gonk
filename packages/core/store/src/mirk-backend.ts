import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join, normalize } from "node:path";

import { SqliteAdapter } from "@mirk/store/sqlite";
import type { SyncStore } from "@mirk/store";
import type { VectorStore as MirkVectorStore } from "@mirk/store/vector";
import type Database from "better-sqlite3";

import type {
  BlobPutOptions,
  KvEntry,
  StoreBackend,
  VectorEntry,
  VectorFilter,
  VectorMatch,
} from "./types.ts";

// =============================================================================
// MirkStoreBackend — StoreBackend over @mirk/store's real sqlite source adapter
// =============================================================================
//
// All four gonk store facets live in one sqlite database under the resolved
// namespace directory. KV and collection-like data use SqliteAdapter.kv; vector
// search delegates to SqliteAdapter.vector (no local cosine implementation).

const DB_FILE = "store.db";
const BLOBS_COLLECTION = "blobs";
const LOG_COLLECTION = "log";
const META_COLLECTION = "meta";
const VECTOR_COLLECTION = "vectors";
const NEXT_LOG_OFFSET_ID = "nextLogOffset";

const LEGACY_KV_FILE = "kv.json";
const LEGACY_BLOBS_DIR = "blobs";
const LEGACY_LOG_FILE = "log.jsonl";
const LEGACY_VECTORS_FILE = "vectors.jsonl";
export const MIRK_LEGACY_FS_MIGRATION_MARKER_ID = "fs-backend-migration-v1-complete";

interface BlobRecord {
  id: string;
  bytesBase64: string;
  mimeType?: string;
}

interface LogRecord {
  id: string;
  offset: number;
  record: unknown;
}

interface MetaRecord {
  id: string;
  value: unknown;
}

export class MirkStoreBackend implements StoreBackend {
  readonly dbPath: string;
  private readonly adapter: SqliteAdapter;
  private readonly kv: SyncStore;
  private vectorFacet: MirkVectorStore | undefined;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.dbPath = join(dir, DB_FILE);
    this.adapter = new SqliteAdapter({ path: this.dbPath, forceJsCosine: true });
    this.kv = this.adapter.kv;
    this.migrateLegacyFsData(dir);
    if (this.vectorFacet || this.adapter.vector.meta.dimensions > 0) {
      this.vectorFacet = this.currentVectorFacet();
    }
  }

  close(): void {
    this.adapter.close();
  }

  // ---- KV ------------------------------------------------------------------

  kvGet(key: string): KvEntry | undefined {
    const entry = this.kv.get<KvEntry>(key) ?? undefined;
    if (!entry) return undefined;
    if (isExpired(entry.expiresAt)) {
      this.kvDelete(key);
      return undefined;
    }
    return entry;
  }

  kvSet(key: string, entry: KvEntry): void {
    this.kv.set(key, entry);
  }

  kvDelete(key: string): void {
    this.kv.delete(key);
  }

  kvEntries(): Array<{ key: string; entry: KvEntry }> {
    const out: Array<{ key: string; entry: KvEntry }> = [];
    for (const key of this.kv.keys()) {
      const entry = this.kv.get<KvEntry>(key);
      if (!entry) continue;
      if (isExpired(entry.expiresAt)) {
        this.kv.delete(key);
        continue;
      }
      out.push({ key, entry });
    }
    return out;
  }

  // ---- Blob ----------------------------------------------------------------

  blobPut(key: string, bytes: Uint8Array, opts?: BlobPutOptions): void {
    validateBlobKey(key);
    const record: BlobRecord = {
      id: key,
      bytesBase64: Buffer.from(bytes).toString("base64"),
      ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    };
    this.kv.put(BLOBS_COLLECTION, record);
  }

  blobGet(key: string): Uint8Array | undefined {
    validateBlobKey(key);
    const record = this.kv.getById<BlobRecord>(BLOBS_COLLECTION, key);
    if (!record) return undefined;
    return new Uint8Array(Buffer.from(record.bytesBase64, "base64"));
  }

  blobDelete(key: string): void {
    validateBlobKey(key);
    this.kv.remove(BLOBS_COLLECTION, key);
  }

  blobList(): string[] {
    return this.kv.list<BlobRecord>(BLOBS_COLLECTION).map((record) => record.id);
  }

  // ---- Log -----------------------------------------------------------------

  logAppend(record: unknown): number {
    const encoded = JSON.stringify(record);
    if (encoded === undefined) {
      throw new Error("LogStore.append: record is not JSON-serializable");
    }
    const jsonRecord = JSON.parse(encoded) as unknown;
    const offset = this.nextLogOffset();
    this.kv.put<LogRecord>(LOG_COLLECTION, { id: String(offset), offset, record: jsonRecord });
    this.kv.put<MetaRecord>(META_COLLECTION, { id: NEXT_LOG_OFFSET_ID, value: offset + 1 });
    return offset;
  }

  logScan(): unknown[] {
    return this.logRecords().map((r) => r.record);
  }

  logReadAt(offset: number): unknown | undefined {
    const item = this.kv.getById<LogRecord>(LOG_COLLECTION, String(offset));
    return item?.record;
  }

  // ---- Vector --------------------------------------------------------------

  vectorUpsert(entry: VectorEntry): void {
    const vector = Float32Array.from(entry.vector);
    const facet = this.ensureVectorFacet(vector.length);
    facet.upsert(VECTOR_COLLECTION, {
      id: entry.id,
      vector,
      metadata: entry.meta ?? {},
    });
  }

  vectorSearch(query: number[], k: number, filter?: VectorFilter): VectorMatch[] {
    if (k <= 0) return [];
    const facet = this.currentVectorFacet();
    if (!facet) return [];

    const count = facet.count(VECTOR_COLLECTION);
    if (count === 0) return [];

    const topK = filter ? count : k;
    const results = facet.search<Record<string, unknown>>(VECTOR_COLLECTION, Float32Array.from(query), {
      topK,
    });
    const filtered = filter
      ? results.filter((match) => filter(match.metadata ?? {})).slice(0, k)
      : results;
    return filtered.map((match) => ({
      id: match.id,
      score: match.score,
      meta: match.metadata ?? {},
    }));
  }

  vectorDelete(id: string): void {
    this.currentVectorFacet()?.remove(VECTOR_COLLECTION, id);
  }

  private currentVectorFacet(): MirkVectorStore | undefined {
    if (this.vectorFacet) return this.vectorFacet;
    if (this.adapter.vector.meta.dimensions > 0) {
      this.vectorFacet = this.adapter.vector;
      return this.vectorFacet;
    }
    return undefined;
  }

  private ensureVectorFacet(dimensions: number): MirkVectorStore {
    const existing = this.currentVectorFacet();
    if (existing) return existing;

    const db = (this.adapter as unknown as { db: Database.Database }).db;
    const adapterWithDimensions = new SqliteAdapter({
      path: this.dbPath,
      db,
      dimensions,
      forceJsCosine: true,
    });
    this.vectorFacet = adapterWithDimensions.vector;
    return this.vectorFacet;
  }

  private nextLogOffset(): number {
    const stored = this.kv.getById<MetaRecord>(META_COLLECTION, NEXT_LOG_OFFSET_ID)?.value;
    if (typeof stored === "number" && Number.isSafeInteger(stored) && stored >= 0) return stored;
    const max = this.logRecords().reduce((acc, r) => Math.max(acc, r.offset), -1);
    return max + 1;
  }

  private logRecords(): LogRecord[] {
    return this.kv
      .list<LogRecord>(LOG_COLLECTION)
      .sort((a, b) => a.offset - b.offset || a.id.localeCompare(b.id));
  }

  /** Copy legacy FsStoreBackend artifacts into sqlite exactly once per namespace.
   *  The marker is written only after every facet import completes; legacy files
   *  are never removed or rewritten. */
  private migrateLegacyFsData(dir: string): void {
    if (this.legacyFsMigrationComplete()) return;
    if (!legacyFsDataPresent(dir)) return;

    this.importLegacyKv(dir);
    this.importLegacyLog(dir);
    this.importLegacyBlobs(dir);
    this.importLegacyVectors(dir);

    this.kv.put<MetaRecord>(META_COLLECTION, {
      id: MIRK_LEGACY_FS_MIGRATION_MARKER_ID,
      value: {
        source: "FsStoreBackend",
        version: 1,
        completedAt: new Date().toISOString(),
      },
    });
  }

  private legacyFsMigrationComplete(): boolean {
    return this.kv.getById<MetaRecord>(META_COLLECTION, MIRK_LEGACY_FS_MIGRATION_MARKER_ID) !== null;
  }

  private importLegacyKv(dir: string): void {
    for (const [key, entry] of Object.entries(readLegacyKv(dir))) {
      if (!isKvEntry(entry)) continue;
      if (isExpired(entry.expiresAt)) continue;
      this.kv.set(key, entry);
    }
  }

  private importLegacyLog(dir: string): void {
    const path = join(dir, LEGACY_LOG_FILE);
    if (!existsSync(path)) return;

    const records = readLegacyLogRecords(path);
    for (const record of records) {
      this.kv.put<LogRecord>(LOG_COLLECTION, {
        id: String(record.offset),
        offset: record.offset,
        record: record.record,
      });
    }

    const fsNextOffset = statSync(path).size;
    const existingNextOffset = this.nextLogOffset();
    this.kv.put<MetaRecord>(META_COLLECTION, {
      id: NEXT_LOG_OFFSET_ID,
      value: Math.max(fsNextOffset, existingNextOffset),
    });
  }

  private importLegacyBlobs(dir: string): void {
    const base = join(dir, LEGACY_BLOBS_DIR);
    for (const key of legacyBlobKeys(base)) {
      const path = join(base, ...key.split("/"));
      const mimePath = `${path}.mime`;
      const opts = existsSync(mimePath)
        ? { mimeType: readFileSync(mimePath, "utf8") }
        : undefined;
      this.blobPut(key, new Uint8Array(readFileSync(path)), opts);
    }
  }

  private importLegacyVectors(dir: string): void {
    for (const entry of readLegacyVectors(dir).values()) {
      this.vectorUpsert(entry);
    }
  }
}

function legacyFsDataPresent(dir: string): boolean {
  return (
    existsSync(join(dir, LEGACY_KV_FILE)) ||
    existsSync(join(dir, LEGACY_LOG_FILE)) ||
    existsSync(join(dir, LEGACY_VECTORS_FILE)) ||
    legacyBlobKeys(join(dir, LEGACY_BLOBS_DIR)).length > 0
  );
}

function readLegacyKv(dir: string): Record<string, unknown> {
  const path = join(dir, LEGACY_KV_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isKvEntry(value: unknown): value is KvEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const expiresAt = (value as { expiresAt?: unknown }).expiresAt;
  return expiresAt === undefined || typeof expiresAt === "number";
}

function readLegacyLogRecords(path: string): Array<{ offset: number; record: unknown }> {
  const bytes = readFileSync(path);
  const out: Array<{ offset: number; record: unknown }> = [];
  let offset = 0;
  for (let i = 0; i <= bytes.length; i++) {
    if (i < bytes.length && bytes[i] !== 0x0a) continue;
    const line = bytes.subarray(offset, i);
    if (line.length > 0) {
      try {
        out.push({ offset, record: JSON.parse(line.toString("utf8")) as unknown });
      } catch {
        // Match FsStoreBackend.logScan/logReadAt: malformed lines are ignored.
      }
    }
    offset = i + 1;
  }
  return out;
}

function legacyBlobKeys(base: string): string[] {
  if (!existsSync(base)) return [];
  const out: string[] = [];
  const walk = (rel: string): void => {
    const abs = rel ? join(base, ...rel.split("/")) : base;
    let entries: Dirent[];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const childAbs = join(base, ...childRel.split("/"));
      if (entry.isDirectory()) {
        walk(childRel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".mime") && existsSync(childAbs.slice(0, -".mime".length))) {
        continue;
      }
      out.push(childRel);
    }
  };
  walk("");
  return out;
}

function readLegacyVectors(dir: string): Map<string, VectorEntry> {
  const path = join(dir, LEGACY_VECTORS_FILE);
  const out = new Map<string, VectorEntry>();
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const entry = JSON.parse(line) as VectorEntry;
      if (entry && typeof entry.id === "string" && Array.isArray(entry.vector)) {
        out.set(entry.id, { id: entry.id, vector: entry.vector, meta: entry.meta ?? {} });
      }
    } catch {
      // Match FsStoreBackend.readVectors: malformed lines are ignored.
    }
  }
  return out;
}

function isExpired(expiresAt: number | undefined): boolean {
  return expiresAt !== undefined && Date.now() >= expiresAt;
}

function validateBlobKey(key: string): void {
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new Error(`Blob key must be relative: ${key}`);
  }
  const segments = normalize(key).split(/[\\/]/);
  if (segments.some((s) => s === ".." || s === "")) {
    throw new Error(`Blob key escapes root: ${key}`);
  }
}

export function mirkStoreDbPath(dir: string): string {
  return join(dir, DB_FILE);
}

export function mirkStoreDbExists(dir: string): boolean {
  return existsSync(mirkStoreDbPath(dir));
}
