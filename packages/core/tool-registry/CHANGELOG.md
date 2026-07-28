# @gonk/tool-registry

## 0.4.0

### Minor Changes

- [`6d417cc`](https://github.com/nightwork-dev/gonk/commit/6d417cc6bdc72c59783e5987e643cf223db0c377) Thanks [@abrisene](https://github.com/abrisene)! - Add atomic source-catalog replacement and an authenticated Streamable HTTP MCP
  client that imports remote tools with host-owned authorization, provenance,
  refresh, cancellation, and timeout handling.

### Patch Changes

- [`b5d9a54`](https://github.com/nightwork-dev/gonk/commit/b5d9a542344db9affbc0f166d0b416cabbbb99c2) Thanks [@abrisene](https://github.com/abrisene)! - Document the Standard Schema-first tool-authoring path, expose the JSON Schema
  annotation helper as a focused subpath, and test MCP projection from annotated
  schemas.
- Updated dependencies []:
  - @gonk/auth@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.3.0

## 0.2.0

### Patch Changes

- [`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776) Thanks [@abrisene](https://github.com/abrisene)! - Add authorized deterministic context compilation with closed Standard Schema
  boundaries, in-process contributors, discovery/use authorization gates,
  canonical deduplication, token budgeting, blocked required-context outcomes,
  and redacted domain receipts. Add shared request-bound `AuthContext` capture so
  context compilation and tool dispatch use immutable principal snapshots and a
  once-bound authorization policy.
- Updated dependencies [[`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776)]:
  - @gonk/auth@0.2.0

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

- cd3152e: Add `dispatchDetachedWithWait` (`@gonk/tool-registry/async-dispatch`), a tool-layer
  detach-by-default / wait-opt-in combinator for heavy tools: dispatch a detached worker
  and return a job handle by default; the caller opts into blocking with `wait`/`sync`.
  Consumers own both render branches (`renderAsync` generic). GR-69.
- 4c3e116: Add typed client and JSON Schema projections for statically defined tool sets,
  plus a transport-agnostic WebSocket request/reply and authorized broadcast
  projection.

### Patch Changes

- Updated dependencies [369b951]
  - @gonk/auth@0.1.0
  - @gonk/scope@0.1.0

## 0.0.19

### Patch Changes

- Updated dependencies [cbfd6a4]
  - @gonk/scope@0.0.19

## 0.0.12

### Patch Changes

- Add optional `authorization?` field to `ToolDefinition` (and the `ToolAuthorization` type: `authLevel?` / `requiredRole?` / `allowedCallers?`). Declare-only in core — enforced by host gates such as `@gonk/pi-guard`, the same split as the existing `approval` field. Optional and backward-compatible. Enables the cross-agent comms / multi-user trust layer.

- Updated dependencies []:
  - @gonk/scope@0.0.12
