import type {
  BlobPutOptions,
  BlobStore,
  KvSetOptions,
  KvStore,
  LogStore,
  StoreBackend,
  VectorFilter,
  VectorMatch,
  VectorStore,
} from "./types.ts";

// =============================================================================
// The four store types, each a thin typed facade over a StoreBackend.
// =============================================================================
//
// The stores own access-pattern logic that is genuinely backing-independent (TTL
// expiry, patch-merge); the backend owns raw persistence AND vector search.
// Splitting it here means a future SqliteStoreBackend inherits the TTL/patch
// semantics for free, while still serving KNN from its own index (via
// `vectorSearch`) instead of being forced through a facade scan.

export class BackedKvStore<T> implements KvStore<T> {
  constructor(private readonly backend: StoreBackend) {}

  get(key: string): T | undefined {
    const entry = this.backend.kvGet(key);
    if (!entry) return undefined;
    if (isExpired(entry.expiresAt)) {
      this.backend.kvDelete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set(key: string, value: T, opts?: KvSetOptions): void {
    this.backend.kvSet(key, {
      value,
      ...(opts?.ttlMs !== undefined ? { expiresAt: Date.now() + opts.ttlMs } : {}),
    });
  }

  patch(key: string, partial: Partial<T>, opts?: KvSetOptions): void {
    const current = this.get(key);
    // Require a *plain* object base. `typeof null === "object"` and a class
    // instance is also an object, so the array/non-object guard alone let null
    // and class instances slip through — spreading either yields nonsense.
    if (current !== undefined && !isPlainObject(current)) {
      throw new Error(`KvStore.patch: existing value at '${key}' is not a plain object`);
    }
    const base = (current ?? {}) as Record<string, unknown>;
    const merged = { ...base, ...(partial as Record<string, unknown>) } as T;
    this.set(key, merged, opts);
  }

  delete(key: string): void {
    this.backend.kvDelete(key);
  }

  list(prefix?: string): string[] {
    const out: string[] = [];
    for (const key of this.backend.kvList()) {
      const entry = this.backend.kvGet(key);
      if (!entry) continue;
      if (isExpired(entry.expiresAt)) {
        this.backend.kvDelete(key);
        continue;
      }
      if (prefix && !key.startsWith(prefix)) continue;
      out.push(key);
    }
    return out.sort();
  }
}

export class BackedBlobStore implements BlobStore {
  constructor(private readonly backend: StoreBackend) {}

  put(key: string, bytes: Uint8Array, opts?: BlobPutOptions): void {
    this.backend.blobPut(key, bytes, opts);
  }

  get(key: string): Uint8Array | undefined {
    return this.backend.blobGet(key);
  }

  delete(key: string): void {
    this.backend.blobDelete(key);
  }

  list(prefix?: string): string[] {
    const keys = this.backend.blobList();
    const filtered = prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
    return filtered.sort();
  }
}

export class BackedLogStore<R> implements LogStore<R> {
  constructor(private readonly backend: StoreBackend) {}

  append(record: R): number {
    return this.backend.logAppend(record);
  }

  scan(filter?: (record: R) => boolean): R[] {
    const all = this.backend.logScan() as R[];
    return filter ? all.filter(filter) : all;
  }

  readAt(offset: number): R | undefined {
    return this.backend.logReadAt(offset) as R | undefined;
  }
}

export class BackedVectorStore implements VectorStore {
  constructor(private readonly backend: StoreBackend) {}

  upsert(id: string, vector: number[], meta?: Record<string, unknown>): void {
    this.backend.vectorUpsert({ id, vector, meta: meta ?? {} });
  }

  search(vector: number[], k: number, filter?: VectorFilter): VectorMatch[] {
    // Search lives behind the backend SPI so an indexed backend (sqlite-vec, a
    // remote index) owns its own ranking instead of round-tripping every vector
    // through the facade.
    return this.backend.vectorSearch(vector, k, filter);
  }

  delete(id: string): void {
    this.backend.vectorDelete(id);
  }
}

function isExpired(expiresAt: number | undefined): boolean {
  return expiresAt !== undefined && Date.now() >= expiresAt;
}

/** A patch base must be a plain object: not null, not an array, and not a class
 *  instance (its prototype is Object.prototype or null). Spreading anything else
 *  loses identity/behavior, so `patch` rejects it. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}
