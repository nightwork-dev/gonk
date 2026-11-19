# @gonk/store

## 0.13.2

### Patch Changes

- Rewrite the README for a developer who meets the package for the first time: what it is, how it fits with the other `@gonk/*` packages, how to install it, the shortest real first use, then the main features. Correct README claims that no longer matched the code. Remove internal notes from source comments, which ship in the sourcemaps. The README and comment changes do not change code behaviour.
- Updated dependencies []:
  - @gonk/utils@0.13.2
  - @gonk/scope@0.13.2

## 0.13.1

### Patch Changes

- Build `@gonk/store` against `@mirk/store` 0.14.0, the version the plugins use, so the storage ports the host hands to capabilities come from one Mirk copy. Document the shared fresh-home database path in `resolveHostStoragePath`.
- Updated dependencies []:
  - @gonk/scope@0.13.1
  - @gonk/utils@0.13.1

## 0.13.0

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.13.0
  - @gonk/utils@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.12.0
  - @gonk/utils@0.12.0

## 0.11.1

### Patch Changes

- `canonicalPath` now resolves a path that does not exist yet through its nearest existing parent folder. A session or global home keeps one spelling before and after its folder is created, so on macOS `/var` and `/private/var` no longer resolve to two different homes. `@gonk/scope`, `@gonk/store` and `@gonk/skills` now use this one function.
- Updated dependencies []:
  - @gonk/scope@0.11.1
  - @gonk/utils@0.11.1

## 0.11.0

### Minor Changes

- [#11](https://github.com/nightwork-dev/gonk/pull/11) [`85e4729`](https://github.com/nightwork-dev/gonk/commit/85e472961d209b5fa1aeb0dad352bf7607b9636d) Thanks [@abrisene](https://github.com/abrisene)! - Add host-owned storage (`@gonk/store/host-storage`). Pi and Codex hosts share one SQLite lease and one way to resolve storage paths, and get scope-bound state stores from it.

- Host-owned storage exposes synchronous tier transactions, so a host can write two related records atomically, for example a message and its delivery record.

### Patch Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`3dbb981`](https://github.com/nightwork-dev/gonk/commit/3dbb981d7f01f45ffa61a911221325dfe453586e) Thanks [@abrisene](https://github.com/abrisene)! - Depend on `@mirk/store` 0.13.0. `@gonk/store` accepts better-sqlite3 11, 12 or 13 and no longer passes the removed `forceJsCosine` option; exact cosine is now Mirk's only vector search path.
- Updated dependencies [[`a50ba89`](https://github.com/nightwork-dev/gonk/commit/a50ba89c440e57851696b236c90822e2381ecc18)]:
  - @gonk/scope@0.11.0
  - @gonk/utils@0.11.0

## 0.8.0

### Patch Changes

- @gonk/scope@0.8.0
- @gonk/utils@0.8.0

## 0.7.0

### Minor Changes

- 5c47c3e: `@gonk/store` adds `bindGonkSyncState`, which binds scope tiers and
  namespaces to Mirk stores that the host provides, and an explicit legacy
  importer at `@gonk/store/legacy-import`. `@gonk/retrieval`, `@gonk/temporal`
  and `@gonk/skills` now keep their state in a host-provided Mirk store. The
  skills registry needs a `stateSource` unless you inject a lifecycle journal.
  `@gonk/tool-registry` adds result metadata (provenance, freshness, cache
  policy and truncation), tool lifecycle and composition declarations, and
  redacted receipt projections. The orchestrator and host adapters pass these
  through.

  All `@gonk/*` packages share one version number, so every package moves to
  `0.7.0`, including packages with no change of their own.

### Patch Changes

- @gonk/scope@0.7.0
- @gonk/utils@0.7.0

## 0.4.0

### Minor Changes

- [`27c97ac`](https://github.com/nightwork-dev/gonk/commit/27c97acbf25e97b4976c178187e18d207909d94c) Thanks [@abrisene](https://github.com/abrisene)! - Move `MirkStoreBackend`, `mirkBackendFactory`, and the Mirk SQLite path and
  migration helpers from the `@gonk/store` root export to `@gonk/store/sqlite`.
  `better-sqlite3` is now an optional peer dependency that hosts install only
  when they use the SQLite backend.

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.4.0
  - @gonk/utils@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`eb4179c`](https://github.com/nightwork-dev/gonk/commit/eb4179cc95ae14732ddc4ac66b398296ca31fdf0)]:
  - @gonk/scope@0.3.1
  - @gonk/utils@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.3.0
  - @gonk/utils@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.2.0
  - @gonk/utils@0.2.0

## 0.1.0

### Patch Changes

- @gonk/scope@0.1.0
- @gonk/utils@0.1.0

## 0.0.19

### Patch Changes

- cbfd6a4: Security fixes + extract `@gonk/utils`.

  - **`@gonk/tool-registry-mcp`**: the HTTP server no longer silently exposes
    unauthenticated tool execution. Serving it beyond your own machine now takes a
    deliberate choice — set an `apiKey`, or `allowInsecure: true` to trust the
    network — otherwise it refuses to start. DNS-rebinding protection is on for a
    local (loopback) bind, and for a remote bind that lists the host(s) clients
    will dial via `allowedHosts`; a protected remote bind with no `allowedHosts`
    refuses to start rather than accept connections it would then reject on every
    request; the keyless trusted-network mode turns the check off. Adds the
    `allowInsecure` / `allowedHosts` options and the `--allow-insecure` /
    `--allowed-hosts` CLI flags. See the package README for plain-English
    local-vs-remote setup.
  - **`@gonk/extension-spec-claude`**: confine all materialized writes and deletes
    to the plugin root — spec-derived command/verb filenames could previously
    traverse out via `..`.
  - **`@gonk/utils`** (new): zero-dependency fs-safety primitives, consolidating
    three drifting copies. Code-split per platform — `@gonk/utils/path` is pure,
    browser-safe path containment; `@gonk/utils/fs` is Node-only atomic writes.
  - **`@gonk/scope`**, **`@gonk/store`**: migrated onto `@gonk/utils` (no public
    API change).

- 5b9d4b4: Add an fs-backed log tail helper used by the self-wake critical path.

  - New `tailLog` utility for reading newly-appended log entries from an offset.
  - Covered by regression tests for offset advancement and malformed/truncated rows.

- Updated dependencies [cbfd6a4]
  - @gonk/utils@0.0.19
  - @gonk/scope@0.0.19

## 0.0.12

### Patch Changes

- Add `FoldStore` — durable state as an append-only log with fold-on-read, over the existing `LogStore`. Concurrent writers append (no read-modify-write of a state blob), so independent handles over the same backing don't clobber; derive-on-wake reconciliation is a pure read, and `dedupeKey` makes a re-applied reconciliation event idempotent. `compact()` is a documented throwing stub pending a cross-process lock.

- Updated dependencies []:
  - @gonk/scope@0.0.12
