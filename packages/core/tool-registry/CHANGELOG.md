# @gonk/tool-registry

## 1.0.0

### Major Changes

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

### Minor Changes

- cd3152e: Add `dispatchDetachedWithWait` (`@gonk/tool-registry/async-dispatch`), a tool-layer
  detach-by-default / wait-opt-in combinator for heavy tools: dispatch a detached worker
  and return a job handle by default; the caller opts into blocking with `wait`/`sync`.
  Consumers own both render branches (`renderAsync` generic). GR-69.
- 4c3e116: Add typed client and JSON Schema projections for statically defined tool sets,
  plus a transport-agnostic WebSocket request/reply and authorized broadcast
  projection.

### Patch Changes

- Updated dependencies [369b951]
  - @gonk/auth@1.0.0
  - @gonk/scope@1.0.0

## 0.0.19

### Patch Changes

- Updated dependencies [cbfd6a4]
  - @gonk/scope@0.0.19

## 0.0.12

### Patch Changes

- Add optional `authorization?` field to `ToolDefinition` (and the `ToolAuthorization` type: `authLevel?` / `requiredRole?` / `allowedCallers?`). Declare-only in core — enforced by host gates such as `@gonk/pi-guard`, the same split as the existing `approval` field. Optional and backward-compatible. Enables the cross-agent comms / multi-user trust layer.

- Updated dependencies []:
  - @gonk/scope@0.0.12
