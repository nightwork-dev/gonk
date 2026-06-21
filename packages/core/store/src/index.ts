export type {
  BackendFactory,
  BlobPutOptions,
  BlobStore,
  KvEntry,
  KvSetOptions,
  KvStore,
  LogStore,
  Store,
  StoreBackend,
  VectorEntry,
  VectorFilter,
  VectorMatch,
  VectorStore,
} from "./types.ts";
export type { CreateStoreOptions } from "./factory.ts";
export { createStore, resolveStoreDir } from "./factory.ts";
export type { FoldEvent, Reducer } from "./fold.ts";
export { compact, FoldStore } from "./fold.ts";
export { FsStoreBackend } from "./fs-backend.ts";
export { cosineSimilarity } from "./cosine.ts";
export {
  BackedBlobStore,
  BackedKvStore,
  BackedLogStore,
  BackedVectorStore,
} from "./stores.ts";
