---
"@gonk/store": minor
"@gonk/retrieval": minor
"@gonk/temporal": minor
"@gonk/tool-registry": minor
"@gonk/skills": minor
"@gonk/tool-orchestrator": patch
"@gonk/tool-registry-cli": patch
"@gonk/tool-registry-mcp": patch
"@gonk/tool-registry-pi": patch
---

Release the R1 Core migration slice. `@gonk/store` adds the caller-owned
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
