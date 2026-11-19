# @gonk/tool-registry-pi

## 0.13.1

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.13.1
  - @gonk/scope@0.13.1
  - @gonk/tool-orchestrator@0.13.1
  - @gonk/tool-registry@0.13.1

## 0.13.0

### Minor Changes

- A registry's `instructions` now reach MCP, JSON HTTP, CLI help and Pi tools. The MCP servers for HTTP and stdio serve the stateless `2026-07-28` protocol revision as well as the older `initialize` handshake. The MCP importer negotiates either revision.

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.13.0
  - @gonk/tool-orchestrator@0.13.0
  - @gonk/auth@0.13.0
  - @gonk/scope@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.12.0
  - @gonk/scope@0.12.0
  - @gonk/tool-orchestrator@0.12.0
  - @gonk/tool-registry@0.12.0

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.11.1
  - @gonk/tool-registry@0.11.1
  - @gonk/auth@0.11.1
  - @gonk/tool-orchestrator@0.11.1

## 0.11.0

### Patch Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`2b772e4`](https://github.com/nightwork-dev/gonk/commit/2b772e4216ca2ba09a2c2df099f63bbff7a2d7a0) Thanks [@abrisene](https://github.com/abrisene)! - Support Pi agent core 1.x (tested against 1.4.0) while retaining compatibility with the existing 0.x releases.
- Updated dependencies [[`a50ba89`](https://github.com/nightwork-dev/gonk/commit/a50ba89c440e57851696b236c90822e2381ecc18)]:
  - @gonk/scope@0.11.0
  - @gonk/tool-registry@0.11.0
  - @gonk/auth@0.11.0
  - @gonk/tool-orchestrator@0.11.0

## 0.8.0

### Patch Changes

- @gonk/auth@0.8.0
- @gonk/scope@0.8.0
- @gonk/tool-orchestrator@0.8.0
- @gonk/tool-registry@0.8.0

## 0.7.0

### Patch Changes

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

- Updated dependencies [5c47c3e]
  - @gonk/tool-registry@0.7.0
  - @gonk/tool-orchestrator@0.7.0
  - @gonk/auth@0.7.0
  - @gonk/scope@0.7.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33), [`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/tool-registry@0.4.0
  - @gonk/tool-orchestrator@0.4.0
  - @gonk/scope@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`eb4179c`](https://github.com/nightwork-dev/gonk/commit/eb4179cc95ae14732ddc4ac66b398296ca31fdf0)]:
  - @gonk/scope@0.3.1
  - @gonk/tool-registry@0.3.1
  - @gonk/tool-orchestrator@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.3.0
  - @gonk/tool-orchestrator@0.3.0
  - @gonk/tool-registry@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776)]:
  - @gonk/tool-registry@0.2.0
  - @gonk/tool-orchestrator@0.2.0
  - @gonk/scope@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [369b951]
- Updated dependencies [cd3152e]
- Updated dependencies [4c3e116]
  - @gonk/tool-registry@0.1.0
  - @gonk/tool-orchestrator@0.1.0
  - @gonk/scope@0.1.0

## 0.0.19

### Patch Changes

- Updated dependencies [cbfd6a4]
  - @gonk/scope@0.0.19
  - @gonk/tool-registry@0.0.19
  - @gonk/tool-orchestrator@0.0.19

## 0.0.12

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.0.12
  - @gonk/tool-orchestrator@0.0.12
  - @gonk/scope@0.0.12
