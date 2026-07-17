# @gonk/extension-spec-codex

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/utils@0.3.0
  - @gonk/extension-spec@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @gonk/extension-spec@0.2.0
  - @gonk/utils@0.2.0

## 0.1.0

### Minor Changes

- aa5dd4f: Add the Codex materializer for shared gonk extension specs.

  `@gonk/extension-spec-codex` turns an `ExtensionSpec` into a Codex plugin tree:
  `.codex-plugin/plugin.json`, optional `.mcp.json`, Codex skill files, and a
  `.gonk-materialize.json` sidecar used for idempotent reruns and stale generated
  file cleanup. It now also materializes trust-reviewed `hooks/hooks.json` lifecycle
  dispatch, with developer-context injection structurally limited to real
  `SessionStart` cache boundaries (including `source: "compact"`) and all
  non-boundary hook output clamped to empty JSON. Spec-owned stdout is suppressed
  during module evaluation, factory resolution, and handler execution so only
  dispatcher-owned JSON reaches Codex; stderr remains diagnostic.

### Patch Changes

- @gonk/extension-spec@0.1.0
- @gonk/utils@0.1.0
