# @gonk/skills

## 0.8.0

### Patch Changes

- @gonk/auth@0.8.0
- @gonk/context@0.8.0
- @gonk/scope@0.8.0
- @gonk/store@0.8.0
- @gonk/tool-registry@0.8.0

## 0.7.0

### Minor Changes

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
