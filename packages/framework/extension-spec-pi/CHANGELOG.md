# @gonk/extension-spec-pi

## 0.13.4

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry-pi@0.13.4
  - @gonk/auth@0.13.4
  - @gonk/scope@0.13.4
  - @gonk/store@0.13.4
  - @gonk/tool-registry@0.13.4
  - @gonk/extension-spec@0.13.4

## 0.13.3

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.13.3
  - @gonk/scope@0.13.3
  - @gonk/tool-registry-pi@0.13.3
  - @gonk/extension-spec@0.13.3
  - @gonk/store@0.13.3
  - @gonk/auth@0.13.3

## 0.13.2

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.13.2
  - @gonk/scope@0.13.2
  - @gonk/tool-registry@0.13.2
  - @gonk/store@0.13.2
  - @gonk/tool-registry-pi@0.13.2
  - @gonk/extension-spec@0.13.2

## 0.13.1

### Patch Changes

- Updated dependencies []:
  - @gonk/store@0.13.1
  - @gonk/tool-registry-pi@0.13.1
  - @gonk/auth@0.13.1
  - @gonk/scope@0.13.1
  - @gonk/tool-registry@0.13.1
  - @gonk/extension-spec@0.13.1

## 0.13.0

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.13.0
  - @gonk/tool-registry-pi@0.13.0
  - @gonk/extension-spec@0.13.0
  - @gonk/auth@0.13.0
  - @gonk/scope@0.13.0
  - @gonk/store@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry-pi@0.12.0
  - @gonk/auth@0.12.0
  - @gonk/scope@0.12.0
  - @gonk/store@0.12.0
  - @gonk/tool-registry@0.12.0
  - @gonk/extension-spec@0.12.0

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.11.1
  - @gonk/store@0.11.1
  - @gonk/tool-registry-pi@0.11.1
  - @gonk/tool-registry@0.11.1
  - @gonk/extension-spec@0.11.1
  - @gonk/auth@0.11.1

## 0.11.0

### Minor Changes

- [#11](https://github.com/nightwork-dev/gonk/pull/11) [`a50ba89`](https://github.com/nightwork-dev/gonk/commit/a50ba89c440e57851696b236c90822e2381ecc18) Thanks [@abrisene](https://github.com/abrisene)! - Add the host-owned Pi storage runtime and keep generated Pi runtime state from creating project boundaries. A `.agents` or `.gonk` namespace holding only host runtime directories (`gonk`, `pi-state`, `memory-state`, `autotune-claims`, `objective-watch`) no longer marks a project root. `findProjectRoot` takes an optional `ceiling` and `ScopeEnvironment` an optional `projectCeiling`, so a sandbox can stop the project walk at its own root.

### Patch Changes

- [#11](https://github.com/nightwork-dev/gonk/pull/11) [`85e4729`](https://github.com/nightwork-dev/gonk/commit/85e472961d209b5fa1aeb0dad352bf7607b9636d) Thanks [@abrisene](https://github.com/abrisene)! - Add host-owned storage (`@gonk/store/host-storage`). Pi and Codex hosts share one SQLite lease and one way to resolve storage paths, and get scope-bound state stores from it.

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`ffee550`](https://github.com/nightwork-dev/gonk/commit/ffee550b1873d2de756501cc28b12a67d60c7766) Thanks [@abrisene](https://github.com/abrisene)! - Claude: reject spec ids that are not kebab-case and single-quote the spec id and event in generated hook commands, so spec data cannot run shell commands. Codex: a placed hook whose payload omits `hook_event_name` runs side-effect-only instead of being skipped. Pi: `tool_complete` fires only for model-issued tool calls, not for calls a tool makes through `ctx.executeTool()`.

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`2b772e4`](https://github.com/nightwork-dev/gonk/commit/2b772e4216ca2ba09a2c2df099f63bbff7a2d7a0) Thanks [@abrisene](https://github.com/abrisene)! - Register portable `session_end` on Pi `session_shutdown` and `tool_complete` on `tool_execution_end`, and make the settings edit flow read, write and clear keyed settings through their keyed map.
- Updated dependencies [[`85e4729`](https://github.com/nightwork-dev/gonk/commit/85e472961d209b5fa1aeb0dad352bf7607b9636d), [`3dbb981`](https://github.com/nightwork-dev/gonk/commit/3dbb981d7f01f45ffa61a911221325dfe453586e), [`2b772e4`](https://github.com/nightwork-dev/gonk/commit/2b772e4216ca2ba09a2c2df099f63bbff7a2d7a0), [`a50ba89`](https://github.com/nightwork-dev/gonk/commit/a50ba89c440e57851696b236c90822e2381ecc18)]:
  - @gonk/store@0.11.0
  - @gonk/tool-registry-pi@0.11.0
  - @gonk/scope@0.11.0
  - @gonk/tool-registry@0.11.0
  - @gonk/extension-spec@0.11.0
  - @gonk/auth@0.11.0

## 0.8.0

### Minor Changes

- 19c0dd5: Require Pi extension hosts to supply the internal tool registry security policy explicitly.

### Patch Changes

- @gonk/tool-registry-pi@0.8.0
- @gonk/auth@0.8.0
- @gonk/scope@0.8.0
- @gonk/tool-registry@0.8.0
- @gonk/extension-spec@0.8.0

## 0.7.0

### Patch Changes

- Updated dependencies [5c47c3e]
  - @gonk/tool-registry@0.7.0
  - @gonk/tool-registry-pi@0.7.0
  - @gonk/extension-spec@0.7.0
  - @gonk/auth@0.7.0
  - @gonk/scope@0.7.0

## 0.4.0

### Patch Changes

- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33), [`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/tool-registry@0.4.0
  - @gonk/tool-registry-pi@0.4.0
  - @gonk/extension-spec@0.4.0
  - @gonk/scope@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies [[`eb4179c`](https://github.com/nightwork-dev/gonk/commit/eb4179cc95ae14732ddc4ac66b398296ca31fdf0)]:
  - @gonk/scope@0.3.1
  - @gonk/tool-registry-pi@0.3.1
  - @gonk/tool-registry@0.3.1
  - @gonk/extension-spec@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry-pi@0.3.0
  - @gonk/scope@0.3.0
  - @gonk/tool-registry@0.3.0
  - @gonk/extension-spec@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776)]:
  - @gonk/tool-registry@0.2.0
  - @gonk/tool-registry-pi@0.2.0
  - @gonk/extension-spec@0.2.0
  - @gonk/scope@0.2.0

## 0.1.0

### Patch Changes

- Updated dependencies [369b951]
- Updated dependencies [cd3152e]
- Updated dependencies [4c3e116]
  - @gonk/tool-registry@0.1.0
  - @gonk/tool-registry-pi@0.1.0
  - @gonk/extension-spec@0.1.0
  - @gonk/scope@0.1.0

## 0.0.19

### Patch Changes

- Updated dependencies [cbfd6a4]
  - @gonk/scope@0.0.19
  - @gonk/tool-registry-pi@0.0.19
  - @gonk/tool-registry@0.0.19
  - @gonk/extension-spec@0.0.19

## 0.0.12

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.0.12
  - @gonk/tool-registry-pi@0.0.12
  - @gonk/extension-spec@0.0.12
  - @gonk/scope@0.0.12
