# @gonk/core

## 0.4.0

### Patch Changes

- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33), [`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/tool-registry@0.4.0
  - @gonk/auth@0.4.0
  - @gonk/scope@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`eb4179c`](https://github.com/nightwork-dev/gonk/commit/eb4179cc95ae14732ddc4ac66b398296ca31fdf0)]:
  - @gonk/scope@0.3.1
  - @gonk/tool-registry@0.3.1
  - @gonk/auth@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.3.0
  - @gonk/scope@0.3.0
  - @gonk/tool-registry@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776)]:
  - @gonk/auth@0.2.0
  - @gonk/tool-registry@0.2.0
  - @gonk/scope@0.2.0

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
  - @gonk/auth@0.1.0
  - @gonk/tool-registry@0.1.0
  - @gonk/scope@0.1.0

## 0.0.19

### Patch Changes

- Updated dependencies [cbfd6a4]
  - @gonk/scope@0.0.19
  - @gonk/tool-registry@0.0.19

## 0.0.12

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.0.12
  - @gonk/scope@0.0.12
