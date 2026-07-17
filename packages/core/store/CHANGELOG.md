# @gonk/store

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @gonk/scope@0.2.0
  - @gonk/utils@0.2.0

## 0.1.0

### Patch Changes

- @gonk/scope@0.1.0
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

- 5b9d4b4: Add an fs-backed log tail helper used by the self-wake critical path.

  - New `tailLog` utility for reading newly-appended log entries from an offset.
  - Covered by regression tests for offset advancement and malformed/truncated rows.

- Updated dependencies [cbfd6a4]
  - @gonk/utils@0.0.19
  - @gonk/scope@0.0.19

## 0.0.12

### Patch Changes

- Add `FoldStore` — durable state as an append-only log with fold-on-read, over the existing `LogStore`. Concurrent writers append (no read-modify-write of a state blob), so independent handles over the same backing don't clobber; derive-on-wake reconciliation is a pure read, and `dedupeKey` makes a re-applied reconciliation event idempotent. `compact()` is a documented throwing stub pending a cross-process lock.

- Updated dependencies []:
  - @gonk/scope@0.0.12
