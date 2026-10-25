# @gonk/scope

## 0.11.1

### Patch Changes

- `canonicalPath` spells a path that does not exist yet through the canonical spelling of its nearest existing ancestor, so a session or global home keeps one spelling before and after its folder is created (on macOS, `/var` and `/private/var` no longer fork one endpoint into two). The resolver's private copy of that walk and host storage's hand-rolled variant are removed; skills compares a session home against the canonical global home.
- Updated dependencies []:
  - @gonk/utils@0.11.1

## 0.11.0

### Minor Changes

- [#11](https://github.com/nightwork-dev/gonk/pull/11) [`a50ba89`](https://github.com/nightwork-dev/gonk/commit/a50ba89c440e57851696b236c90822e2381ecc18) Thanks [@abrisene](https://github.com/abrisene)! - Add the host-owned Pi storage runtime and keep generated Pi runtime state from creating project boundaries. A `.agents` or `.gonk` namespace holding only host runtime directories (`gonk`, `pi-state`, `memory-state`, `autotune-claims`, `objective-watch`) no longer marks a project root. `findProjectRoot` takes an optional `ceiling` and `ScopeEnvironment` an optional `projectCeiling`, so a sandbox can stop the project walk at its own root.

### Patch Changes

- Updated dependencies []:
  - @gonk/utils@0.11.0

## 0.8.0

### Patch Changes

- @gonk/utils@0.8.0

## 0.7.0

### Patch Changes

- @gonk/utils@0.7.0

## 0.4.0

### Patch Changes

- Updated dependencies []:
  - @gonk/utils@0.4.0

## 0.3.1

### Patch Changes

- [`eb4179c`](https://github.com/nightwork-dev/gonk/commit/eb4179cc95ae14732ddc4ac66b398296ca31fdf0) Thanks [@abrisene](https://github.com/abrisene)! - Preserve each tier's resolved operational-state home even when document and root resolution deduplicates colliding tier paths. Explicit home overrides now remain authoritative when `cwd`, project, and global homes are the same directory.

- Updated dependencies []:
  - @gonk/utils@0.3.1

## 0.3.0

### Patch Changes

- Updated dependencies []:
  - @gonk/utils@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies []:
  - @gonk/utils@0.2.0

## 0.1.0

### Patch Changes

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

## 0.0.12
