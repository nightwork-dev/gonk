# @gonk/skills

## 0.13.3

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.13.3
  - @gonk/scope@0.13.3
  - @gonk/store@0.13.3
  - @gonk/auth@0.13.3
  - @gonk/context@0.13.3

## 0.13.2

### Patch Changes

- Rewrite the README for a developer who meets the package for the first time: what it is, how it fits with the other `@gonk/*` packages, how to install it, the shortest real first use, then the main features. Correct README claims that no longer matched the code. Remove internal notes from source comments, which ship in the sourcemaps. The README and comment changes do not change code behaviour.
- Updated dependencies []:
  - @gonk/auth@0.13.2
  - @gonk/scope@0.13.2
  - @gonk/tool-registry@0.13.2
  - @gonk/context@0.13.2
  - @gonk/store@0.13.2

## 0.13.1

### Patch Changes

- Updated dependencies []:
  - @gonk/store@0.13.1
  - @gonk/auth@0.13.1
  - @gonk/context@0.13.1
  - @gonk/scope@0.13.1
  - @gonk/tool-registry@0.13.1

## 0.13.0

### Minor Changes

- Serve packaged skills through native MCP Skills and the existing portable tools using one verified catalog. Update the MCP TypeScript client and server to 2.4.0.

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.13.0
  - @gonk/auth@0.13.0
  - @gonk/context@0.13.0
  - @gonk/scope@0.13.0
  - @gonk/store@0.13.0

## 0.12.0

### Patch Changes

- Add opt-in JSON HTTP routes (`jsonPath`) beside MCP, and read-only tools that serve skills bundled with an application (`@gonk/skills/bundled`). CLI help reads the JSON Schema attached to a tool's input. The earlier fix for symlinks in shared namespaces is kept.
- Updated dependencies []:
  - @gonk/auth@0.12.0
  - @gonk/context@0.12.0
  - @gonk/scope@0.12.0
  - @gonk/store@0.12.0
  - @gonk/tool-registry@0.12.0

## 0.11.1

### Patch Changes

- `canonicalPath` now resolves a path that does not exist yet through its nearest existing parent folder. A session or global home keeps one spelling before and after its folder is created, so on macOS `/var` and `/private/var` no longer resolve to two different homes. `@gonk/scope`, `@gonk/store` and `@gonk/skills` now use this one function.
- Updated dependencies []:
  - @gonk/scope@0.11.1
  - @gonk/store@0.11.1
  - @gonk/tool-registry@0.11.1
  - @gonk/auth@0.11.1
  - @gonk/context@0.11.1

## 0.11.0

### Patch Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`3dbb981`](https://github.com/nightwork-dev/gonk/commit/3dbb981d7f01f45ffa61a911221325dfe453586e) Thanks [@abrisene](https://github.com/abrisene)! - Depend on `@mirk/store` 0.13.0. `@gonk/store` accepts better-sqlite3 11, 12 or 13 and no longer passes the removed `forceJsCosine` option; exact cosine is now Mirk's only vector search path.
- Updated dependencies [[`85e4729`](https://github.com/nightwork-dev/gonk/commit/85e472961d209b5fa1aeb0dad352bf7607b9636d), [`3dbb981`](https://github.com/nightwork-dev/gonk/commit/3dbb981d7f01f45ffa61a911221325dfe453586e), [`a50ba89`](https://github.com/nightwork-dev/gonk/commit/a50ba89c440e57851696b236c90822e2381ecc18)]:
  - @gonk/store@0.11.0
  - @gonk/scope@0.11.0
  - @gonk/tool-registry@0.11.0
  - @gonk/auth@0.11.0
  - @gonk/context@0.11.0

## 0.8.0

### Patch Changes

- @gonk/auth@0.8.0
- @gonk/context@0.8.0
- @gonk/scope@0.8.0
- @gonk/store@0.8.0
- @gonk/tool-registry@0.8.0

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

- Updated dependencies [5c47c3e]
  - @gonk/store@0.7.0
  - @gonk/tool-registry@0.7.0
  - @gonk/auth@0.7.0
  - @gonk/context@0.7.0
  - @gonk/scope@0.7.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33), [`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33), [`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/tool-registry@0.4.0
  - @gonk/store@0.4.0
  - @gonk/auth@0.4.0
  - @gonk/context@0.4.0
  - @gonk/scope@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`eb4179c`](https://github.com/nightwork-dev/gonk/commit/eb4179cc95ae14732ddc4ac66b398296ca31fdf0)]:
  - @gonk/scope@0.3.1
  - @gonk/store@0.3.1
  - @gonk/tool-registry@0.3.1
  - @gonk/auth@0.3.1
  - @gonk/context@0.3.1

## 0.3.0

### Minor Changes

- [`c005024`](https://github.com/nightwork-dev/gonk/commit/c005024cdfd1bf0a65ea7d6a4936bbb07eb5f456) Thanks [@abrisene](https://github.com/abrisene)! - Add the Phase 1 writable managed-skill contract: authorized create, patch, archive, restore, promote, pin, usage, crash-recoverable security-bound mutation and activation receipts, typed tags/provenance creation, context projection, and distinct tool projection while preserving the Phase 0 read contract.

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.3.0
  - @gonk/context@0.3.0
  - @gonk/scope@0.3.0
  - @gonk/store@0.3.0
  - @gonk/tool-registry@0.3.0

## 0.2.0

### Minor Changes

- [`e5ea6ab`](https://github.com/nightwork-dev/gonk/commit/e5ea6ab14621015facdf49f7ffa40d20d0adb2de) Thanks [@abrisene](https://github.com/abrisene)! - Add the canonical managed-skill read contract: deterministic five-tier scope
  resolution, structurally hidden staging/archive stores, strict filesystem and
  frontmatter validation, typed provenance and freshness, supporting-file reads,
  closed Standard Schema boundaries, and a reusable conformance suite.

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.2.0
