import {
  appendFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import { atomicWriteBytes, atomicWriteJson, atomicWriteText } from "@gonk/utils/fs";
import { safeKeyPath } from "@gonk/utils/path";

import { cosineSimilarity } from "./cosine.ts";
import type {
  BlobPutOptions,
  KvEntry,
  StoreBackend,
  VectorEntry,
  VectorFilter,
  VectorMatch,
} from "./types.ts";

// =============================================================================
// FsStoreBackend — the default pure-filesystem backend
// =============================================================================
//
// Reproduces today's harness behavior:
//   - KV      → one JSON file (atomic temp+rename write), { [key]: KvEntry }
//   - Blob    → files under blobs/, optional <key>.mime sidecar
//   - Log     → JSONL append; offset = byte offset of the line
//   - Vector  → one JSONL file, last-write-wins per id, JS-cosine at query time
//
// All four live under a single resolved dir (the (tier, namespace) home), so a
// backend instance owns exactly one namespace's storage.
//
// CONCURRENCY — single-writer-per-namespace assumption. Each mutating op uses an
// atomic temp-file + rename, so a reader never sees a torn file. That guards
// against *torn* writes, NOT *lost updates* under concurrent writers: `kvSet`
// reads-modifies-writes the whole kv.json, `vectorUpsert` rewrites the whole
// vector snapshot, and `logAppend` computes the append offset before appending —
// so two processes (or workers) writing the same namespace concurrently can clobber
// each other's last write or collide on a log offset. A namespace is assumed to
// have a single live writer (the usual case: one bound scope per process). Full
// cross-process locking is intentionally out of scope for this FS backend; a
// future SqliteStoreBackend would get transactional semantics for free.

const KV_FILE = "kv.json";
const BLOBS_DIR = "blobs";
const LOG_FILE = "log.jsonl";
const VECTORS_FILE = "vectors.jsonl";

export class FsStoreBackend implements StoreBackend {
  constructor(private readonly dir: string) {}

  // ---- KV ------------------------------------------------------------------

  kvGet(key: string): KvEntry | undefined {
    const all = this.readKv();
    return all[key];
  }

  kvSet(key: string, entry: KvEntry): void {
    const all = this.readKv();
    all[key] = entry;
    this.writeKv(all);
  }

  kvDelete(key: string): void {
    const all = this.readKv();
    if (key in all) {
      delete all[key];
      this.writeKv(all);
    }
  }

  kvEntries(): Array<{ key: string; entry: KvEntry }> {
    return Object.entries(this.readKv()).map(([key, entry]) => ({ key, entry }));
  }

  private kvPath(): string {
    return join(this.dir, KV_FILE);
  }

  private readKv(): Record<string, KvEntry> {
    const path = this.kvPath();
    if (!existsSync(path)) return {};
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, KvEntry>)
        : {};
    } catch {
      return {};
    }
  }

  private writeKv(all: Record<string, KvEntry>): void {
    atomicWriteJson(this.kvPath(), all);
  }

  // ---- Blob ----------------------------------------------------------------

  blobPut(key: string, bytes: Uint8Array, opts?: BlobPutOptions): void {
    const path = this.blobPath(key);
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteBytes(path, bytes);
    const mimePath = `${path}.mime`;
    if (opts?.mimeType) {
      writeFileSync(mimePath, opts.mimeType);
    } else if (existsSync(mimePath)) {
      rmSync(mimePath, { force: true });
    }
  }

  blobGet(key: string): Uint8Array | undefined {
    const path = this.blobPath(key);
    if (!existsSync(path)) return undefined;
    return new Uint8Array(readFileSync(path));
  }

  blobDelete(key: string): void {
    const path = this.blobPath(key);
    rmSync(path, { force: true });
    rmSync(`${path}.mime`, { force: true });
  }

  blobList(): string[] {
    const base = join(this.dir, BLOBS_DIR);
    if (!existsSync(base)) return [];
    const out: string[] = [];
    const walk = (rel: string): void => {
      const abs = rel ? join(base, rel) : base;
      let entries: string[];
      try {
        entries = readdirSync(abs);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name.endsWith(".mime")) continue;
        const childRel = rel ? `${rel}/${name}` : name;
        if (statSync(join(base, childRel)).isDirectory()) {
          walk(childRel);
        } else {
          out.push(childRel);
        }
      }
    };
    walk("");
    return out;
  }

  private blobPath(key: string): string {
    return safeKeyPath(this.dir, BLOBS_DIR, key);
  }

  // ---- Log -----------------------------------------------------------------

  logAppend(record: unknown): number {
    // Reject non-serializable records (undefined, a function, a bare symbol):
    // JSON.stringify returns undefined for these, which would write the literal
    // line "undefined\n" — an unparseable JSONL line that logScan/readAt silently
    // drop. Fail loudly instead of corrupting the log.
    const line = JSON.stringify(record);
    if (line === undefined) {
      throw new Error("LogStore.append: record is not JSON-serializable");
    }
    const path = join(this.dir, LOG_FILE);
    mkdirSync(dirname(path), { recursive: true });
    const offset = existsSync(path) ? statSync(path).size : 0;
    appendFileSync(path, `${line}\n`);
    return offset;
  }

  logScan(): unknown[] {
    const path = join(this.dir, LOG_FILE);
    if (!existsSync(path)) return [];
    const out: unknown[] = [];
    for (const line of readFileSync(path, "utf8").split("\n")) {
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        continue;
      }
    }
    return out;
  }

  logReadAt(offset: number): unknown | undefined {
    const path = join(this.dir, LOG_FILE);
    if (!existsSync(path)) return undefined;
    const size = statSync(path).size;
    if (offset < 0 || offset >= size) return undefined;
    const fd = openSync(path, "r");
    try {
      // Read forward from the offset to the next newline. Records are small;
      // a bounded chunked read keeps a malformed offset from over-allocating.
      const chunkSize = 64 * 1024;
      let collected = "";
      let pos = offset;
      while (pos < size) {
        const len = Math.min(chunkSize, size - pos);
        const buf = Buffer.alloc(len);
        const read = readSync(fd, buf, 0, len, pos);
        if (read <= 0) break;
        const text = buf.toString("utf8", 0, read);
        const nl = text.indexOf("\n");
        if (nl >= 0) {
          collected += text.slice(0, nl);
          break;
        }
        collected += text;
        pos += read;
      }
      if (!collected) return undefined;
      try {
        return JSON.parse(collected);
      } catch {
        return undefined;
      }
    } finally {
      closeSync(fd);
    }
  }

  // ---- Vector --------------------------------------------------------------

  vectorUpsert(entry: VectorEntry): void {
    const all = this.readVectors();
    all.set(entry.id, entry);
    this.writeVectors(all);
  }

  /** JS-cosine KNN over the whole snapshot. The ranking (descending score,
   *  id tie-break) lives here, behind the SPI, so a future indexed backend
   *  (sqlite-vec, a remote index) owns its own search without the facade
   *  round-tripping every vector. */
  vectorSearch(query: number[], k: number, filter?: VectorFilter): VectorMatch[] {
    const scored: VectorMatch[] = [];
    for (const entry of this.readVectors().values()) {
      if (filter && !filter(entry.meta)) continue;
      scored.push({ id: entry.id, score: cosineSimilarity(query, entry.vector), meta: entry.meta });
    }
    // Descending by score; tie-break by id for a deterministic order that a
    // brute-force baseline can reproduce.
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return scored.slice(0, Math.max(0, k));
  }

  vectorDelete(id: string): void {
    const all = this.readVectors();
    if (all.delete(id)) {
      this.writeVectors(all);
    }
  }

  private vectorsPath(): string {
    return join(this.dir, VECTORS_FILE);
  }

  /** Last-write-wins per id, preserving first-seen order. */
  private readVectors(): Map<string, VectorEntry> {
    const path = this.vectorsPath();
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
        continue;
      }
    }
    return out;
  }

  private writeVectors(all: Map<string, VectorEntry>): void {
    const path = this.vectorsPath();
    mkdirSync(dirname(path), { recursive: true });
    const body = [...all.values()].map((e) => JSON.stringify(e)).join("\n");
    atomicWriteText(path, body ? `${body}\n` : "");
  }
}
