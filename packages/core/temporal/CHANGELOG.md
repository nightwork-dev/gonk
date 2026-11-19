# @gonk/temporal

## 0.13.1

No changes in this release.

## 0.13.0

No changes in this release.

## 0.12.0

No changes in this release.

## 0.11.1

No changes in this release.

## 0.11.0

### Patch Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`3dbb981`](https://github.com/nightwork-dev/gonk/commit/3dbb981d7f01f45ffa61a911221325dfe453586e) Thanks [@abrisene](https://github.com/abrisene)! - Depend on `@mirk/store` 0.13.0. `@gonk/store` accepts better-sqlite3 11, 12 or 13 and no longer passes the removed `forceJsCosine` option; exact cosine is now Mirk's only vector search path.

## 0.8.0

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

## 0.4.0

### Patch Changes

- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/store@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @gonk/store@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/store@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @gonk/store@0.2.0

## 0.1.0

### Patch Changes

- @gonk/store@0.1.0

## 0.0.19

### Patch Changes

- Updated dependencies [cbfd6a4]
- Updated dependencies [5b9d4b4]
  - @gonk/store@0.0.19
