# @gonk/tool-orchestrator

## 0.13.1

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.13.1

## 0.13.0

### Minor Changes

- A registry's `instructions` now reach MCP, JSON HTTP, CLI help and Pi tools. The MCP servers for HTTP and stdio serve the stateless `2026-07-28` protocol revision as well as the older `initialize` handshake. The MCP importer negotiates either revision.

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.12.0

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.11.1

## 0.11.0

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.11.0

## 0.8.0

### Patch Changes

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

## 0.4.0

### Patch Changes

- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33), [`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/tool-registry@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776)]:
  - @gonk/tool-registry@0.2.0

## 0.1.0

### Minor Changes

- 369b951: Add transport-independent authenticated principals, delegation-aware session
  and persistent-grant keys, registry-level discovery and invocation
  authorization, authoritative resource resolution, approval providers, and
  separate redacted authorization/approval receipts.

  Secure orchestrator meta-tool discovery and streamable-HTTP MCP sessions,
  including principal-filtered tool lists, structured approval-required results,
  and session binding across POST, GET, and DELETE.

  The short-lived MCP `authorize({ tool, input, request, approval })` callback has
  been removed. Authenticated MCP consumers must provide `makeAuthContext`;
  consent and risk decisions belong in the registry `ApprovalProvider`.

  Fail authenticated write and exec approvals closed when no provider is
  configured, treat missing or malformed approval declarations as exec, and
  support only an explicit registry approval bypass for trusted hosts.

  Make `makeAuthContext` the sole MCP authorization seam, classify write-tier
  tools for MCP allowlisting, require approval for orchestrator pin mutations,
  and filter hidden tools before computing search scores.

### Patch Changes

- Updated dependencies [369b951]
- Updated dependencies [cd3152e]
- Updated dependencies [4c3e116]
  - @gonk/tool-registry@0.1.0

## 0.0.19

### Patch Changes

- @gonk/tool-registry@0.0.19

## 0.0.12

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.0.12
