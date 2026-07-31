# @gonk/extension-spec-claude

Claude Code materializer for `@gonk/extension-spec`. Translates an `ExtensionSpec` into a Claude Code plugin tree on disk: `plugin.json`, `commands/*.md`, `hooks/hooks.json`, and optionally `.mcp.json`.

## How Claude Code loads a gonk plugin

Claude Code discovers plugins by scanning for `plugin.json` manifests. `materializeClaudePlugin` writes that tree into any directory you choose — typically `~/.claude/plugins/cache/<spec.id>`. The materializer is idempotent: re-running with the same spec produces the same files; files from a prior run that the new spec no longer needs are swept automatically (tracked via `.gonk-materialize.json`).

```ts
import { materializeClaudePlugin } from "@gonk/extension-spec-claude";

const manifest = materializeClaudePlugin({
  spec,                         // an ExtensionSpec from @gonk/extension-spec
  outDir: "~/.claude/plugins/cache/my-plugin",
  packageName: "@gonk/my-plugin",
  version: "1.2.3",
  // Optional: wire a bundled stdio MCP server
  mcpServerEntry: {
    command: "node",
    args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"],
  },
});
// manifest.written — relative paths of every file written
// manifest.pluginRoot — absolute path
```

## What gets written

| Path | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest (name, version, description, pointers) |
| `commands/<name>.md` | One file per slash command verb; frontmatter carries description, argument-hint, allowed-tools |
| `hooks/hooks.json` | Hook event → shell command dispatch table |
| `.mcp.json` | MCP server entry (when `mcpServerEntry` is set) |
| `.gonk-materialize.json` | Sidecar tracking the write set for sweep on next run |

## Hook placement

Spec-side hook events are mapped consistently by the materializer and runtime:
`session_start` → `SessionStart`, `session_end` → `SessionEnd`,
`turn_complete` → `Stop`, and `before_provider_request` →
`UserPromptSubmit`. The default dispatch binary is `gonk-claude-hook`; pass
`hookDispatchBinary` to override (e.g. an absolute `node <path>` form during
install). `SessionEnd` handlers run for cleanup/logging side effects; Claude
does not accept context or decision output for that event.

## MCP server convention

Each consuming package (e.g. `@gonk/claude-memory`) bundles its own `dist/mcp-server.cjs` via tsup. The materializer writes the `.mcp.json` that references it using `${CLAUDE_PLUGIN_ROOT}`, which Claude expands at connect time. The server is keyed by `spec.id` — one MCP server per plugin.

## Inverse

```ts
import { unmaterializeClaudePlugin } from "@gonk/extension-spec-claude";

unmaterializeClaudePlugin({ outDir: pluginRoot });
// Removes every file the materializer previously wrote
```

## Running hooks

The `gonk-claude-hook` binary calls `runClaudeHook` to execute the spec's hook handler when Claude fires a hook event:

```ts
import { runClaudeHook } from "@gonk/extension-spec-claude";
import type { ClaudeHookContext } from "@gonk/extension-spec-claude";
```

## Entry points

```ts
import { materializeClaudePlugin, unmaterializeClaudePlugin, readMaterializationManifest, pluginPath } from "@gonk/extension-spec-claude";
import { defaultCommandPlacement, defaultHookPlacement, runClaudeHook } from "@gonk/extension-spec-claude";
import type { MaterializeClaudeOptions, MaterializationManifest, McpServerEntry, ClaudeHookEvent, CommandPlacementPolicy } from "@gonk/extension-spec-claude";
```
