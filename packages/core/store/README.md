# @gonk/store

`@gonk/store` is in a one-release migration from its original backing-agnostic
store facade to a small scope-and-namespace binding over Mirk. New capability
code should receive a host-owned Mirk port explicitly. The host owns adapter
selection, paths, credentials, and `close()`.

```ts
import { bindGonkSyncState } from "@gonk/store";

const state = bindGonkSyncState(scope, {
  // The host chooses and owns this Mirk adapter.
  kv: (tier) => hostMirkSource.kv(tier),
});

const jobs = state.kv("jobs");
jobs.set("attempt-1", { status: "running" });
```

The source is required. There is no filesystem fallback in the binding, and
Gonk never closes a caller-provided adapter.

## Explicit legacy import

Opening `MirkStoreBackend` or binding ordinary Gonk state never scans legacy
filesystem data. Migration is an explicit Node-only operator action:

```ts
import { importLegacyFsStore } from "@gonk/store/legacy-import";

const receipt = importLegacyFsStore({
  sourceDir: legacyNamespaceDir,
  destination: {
    kind: "gonk-state",
    state,
    tier: "global",
    namespace: "memory",
    identity: "primary-state",
  },
  mode: "dry-run",
  // The operator supplies the version of the legacy source package.
  packageVersions: { source: "0.4.0" },
});
```

Inspect the dry-run receipt, then repeat with `mode: "write"`. Write mode also
requires `destination.runExclusive`, a host callback that encloses destination
preflight, writes, and the receipt in one exclusive transaction or lock. For a
host-owned `SqliteAdapter`, use
`runExclusive: (work) => adapter.transaction(work, "immediate")`.

The importer preflights every destination record, refuses differing data,
writes its receipt last, and leaves the source untouched. Repeating an unchanged
completed import returns `already-imported` without writing again. Future TTL
values are quarantined as records in `legacy-kv-ttl`; they are not silently
converted into immortal KV values. Destination identity is a safe operator
label, not a database path or credential. Keep the legacy source quiescent
during import; symlinked source entries are rejected.

The previous factory/backend surface remains for this migration release with
deprecation markers: `createStore`, `resolveStoreDir`, `StoreBackend`,
`BackendFactory`, `FsStoreBackend`, the `Backed*Store` classes, Gonk vector
types and `cosineSimilarity`, `tailLog`, `FoldStore`, and `compact`. Do not add
new production imports of these exports. The next breaking release removes
them.

**Why it exists.** Capabilities used to persist by reaching *past* scope straight to the filesystem — opening `better-sqlite3`, writing JSON/JSONL at paths they assembled themselves. That hardcodes both the location (drifting from the canonical `.agents/` home) and the backing (you can't move a capability that `new Database()`s to anything else without rewriting it). One rule fixes both: **persist through a store the foundation provides, never through a path you assemble.**

**Who still uses the compatibility facade.** Extension capabilities that have
not completed their migration may still obtain legacy stores from
`createStore(scope)`. New and migrated capabilities receive Mirk state
explicitly.

**How often.** On every persist — it is the write path for capability state.

## Legacy compatibility facade

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
- `@gonk/store/legacy-import` — explicit Node-only legacy filesystem inspector
  and importer. This is an operator action; ordinary store construction never
  imports data.
