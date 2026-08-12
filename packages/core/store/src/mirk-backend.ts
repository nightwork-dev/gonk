import { existsSync, mkdirSync } from "node:fs";
import { join, normalize } from "node:path";

import type { ScopeStore } from "@gonk/scope";
import type { SyncStore } from "@mirk/store";
import type { VectorStore as MirkVectorStore } from "@mirk/store/vector";

import { resolveStoreDir } from "./factory.ts";
import type {
  BackendFactory,
  BlobPutOptions,
  KvEntry,
  StoreBackend,
  VectorEntry,
  VectorFilter,
  VectorMatch,
} from "./types.ts";

type SqliteAdapterConstructor = typeof import("@mirk/store/sqlite").SqliteAdapter;
type SqliteAdapterInstance = InstanceType<SqliteAdapterConstructor>;

const SqliteAdapter: SqliteAdapterConstructor = await import("@mirk/store/sqlite")
  .then((module) => {
    const adapter = module.SqliteAdapter;
    if (typeof adapter !== "function") {
      throw new TypeError("@mirk/store/sqlite did not export SqliteAdapter");
    }
    return adapter;
  })
  .catch((cause: unknown) => {
    if (!isMissingBetterSqliteOptionalPeer(cause)) {
      throw cause;
    }
    throw new Error(
      "@gonk/store/sqlite requires the optional native peer better-sqlite3. Install better-sqlite3 in the host package to use the Mirk SQLite backend.",
      { cause },
    );
  });

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

/** @deprecated Host-owned Mirk adapters should be passed to
 * `bindGonkSyncState`; Gonk no longer grows this compatibility adapter. Kept
 * for the migration release; removed in the next breaking release. */
export class MirkStoreBackend implements StoreBackend {
  readonly dbPath: string;
  private readonly adapter: SqliteAdapterInstance;
  private readonly kv: SyncStore;
  private vectorFacet: MirkVectorStore | undefined;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.dbPath = join(dir, DB_FILE);
    this.adapter = new SqliteAdapter({ path: this.dbPath, forceJsCosine: true });
    this.kv = this.adapter.kv;
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

    const db = (this.adapter as unknown as { db: unknown }).db;
    const adapterWithDimensions = new SqliteAdapter({
      path: this.dbPath,
      db: db as never,
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

}

function isExpired(expiresAt: number | undefined): boolean {
  return expiresAt !== undefined && Date.now() >= expiresAt;
}

function isMissingBetterSqliteOptionalPeer(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const code = (cause as { code?: unknown }).code;
  if (code !== "ERR_MODULE_NOT_FOUND" && code !== "MODULE_NOT_FOUND") return false;

  const metadata = cause as Error & {
    packageName?: unknown;
    request?: unknown;
    specifier?: unknown;
  };
  for (const specifier of [metadata.packageName, metadata.request, metadata.specifier]) {
    if (specifier === "better-sqlite3") return true;
  }

  const quotedSpecifier = cause.message.match(
    /\b(?:package|module)\s+(?:'([^']+)'|"([^"]+)")(?:\s|$)/,
  );
  return (quotedSpecifier?.[1] ?? quotedSpecifier?.[2]) === "better-sqlite3";
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

/** Convenience factory for hosts that want the Mirk SQLite backend without
 *  assembling store paths themselves. This native adapter is intentionally
 *  reachable only from `@gonk/store/sqlite`, never from the package root. */
/** @deprecated Pass host-owned Mirk ports to `bindGonkSyncState` instead of
 * adapting them back into Gonk's legacy backend SPI. */
export function mirkBackendFactory(scope: ScopeStore): BackendFactory {
  return (tier, namespace) => new MirkStoreBackend(resolveStoreDir(scope, tier, namespace));
}
