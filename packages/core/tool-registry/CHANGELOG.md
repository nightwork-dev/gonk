# @gonk/tool-registry

## 0.0.12

### Patch Changes

- Add optional `authorization?` field to `ToolDefinition` (and the `ToolAuthorization` type: `authLevel?` / `requiredRole?` / `allowedCallers?`). Declare-only in core — enforced by host gates such as `@gonk/pi-guard`, the same split as the existing `approval` field. Optional and backward-compatible. Enables the cross-agent comms / multi-user trust layer.

- Updated dependencies []:
  - @gonk/scope@0.0.12
