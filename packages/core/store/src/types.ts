import type { ScopeName } from "@gonk/scope";

// =============================================================================
// The four backing-agnostic store interfaces
// =============================================================================
//
// Each is obtained from a factory keyed by (scope-tier, namespace). The factory
// resolves the on-disk location through scope's substrate resolution, so a
// caller never sees — and never assembles — a path. Every store delegates to a
// low-level `StoreBackend` SPI; swapping the backend swaps the backing with no
// caller change. See design store-abstraction-design.md §4.

/** Keyed records with optional per-entry TTL. Expired entries read as
 *  `undefined` and are pruned on access. */
export interface KvStore<T = unknown> {
  get(key: string): T | undefined;
  set(key: string, value: T, opts?: KvSetOptions): void;
  /** Shallow-merge `partial` into the stored object. Throws if the existing
   *  value is not a plain object. A missing/expired entry starts from `{}`. */
  patch(key: string, partial: Partial<T>, opts?: KvSetOptions): void;
  delete(key: string): void;
  /** Keys (optionally prefix-filtered), expired entries excluded, sorted. */
  list(prefix?: string): string[];
}

export interface KvSetOptions {
  /** Time-to-live in milliseconds. After this elapses the entry reads as
   *  `undefined` and is pruned. Omit for a permanent entry. */
  ttlMs?: number;
}

/** Opaque binary files. Generalizes scope's blob layout. */
export interface BlobStore {
  put(key: string, bytes: Uint8Array, opts?: BlobPutOptions): void;
  get(key: string): Uint8Array | undefined;
  delete(key: string): void;
  /** Keys (optionally prefix-filtered), sorted. */
  list(prefix?: string): string[];
}

export interface BlobPutOptions {
  mimeType?: string;
}

/** Append-only JSONL log. `append` returns the record's byte offset, which
 *  `readAt` resolves back to the record. */
export interface LogStore<R = unknown> {
  append(record: R): number;
  /** All records in append order, optionally filtered by a predicate. */
  scan(filter?: (record: R) => boolean): R[];
  /** The record stored at a byte offset returned by a prior `append`, or
   *  `undefined` if the offset does not name a record. */
  readAt(offset: number): R | undefined;
}

/** Vector store with cosine-KNN search. The default backend computes cosine
 *  similarity in pure JS; the SPI is shaped so a native index (sqlite-vec, a
 *  remote index) can implement the same surface later. */
export interface VectorStore {
  upsert(id: string, vector: number[], meta?: Record<string, unknown>): void;
  search(vector: number[], k: number, filter?: VectorFilter): VectorMatch[];
  delete(id: string): void;
}

/** Predicate over an entry's metadata, used to narrow a search. */
export type VectorFilter = (meta: Record<string, unknown>) => boolean;

export interface VectorMatch {
  id: string;
  /** Cosine similarity in [-1, 1]; higher is nearer. */
  score: number;
  meta: Record<string, unknown>;
}

// =============================================================================
// Factory surface
// =============================================================================

/** Obtains the four store types for a (tier, namespace). The location is
 *  resolved internally through scope — callers pass a tier + a namespace, never
 *  a path. */
export interface Store {
  kv<T = unknown>(tier: ScopeName, namespace: string): KvStore<T>;
  blob(tier: ScopeName, namespace: string): BlobStore;
  log<R = unknown>(tier: ScopeName, namespace: string): LogStore<R>;
  vector(tier: ScopeName, namespace: string): VectorStore;
}

// =============================================================================
// Backend SPI — the low-level seam the four stores delegate to
// =============================================================================
//
// A `StoreBackend` is resolved per (tier, namespace) and owns the raw byte/record
// operations. `FsStoreBackend` is the default (atomic temp+rename JSON for kv,
// JSONL append for logs, files for blobs, JS-cosine for vectors). A future
// `SqliteStoreBackend` / `RemoteStoreBackend` implements the same SPI — that is
// where "swappable backing" lands, with no change to the four store types above.

/** A persisted KV entry as the backend stores it: the value plus an optional
 *  absolute expiry timestamp (ms epoch). */
export interface KvEntry {
  value: unknown;
  /** Absolute expiry in ms epoch. Absent means permanent. */
  expiresAt?: number;
}

export interface StoreBackend {
  // ---- KV ------------------------------------------------------------------
  kvGet(key: string): KvEntry | undefined;
  kvSet(key: string, entry: KvEntry): void;
  kvDelete(key: string): void;
  kvList(): string[];

  // ---- Blob ----------------------------------------------------------------
  blobPut(key: string, bytes: Uint8Array, opts?: BlobPutOptions): void;
  blobGet(key: string): Uint8Array | undefined;
  blobDelete(key: string): void;
  blobList(): string[];

  // ---- Log -----------------------------------------------------------------
  /** Append a record; returns its byte offset in the log. */
  logAppend(record: unknown): number;
  logScan(): unknown[];
  logReadAt(offset: number): unknown | undefined;

  // ---- Vector --------------------------------------------------------------
  vectorUpsert(entry: VectorEntry): void;
  /** Top-`k` matches for `query`, ranked by the backend's own similarity (the
   *  FS backend does JS-cosine; an indexed backend — sqlite-vec, a remote index
   *  — owns its ranking here). `filter` narrows by metadata before ranking.
   *  Search lives behind the SPI so an indexed backend never has to round-trip
   *  every vector through the facade. */
  vectorSearch(query: number[], k: number, filter?: VectorFilter): VectorMatch[];
  vectorDelete(id: string): void;
}

/** A persisted vector record. */
export interface VectorEntry {
  id: string;
  vector: number[];
  meta: Record<string, unknown>;
}

/** Resolves a `StoreBackend` for a (tier, namespace). The default
 *  `fsBackendFactory` resolves the on-disk dir through scope and returns an
 *  `FsStoreBackend`; substituting this factory is how a different backing is
 *  installed. */
export type BackendFactory = (tier: ScopeName, namespace: string) => StoreBackend;
