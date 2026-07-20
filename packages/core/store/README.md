# @gonk/store

Backing-agnostic persistence primitives for gonk capabilities. The same idea for *data* that [`@gonk/scope`](../scope) is for *config*: a capability declares what it stores and how it reads it, and the store owns *where* (a scope-resolved, `.agents`-preferring location) and *what backing* (a pure-`fs` default today, swappable for sqlite/remote without touching the caller).

**Why it exists.** Capabilities used to persist by reaching *past* scope straight to the filesystem — opening `better-sqlite3`, writing JSON/JSONL at paths they assembled themselves. That hardcodes both the location (drifting from the canonical `.agents/` home) and the backing (you can't move a capability that `new Database()`s to anything else without rewriting it). One rule fixes both: **persist through a store the foundation provides, never through a path you assemble.**

**Who uses it.** The `@gonk/*` extension capabilities — `jobs`, `work-items`, `curator`, `reflector`, `self-model-reflector`, `rlm` (cache + traces), and `memory` (KV + curated blobs) — obtain their store from `createStore(scope)` and never see a path. Relational domains (memory triples/sessions, knowledge FTS5, traces index) deliberately stay on their own capability-local interfaces rather than forcing SQL through the universal store.

**How often.** On every persist — it is the write path for capability state.

## The four primitives

Each is obtained from a factory keyed by `(scope-tier, namespace)`; the location resolves through scope's substrate dir, so all five tiers (`session > directory > project > persona > global`) work identically.

```ts
import { createStore } from "@gonk/store";

const store = createStore(scope);

const kv   = store.kv<Prefs>("persona", "prefs");   // get / set / patch / delete / list / entries (+ optional ttl)
const blob = store.blob("global", "reports");        // put / get / delete / list — opaque bytes
const log  = store.log<Event>("session", "audit");   // append / scan(filter) / readAt(offset) — JSONL
const vec  = store.vector("project", "embeddings");  // upsert / search(vector, k, filter) / delete — KNN
```

- **`KvStore`** — keyed records with `get / set / patch / delete / list(prefix?) / entries(prefix?)`. `list` and `entries` both derive from a single read (no `get` per key).
- **`BlobStore`** — opaque files: `put / get / delete / list`. Writes are atomic (temp-file-then-rename).
- **`LogStore`** — append-only JSONL: `append` returns an offset, `scan(filter?)` reads forward, `readAt(offset)` seeks.
- **`VectorStore`** — `upsert / search / delete`; the fs backend ranks with JS cosine similarity.

## Backends

Every store type delegates to a **`StoreBackend`** SPI. The shipped default, **`FsStoreBackend`**, reproduces the prior on-disk behaviour — atomic KV/blob writes, JSONL logs, JS-cosine vectors — with **zero native dependencies** (no `better-sqlite3`, no sqlite-vec; it is pure `node:fs`). SQLite is available only through the explicit `@gonk/store/sqlite` subpath, so default consumers can install and run without native modules while hosts that choose SQLite opt into its peer dependency.

```ts
import { createStore, FsStoreBackend } from "@gonk/store";
// createStore(scope) uses FsStoreBackend by default; pass your own to swap the backing.
```

```ts
import { createStoreProvider } from "@gonk/store";
import { mirkBackendFactory } from "@gonk/store/sqlite";

// Requires better-sqlite3 in the host package.
const provider = createStoreProvider(scope, { backendFactory: mirkBackendFactory(scope) });
```

## Exports

- `@gonk/store` — `createStore`, `resolveStoreDir`, `FsStoreBackend`, `cosineSimilarity`, and the store/backend value+type surface.
- `@gonk/store/types` — types only (`KvStore`, `BlobStore`, `LogStore`, `VectorStore`, `Store`, `StoreBackend`, …) for client-safe imports.
- `@gonk/store/sqlite` — explicit native-backed Mirk SQLite adapter (`MirkStoreBackend`, `mirkBackendFactory`, `mirkStoreDbPath`). This subpath fails with a descriptive peer-dependency error if `better-sqlite3` is not installed by the host.
