# @gonk/store

Give each agent capability its own state, kept per scope tier and per
namespace, in a storage backend that the host chooses. `@gonk/store` binds the
five [`@gonk/scope`](https://www.npmjs.com/package/@gonk/scope) tiers and a
namespace to [Mirk](https://www.npmjs.com/package/@mirk/store) stores that the
host provides. A capability asks for "the `jobs` store at the session tier" and
never builds a file path or opens a database itself.

The host decides the adapter (in-memory, SQLite or another Mirk backend), its
paths and credentials, and when to close it. `@gonk/store` never closes a store
it did not open.

## Install

```sh
npm install @gonk/store @gonk/scope @mirk/store
```

## Quick start

```ts
import { InMemoryKv } from "@mirk/store";
import type { SyncStore } from "@mirk/store";
import { createScope } from "@gonk/scope";
import type { ScopeName } from "@gonk/scope/types";
import { bindGonkSyncState } from "@gonk/store";

// The host picks the Mirk adapter for each tier and owns its lifecycle.
// InMemoryKv keeps this example self-contained; a real host passes a persistent adapter.
const stores = new Map<ScopeName, SyncStore>();
const state = bindGonkSyncState(createScope({ cwd: process.cwd(), sessionId: "demo" }), {
  kv(tier) {
    let store = stores.get(tier);
    if (!store) stores.set(tier, (store = new InMemoryKv()));
    return store;
  },
});

const jobs = state.kv("jobs");                  // the default tier, "global"
jobs.set("attempt-1", { status: "running" });
jobs.get("attempt-1");                          // → { status: "running" }

const drafts = state.kv("session", "drafts");   // name the tier explicitly
drafts.set("reply", "Thanks for the report.");
```

## The binding

`bindGonkSyncState(scope, source, { defaultTier? })` returns a state object:

| Call | Returns |
| --- | --- |
| `state.kv(namespace)` | A key-value store for the namespace at the default tier. |
| `state.kv(tier, namespace)` | A key-value store for the namespace at that tier. |
| `state.vector(namespace)`, `state.vector(tier, namespace)` | A vector store, if the source provides `vector(tier)`. |
| `state.at(tier)` | A view bound to one tier, with `kv`, `vector` and `transaction`. |
| `state.at(tier).transaction(work)` | Runs synchronous work atomically on that tier, if the source provides `transaction`. |

The source has one required method, `kv(tier)`, which returns a Mirk
`SyncStore`. Namespaces share that store without colliding. The default tier is
`global`, and the binding resolves it at once, so a missing source fails at
construction rather than at the first write.

## Importing legacy data

Older versions of this package wrote state straight to the file system.
`@gonk/store/legacy-import` copies that data into a bound state, as an explicit
step that you run once. Opening a store never scans for legacy data.

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
  packageVersions: { source: "0.4.0" }, // the package version that wrote the data
});
```

Read the dry-run receipt, then run again with `mode: "write"`. Write mode also
needs `destination.runExclusive`, a callback that runs the import inside one
exclusive transaction or lock. With a Mirk `SqliteAdapter`, use
`runExclusive: (work) => adapter.transaction(work, "immediate")`.

The importer checks every record before it writes, refuses data that differs
from what is already there, writes its receipt last, and leaves the source
untouched. Running an unchanged import again returns `already-imported`.
Keys with a future expiry go to a separate `legacy-kv-ttl` collection, so
they do not turn into keys that never expire. Symbolic links in the source are refused.

## Deprecated file system stores

The original factory API still ships for one more release and will be removed
in the next breaking release. Do not use it in new code:

- `createStore`, `createStoreProvider`, `resolveStoreDir`;
- `StoreBackend`, `BackendFactory`, `FsStoreBackend` and the `Backed*Store`
  classes;
- the vector types and `cosineSimilarity`, `tailLog`, `FoldStore` and
  `compact`.

`@gonk/store/sqlite` offers `MirkStoreBackend` and `mirkBackendFactory` for
that API. It needs `better-sqlite3` installed in the host.

## Entry points

| Import | Contents |
| --- | --- |
| `@gonk/store` | `bindGonkSyncState`, its types, and the deprecated API. |
| `@gonk/store/types` | Types only. |
| `@gonk/store/legacy-import` | `importLegacyFsStore`, a Node-only importer. |
| `@gonk/store/host-storage` | Host-owned SQLite storage: a lease that gives a host scope-bound state and closes the database when released. |
| `@gonk/store/sqlite` | The SQLite backend for the deprecated API. Needs `better-sqlite3`. |

## License

Apache-2.0
