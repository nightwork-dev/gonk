---
"@gonk/extension-spec-claude": patch
"@gonk/tool-registry-mcp": patch
"@gonk/utils": patch
"@gonk/scope": patch
"@gonk/store": patch
---

Security fixes + extract `@gonk/utils`.

- **`@gonk/tool-registry-mcp`**: refuse a non-loopback HTTP bind with no `apiKey`
  unless `allowInsecure: true` is set (was an unauthenticated tool-execution
  endpoint on the documented happy path); DNS-rebinding protection now defaults
  on. Adds the `allowInsecure` option and the `--allow-insecure` CLI flag.
- **`@gonk/extension-spec-claude`**: confine all materialized writes and deletes
  to the plugin root — spec-derived command/verb filenames could previously
  traverse out via `..`.
- **`@gonk/utils`** (new): zero-dependency fs-safety primitives, consolidating
  three drifting copies. Code-split per platform — `@gonk/utils/path` is pure,
  browser-safe path containment; `@gonk/utils/fs` is Node-only atomic writes.
- **`@gonk/scope`**, **`@gonk/store`**: migrated onto `@gonk/utils` (no public
  API change).
