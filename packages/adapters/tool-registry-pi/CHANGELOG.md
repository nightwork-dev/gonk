# @gonk/tool-registry-pi

## 0.7.0

### Patch Changes

- 5c47c3e: Release the R1 Core migration slice. `@gonk/store` adds the caller-owned
  Mirk-native state binding and explicit legacy importer (minor: new public
  subpaths and replacement contract). Retrieval, temporal, and skills now
  consume caller-provided Mirk state; the skills registry requires `stateSource`
  unless a lifecycle journal is injected (minor: migration boundary). Tool
  Registry publishes result evidence, freshness/cache, truncation, lifecycle,
  composition, and redacted receipt projections (minor: public contract
  additions). The orchestrator and host adapters receive corresponding
  state/projection wiring (patch: additive projections).

  The repository keeps all `@gonk/*` packages in one fixed Changesets group. With
  the current highest package version at `0.6.0`, `changeset version` will align
  the fixed group to `0.7.0`, including packages without a direct entry here.

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
