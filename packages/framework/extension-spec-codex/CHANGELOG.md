# @gonk/extension-spec-codex

## 0.13.1

### Patch Changes

- Updated dependencies []:
  - @gonk/store@0.13.1
  - @gonk/scope@0.13.1
  - @gonk/utils@0.13.1
  - @gonk/extension-spec@0.13.1

## 0.13.0

### Patch Changes

- Updated dependencies []:
  - @gonk/extension-spec@0.13.0
  - @gonk/scope@0.13.0
  - @gonk/store@0.13.0
  - @gonk/utils@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.12.0
  - @gonk/store@0.12.0
  - @gonk/utils@0.12.0
  - @gonk/extension-spec@0.12.0

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.11.1
  - @gonk/store@0.11.1
  - @gonk/extension-spec@0.11.1
  - @gonk/utils@0.11.1

## 0.11.0

### Minor Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`2b772e4`](https://github.com/nightwork-dev/gonk/commit/2b772e4216ca2ba09a2c2df099f63bbff7a2d7a0) Thanks [@abrisene](https://github.com/abrisene)! - Add opt-in Codex action-context hook placements (PreToolUse, PostToolUse and UserPromptSubmit) bound to their materialized event, and recognize forked SessionStart events.

- [#11](https://github.com/nightwork-dev/gonk/pull/11) [`85e4729`](https://github.com/nightwork-dev/gonk/commit/85e472961d209b5fa1aeb0dad352bf7607b9636d) Thanks [@abrisene](https://github.com/abrisene)! - Add host-owned storage (`@gonk/store/host-storage`). Pi and Codex hosts share one SQLite lease and one way to resolve storage paths, and get scope-bound state stores from it.

### Patch Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`ffee550`](https://github.com/nightwork-dev/gonk/commit/ffee550b1873d2de756501cc28b12a67d60c7766) Thanks [@abrisene](https://github.com/abrisene)! - Claude: reject spec ids that are not kebab-case and single-quote the spec id and event in generated hook commands, so spec data cannot run shell commands. Codex: a placed hook whose payload omits `hook_event_name` runs side-effect-only instead of being skipped. Pi: `tool_complete` fires only for model-issued tool calls, not for calls a tool makes through `ctx.executeTool()`.
- Updated dependencies [[`85e4729`](https://github.com/nightwork-dev/gonk/commit/85e472961d209b5fa1aeb0dad352bf7607b9636d), [`3dbb981`](https://github.com/nightwork-dev/gonk/commit/3dbb981d7f01f45ffa61a911221325dfe453586e), [`a50ba89`](https://github.com/nightwork-dev/gonk/commit/a50ba89c440e57851696b236c90822e2381ecc18)]:
  - @gonk/store@0.11.0
  - @gonk/scope@0.11.0
  - @gonk/extension-spec@0.11.0
  - @gonk/utils@0.11.0

## 0.8.0

### Patch Changes

- @gonk/utils@0.8.0
- @gonk/extension-spec@0.8.0

## 0.7.0

### Patch Changes

- @gonk/extension-spec@0.7.0
- @gonk/utils@0.7.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @gonk/extension-spec@0.4.0
  - @gonk/utils@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @gonk/extension-spec@0.3.1
  - @gonk/utils@0.3.1

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
