# @gonk/extension-spec-codex

Codex materializer for `@gonk/extension-spec`. It translates an `ExtensionSpec`
into a Codex plugin tree on disk: `.codex-plugin/plugin.json`, optional
`.mcp.json`, `skills/*/SKILL.md`, optional `hooks/hooks.json`, and
`.gonk-materialize.json`.

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
| `hooks/hooks.json` | Cache-safe lifecycle dispatch for recognized `spec.hooks` entries |
| `hooks/gonk-codex-hook.mjs` | Plugin-local dispatcher referenced through `PLUGIN_ROOT` |
| `.gonk-materialize.json` | Sidecar tracking the write set for sweep on next run |

## MCP server convention

Existing gonk Codex packages use ESM MCP servers launched by Node:
`node ./dist/mcp-server.js` with `cwd: "."`. Server keys default to
`gonk-<spec.id>` so Codex server identity stays distinct from Claude's bare
capability keys.

## Hook convention and cache epochs

When `spec.hooks` contains recognized portable events, the materializer writes
`hooks/hooks.json`, emits a plugin-local dispatcher, and points the plugin
manifest at the hook file. Consumers that use hook dispatch must first bundle their spec as
`dist/hook-spec.cjs`, exporting the `ExtensionSpec` (or a zero-argument factory)
as the default export. Materialization fails rather than activating hooks when
that artifact is absent. Codex supplies the plugin root through `PLUGIN_ROOT`,
and generated commands resolve the dispatcher only through that anchored path.

The default mapping is deliberately narrow:

| Portable event | Codex event | Context contract |
|---|---|---|
| `session_start` | `SessionStart` (`startup\|resume\|clear\|compact`) | May emit a deterministic instruction floor, capped at 16,384 characters |
| `before_provider_request` | `UserPromptSubmit` | Side effects only; runtime output is always `{}` |
| `turn_complete` | `Stop` | Side effects only; runtime output is always `{}` |

Codex reports post-compaction reinjection as `SessionStart` with
`source: "compact"`; `PostCompact` itself does not support additional developer
context. The runtime therefore grants `injectContext()` only when both the
portable event is `session_start` and the host payload proves a real
`SessionStart` boundary with a valid source. Every non-boundary event receives a
side-effect-only context and is hard-clamped to empty JSON, even where Codex
itself supports dynamic `additionalContext`. That keeps the cached prompt prefix
byte-stable inside an epoch. Query-dependent memory, knowledge, persona, and
self-model context remains pull-based through tools and skills.

Spec-owned stdout is suppressed for every event, covering module evaluation,
factory resolution, and handler execution: `console.log`, `console.info`,
`console.debug`, and direct `process.stdout.write` calls cannot corrupt Codex's
JSON hook protocol. Stderr remains available for diagnostics.

Plugin hooks retain Codex's normal hash-based trust review; installation or
enablement alone does not trust a generated command hook.
