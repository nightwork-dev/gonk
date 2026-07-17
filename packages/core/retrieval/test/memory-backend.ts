import type {
  BlobPutOptions,
  KvEntry,
  StoreBackend,
  VectorEntry,
  VectorFilter,
  VectorMatch,
} from "@gonk/store";

export class MemoryStoreBackend implements StoreBackend {
  private readonly kv = new Map<string, KvEntry>();
  private readonly blobs = new Map<string, Uint8Array>();
  private readonly log: unknown[] = [];
  private readonly vectors = new Map<string, VectorEntry>();

  kvGet(key: string): KvEntry | undefined {
    return this.kv.get(key);
  }
  kvSet(key: string, entry: KvEntry): void {
    this.kv.set(key, entry);
  }
  kvDelete(key: string): void {
    this.kv.delete(key);
  }
  kvEntries(): Array<{ key: string; entry: KvEntry }> {
    return [...this.kv.entries()].map(([key, entry]) => ({ key, entry }));
  }
  blobPut(key: string, bytes: Uint8Array, _options?: BlobPutOptions): void {
    this.blobs.set(key, bytes.slice());
  }
  blobGet(key: string): Uint8Array | undefined {
    return this.blobs.get(key)?.slice();
  }
  blobDelete(key: string): void {
    this.blobs.delete(key);
  }
  blobList(): string[] {
    return [...this.blobs.keys()];
  }
  logAppend(record: unknown): number {
    this.log.push(structuredClone(record));
    return this.log.length - 1;
  }
  logScan(): unknown[] {
    return structuredClone(this.log);
  }
  logReadAt(offset: number): unknown | undefined {
    return structuredClone(this.log[offset]);
  }
  vectorUpsert(entry: VectorEntry): void {
    this.vectors.set(entry.id, structuredClone(entry));
  }
  vectorSearch(_query: number[], _k: number, _filter?: VectorFilter): VectorMatch[] {
    return [];
  }
  vectorDelete(id: string): void {
    this.vectors.delete(id);
  }
}
