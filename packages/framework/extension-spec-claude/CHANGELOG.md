# @gonk/extension-spec-claude

## 0.13.0

### Patch Changes

- Updated dependencies []:
  - @gonk/extension-spec@0.13.0
  - @gonk/utils@0.13.0

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @gonk/utils@0.12.0
  - @gonk/extension-spec@0.12.0

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @gonk/extension-spec@0.11.1
  - @gonk/utils@0.11.1

## 0.11.0

### Minor Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`2b772e4`](https://github.com/nightwork-dev/gonk/commit/2b772e4216ca2ba09a2c2df099f63bbff7a2d7a0) Thanks [@abrisene](https://github.com/abrisene)! - Map the portable tool_complete event to Claude Code PostToolUse and return advisory additionalContext without blocking the tool result.

### Patch Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`ffee550`](https://github.com/nightwork-dev/gonk/commit/ffee550b1873d2de756501cc28b12a67d60c7766) Thanks [@abrisene](https://github.com/abrisene)! - Claude: reject spec ids that are not kebab-case and single-quote the spec id and event in generated hook commands, so spec data cannot run shell commands. Codex: a placed hook whose payload omits `hook_event_name` runs side-effect-only instead of being skipped. Pi: `tool_complete` fires only for model-issued tool calls, not for calls a tool makes through `ctx.executeTool()`.
- Updated dependencies []:
  - @gonk/extension-spec@0.11.0
  - @gonk/utils@0.11.0

## 0.8.0

### Patch Changes

- @gonk/utils@0.8.0
- @gonk/extension-spec@0.8.0

## 0.7.0

### Patch Changes

- e4c9cd4: Invoke `turn_complete` and `session_end` handlers through Claude Code's `Stop`
  and `SessionEnd` hooks instead of silently skipping them. Session-end handlers
  remain side-effect-only because Claude does not accept context output there.
  - @gonk/extension-spec@0.7.0
  - @gonk/utils@0.7.0

## 0.5.1

### Patch Changes

- Allow the Claude hook dispatcher to load ESM hook runtimes while retaining
  the existing CommonJS fallback.

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

### Patch Changes

- @gonk/extension-spec@0.1.0
- @gonk/utils@0.1.0

## 0.0.19

### Patch Changes

- cbfd6a4: Security fixes + extract `@gonk/utils`.

  - **`@gonk/tool-registry-mcp`**: the HTTP server no longer silently exposes
    unauthenticated tool execution. Serving it beyond your own machine now takes a
    deliberate choice — set an `apiKey`, or `allowInsecure: true` to trust the
    network — otherwise it refuses to start. DNS-rebinding protection is on for a
    local (loopback) bind, and for a remote bind that lists the host(s) clients
    will dial via `allowedHosts`; a protected remote bind with no `allowedHosts`
    refuses to start rather than accept connections it would then reject on every
    request; the keyless trusted-network mode turns the check off. Adds the
    `allowInsecure` / `allowedHosts` options and the `--allow-insecure` /
    `--allowed-hosts` CLI flags. See the package README for plain-English
    local-vs-remote setup.
  - **`@gonk/extension-spec-claude`**: confine all materialized writes and deletes
    to the plugin root — spec-derived command/verb filenames could previously
    traverse out via `..`.
  - **`@gonk/utils`** (new): zero-dependency fs-safety primitives, consolidating
    three drifting copies. Code-split per platform — `@gonk/utils/path` is pure,
    browser-safe path containment; `@gonk/utils/fs` is Node-only atomic writes.
  - **`@gonk/scope`**, **`@gonk/store`**: migrated onto `@gonk/utils` (no public
    API change).

- Updated dependencies [cbfd6a4]
  - @gonk/utils@0.0.19
  - @gonk/extension-spec@0.0.19

## 0.0.12

### Patch Changes

- Updated dependencies []:
  - @gonk/extension-spec@0.0.12
