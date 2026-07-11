# @gonk/extension-spec-codex

Codex materializer for `@gonk/extension-spec`. It translates an `ExtensionSpec`
into a Codex plugin tree on disk: `.codex-plugin/plugin.json`, optional
`.mcp.json`, `skills/*/SKILL.md`, and `.gonk-materialize.json`.

## How Codex loads a gonk plugin

Codex discovers installed plugins from versioned plugin cache trees under
`~/.codex/plugins/cache/**/.codex-plugin/plugin.json`. `materializeCodexPlugin`
writes the same contract into any plugin root you choose. Re-running is
idempotent, and obsolete files from a prior run are swept according to the
`.gonk-materialize.json` sidecar.

```ts
import { materializeCodexPlugin } from "@gonk/extension-spec-codex";

const manifest = materializeCodexPlugin({
  spec,
  outDir: "~/.codex/plugins/cache/gonk/codex-memory/0.0.0",
  packageName: "@gonk/codex-memory",
  version: "1.2.3",
  mcpServerEntry: {
    command: "node",
    args: ["./dist/mcp-server.js"],
    cwd: ".",
  },
});
```

## What gets written

| Path | Purpose |
|---|---|
| `.codex-plugin/plugin.json` | Plugin manifest and interface metadata |
| `.mcp.json` | MCP server entry, when `mcpServerEntry` is set |
| `skills/<name>/SKILL.md` | Codex skill guidance derived from the spec command or explicit skills |
| `.gonk-materialize.json` | Sidecar tracking the write set for sweep on next run |

## MCP server convention

Existing gonk Codex packages use ESM MCP servers launched by Node:
`node ./dist/mcp-server.js` with `cwd: "."`. Server keys default to
`gonk-<spec.id>` so Codex server identity stays distinct from Claude's bare
capability keys.

## Scope

This package does not invent a Codex session hook runtime. If Codex exposes a
stable session-start hook surface, that hook materialization can be added as a
host-contract extension without changing the shared `ExtensionSpec` shape.
