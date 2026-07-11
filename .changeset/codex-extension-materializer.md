---
"@gonk/extension-spec-codex": minor
---

Add the Codex materializer for shared gonk extension specs.

`@gonk/extension-spec-codex` turns an `ExtensionSpec` into a Codex plugin tree:
`.codex-plugin/plugin.json`, optional `.mcp.json`, Codex skill files, and a
`.gonk-materialize.json` sidecar used for idempotent reruns and stale generated
file cleanup.
