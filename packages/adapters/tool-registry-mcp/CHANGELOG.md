# @gonk/tool-registry-mcp

## 0.13.2

### Patch Changes

- When `makeAuthContext` returns a different principal than the one the request authenticated, the HTTP server now refuses the request and logs why. JSON routes answer 403 with the reason, in the same shape as the Host and Origin refusals. Before, they answered 500 "internal error" and the server logged nothing. The log line goes to `options.log`, or to `console.error` when no logger is set.

- Rewrite the README for a developer who meets the package for the first time: what it is, how it fits with the other `@gonk/*` packages, how to install it, the shortest real first use, then the main features. Correct README claims that no longer matched the code. Remove internal notes from source comments, which ship in the sourcemaps. The README and comment changes do not change code behaviour.
- Updated dependencies []:
  - @gonk/auth@0.13.2
  - @gonk/tool-registry@0.13.2
  - @gonk/tool-orchestrator@0.13.2

## 0.13.1

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.13.1
  - @gonk/tool-orchestrator@0.13.1
  - @gonk/tool-registry@0.13.1

## 0.13.0

### Minor Changes

- Serve packaged skills through native MCP Skills and the existing portable tools using one verified catalog. Update the MCP TypeScript client and server to 2.4.0.

- A registry's `instructions` now reach MCP, JSON HTTP, CLI help and Pi tools. The MCP servers for HTTP and stdio serve the stateless `2026-07-28` protocol revision as well as the older `initialize` handshake. The MCP importer negotiates either revision.

### Patch Changes

- Enforce the body size limit while reading MCP and JSON HTTP requests. Return HTTP 413 as soon as the upload exceeds the limit.
- Updated dependencies []:
  - @gonk/tool-registry@0.13.0
  - @gonk/tool-orchestrator@0.13.0
  - @gonk/auth@0.13.0

## 0.12.0

### Minor Changes

- Add opt-in JSON HTTP routes (`jsonPath`) beside MCP, and read-only tools that serve skills bundled with an application (`@gonk/skills/bundled`). CLI help reads the JSON Schema attached to a tool's input. The earlier fix for symlinks in shared namespaces is kept.

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.12.0
  - @gonk/tool-orchestrator@0.12.0
  - @gonk/tool-registry@0.12.0

## 0.11.1

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.11.1
  - @gonk/auth@0.11.1
  - @gonk/tool-orchestrator@0.11.1

## 0.11.0

### Patch Changes

- [#10](https://github.com/nightwork-dev/gonk/pull/10) [`dd6f19f`](https://github.com/nightwork-dev/gonk/commit/dd6f19f5a6fcbf3c245be6be27fbf7a6e9489986) Thanks [@abrisene](https://github.com/abrisene)! - Require a Node release with the CVE-2026-111497 fix (22.23.4, 24.22.1 or 26.12.1 and later), and update the MCP SDK to 2.3.0 with patched transitive dependencies.
- Updated dependencies []:
  - @gonk/tool-registry@0.11.0
  - @gonk/auth@0.11.0
  - @gonk/tool-orchestrator@0.11.0

## 0.8.0

### Patch Changes

- @gonk/auth@0.8.0
- @gonk/tool-orchestrator@0.8.0
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
  - @gonk/tool-orchestrator@0.7.0
  - @gonk/auth@0.7.0

## 0.4.0

### Minor Changes

- [`6d417cc`](https://github.com/nightwork-dev/gonk/commit/6d417cc6bdc72c59783e5987e643cf223db0c377) Thanks [@abrisene](https://github.com/abrisene)! - Add atomic source-catalog replacement and an authenticated Streamable HTTP MCP
  client that imports remote tools with host-owned authorization, provenance,
  refresh, cancellation, and timeout handling.

### Patch Changes

- [`132d852`](https://github.com/nightwork-dev/gonk/commit/132d8525769ed69f713494779b3ee6b80b3258e7) Thanks [@abrisene](https://github.com/abrisene)! - Add a tested hand-authored GitHub API adapter example covering host-owned
  credentials, pre-network authorization and approval, typed results, safe error
  redaction, cancellation, timeouts, and MCP reprojection.

- [`b5d9a54`](https://github.com/nightwork-dev/gonk/commit/b5d9a542344db9affbc0f166d0b416cabbbb99c2) Thanks [@abrisene](https://github.com/abrisene)! - Document the Standard Schema-first tool-authoring path, expose the JSON Schema
  annotation helper as a focused subpath, and test MCP projection from annotated
  schemas.
- Updated dependencies [[`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33), [`92df856`](https://github.com/nightwork-dev/gonk/commit/92df8563b9907d54978376305f4ad9a642512d33)]:
  - @gonk/tool-registry@0.4.0
  - @gonk/tool-orchestrator@0.4.0
  - @gonk/auth@0.4.0

## 0.3.1

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.3.1
  - @gonk/auth@0.3.1
  - @gonk/tool-orchestrator@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/auth@0.3.0
  - @gonk/tool-orchestrator@0.3.0
  - @gonk/tool-registry@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [[`418a514`](https://github.com/nightwork-dev/gonk/commit/418a514eb67e3fb8dbde6927e9bb4b5f12a00776)]:
  - @gonk/auth@0.2.0
  - @gonk/tool-registry@0.2.0
  - @gonk/tool-orchestrator@0.2.0

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

- 2f1429c: Add a development MCP switchboard that keeps one HTTP MCP registration stable while safely selecting among worktree environments. Add a mountable Web-standard MCP handler and trusted request-context hook so applications can expose their registry from an existing framework route instead of starting a second HTTP server.

### Patch Changes

- Updated dependencies [369b951]
- Updated dependencies [cd3152e]
- Updated dependencies [4c3e116]
  - @gonk/auth@0.1.0
  - @gonk/tool-registry@0.1.0
  - @gonk/tool-orchestrator@0.1.0

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
  - @gonk/tool-registry@0.0.19
  - @gonk/tool-orchestrator@0.0.19

## 0.0.12

### Patch Changes

- Updated dependencies []:
  - @gonk/tool-registry@0.0.12
  - @gonk/tool-orchestrator@0.0.12
