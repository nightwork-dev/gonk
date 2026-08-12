# @gonk/retrieval

## 0.8.0

### Patch Changes

- @gonk/auth@0.8.0
- @gonk/context@0.8.0
- @gonk/store@0.8.0

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
  - @gonk/auth@0.7.0
  - @gonk/context@0.7.0

## 0.6.0

### Minor Changes

- Add the shared retrieval evidence coordinator contract for cross-source evidence packets, global prompt-budget selection, and contributor receipts.

## 0.4.0

### Patch Changes

- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/store@0.4.0
  - @gonk/auth@0.4.0
  - @gonk/context@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @gonk/store@0.3.1
  - @gonk/auth@0.3.1
  - @gonk/context@0.3.1

## 0.3.0

### Minor Changes

- [`ac9d728`](https://github.com/nightwork-dev/gonk/commit/ac9d7284e9155a6dc30cdbad0404f6a8d01badea) Thanks [@abrisene](https://github.com/abrisene)! - Add the optional `@gonk/retrieval/context` adapter for projecting explicitly selected retrieval hits into `@gonk/context` candidates and for projecting authorized source health/freshness from the existing retrieval registry without a second source registry.

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.3.0
  - @gonk/context@0.3.0
  - @gonk/store@0.3.0

## 0.2.0

### Minor Changes

- [`8d2339d`](https://github.com/nightwork-dev/gonk/commit/8d2339dc7c851a4e20e41b2c1622a1aaf7751666) Thanks [@abrisene](https://github.com/abrisene)! - Add authorized retrieval contracts and a deterministic lexical baseline with
  in-process native/coordinated sources, immutable index generations, tombstones,
  three authorization gates, authorization-before-filtering for coordinated
  sources, an explicit native authorized-corpus ranking contract, metadata-only
  hits, authoritative content resolution, stable citations, redacted domain
  receipts, and reusable conformance cases.

### Patch Changes

- Updated dependencies [[`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776)]:
  - @gonk/auth@0.2.0
  - @gonk/store@0.2.0
