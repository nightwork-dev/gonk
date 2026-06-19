import type { ExtensionSpec, SlashCommandSpec, SubcommandSpec } from "@gonk/extension-spec";

// =============================================================================
// Materialization options + manifest
// =============================================================================

/** Input to `materializeClaudePlugin`. The spec is the same data shape that
 *  drives the Pi and CLI runtimes; this materializer translates it into
 *  Claude Code's filesystem-discovered plugin contract. */
export interface MaterializeClaudeOptions {
  /** The spec to materialize. Required. */
  spec: ExtensionSpec;

  /** Plugin root on disk. Required — the materializer writes inside this
   *  directory. Caller is responsible for choosing where (e.g.
   *  `~/.claude/plugins/cache/<spec.id>`). The directory will be created if
   *  missing. */
  outDir: string;

  /** Package name to record in `plugin.json` (e.g. `"@gonk/claude-memory"`).
   *  Falls back to `spec.id` when absent. */
  packageName?: string;

  /** Version string recorded in `plugin.json`. Defaults to `"0.0.0"`. */
  version?: string;

  /** Optional override of how each command/subcommand maps to a Claude
   *  `commands/<file>.md`. Default flattens `/<name> <verb>` to
   *  `<name>-<verb>.md`. */
  commandPlacement?: CommandPlacementPolicy;

  /** Optional override of how hooks map to Claude hook events. Default uses
   *  the table in `placement.ts`. */
  hookPlacement?: HookPlacementPolicy;

  /** Optional shim binary the materializer references from `hooks/hooks.json`.
   *  Default: `gonk-claude-hook` (resolved from $PATH at hook-fire time). */
  hookDispatchBinary?: string;

  /** Optional MCP server entry. When present the materializer writes an
   *  `.mcp.json` next to `plugin.json` so Claude connects to a single
   *  per-plugin stdio MCP server at session start.
   *
   *  Per-plugin model (matches Claude's plugin contract): the consuming
   *  package (e.g. `@gonk/claude-memory`)
   *  is responsible for producing its own bundled `dist/mcp-server.cjs`
   *  via tsup. The materializer does NOT bundle source — it only writes
   *  the `.mcp.json` entry that references whatever path the consumer
   *  built.
   *
   *  Convention: write the literal string `${CLAUDE_PLUGIN_ROOT}` into
   *  `args` (and `env`) verbatim — Claude expands it at connect time.
   *  Example:
   *  ```ts
   *  mcpServerEntry: {
   *    command: "node",
   *    args: ["${CLAUDE_PLUGIN_ROOT}/dist/mcp-server.cjs"],
   *  }
   *  ```
   *  The server is registered in `.mcp.json` under the spec's `id` so
   *  each plugin owns exactly one MCP server keyed by plugin name. */
  mcpServerEntry?: McpServerEntry;
}

/** Shape of a single entry under `.mcp.json` → `mcpServers`. Subset of
 *  what Claude understands (stdio transport only — gonk plugins ship
 *  their server alongside the plugin, not over HTTP). */
export interface McpServerEntry {
  /** Executable Claude spawns at session start (e.g. `"node"`). */
  command: string;
  /** Arguments passed to `command`. Use the literal string
   *  `${CLAUDE_PLUGIN_ROOT}` to reference paths inside the plugin tree;
   *  Claude expands it at connect time. */
  args?: string[];
  /** Environment variables set on the spawned server. Same
   *  `${CLAUDE_PLUGIN_ROOT}` expansion applies. */
  env?: Record<string, string>;
}

/** Returned by `materializeClaudePlugin`. Lists every file written, relative
 *  to `outDir`, plus the absolute pluginRoot. `gonk doctor` consumes this to
 *  diff "what's on disk" against "what the spec says should be on disk." */
export interface MaterializationManifest {
  /** Absolute path to the plugin root (matches `outDir`). */
  pluginRoot: string;

  /** Spec id this manifest was produced from. */
  specId: string;

  /** Package name recorded in plugin.json. */
  packageName: string;

  /** Files written, paths relative to `pluginRoot`, in deterministic order. */
  written: string[];

  /** Subset of `written` reserved for the manifest itself — useful for
   *  callers (gonk doctor) that want to skip the self-describing artifact
   *  during diffing. */
  manifestPath: string;
}

// =============================================================================
// Placement policies
// =============================================================================

/** Result of placing a slash-command verb (or the bare command) into a Claude
 *  commands/*.md file. Returning `"drop"` skips materialization. */
export type CommandPlacementResult = { filename: string; body: string; frontmatter?: CommandFrontmatter } | "drop";

/** Input shape for the command placement function. `verb` is `null` for the
 *  bare `/<name>` invocation (no subcommand). */
export interface CommandPlacementInput {
  command: SlashCommandSpec;
  /** Verb name for subcommands; `null` for the bare command. */
  verb: string | null;
  /** The verb's subcommand spec; `null` for the bare command. */
  subcommand: SubcommandSpec | null;
}

/** Decide where (and how) each command/verb is written as a Claude command
 *  markdown file. */
export type CommandPlacementPolicy = (input: CommandPlacementInput) => CommandPlacementResult;

/** Claude command frontmatter fields the materializer supports. Subset of
 *  what Claude understands; we only emit keys with values. */
export interface CommandFrontmatter {
  description?: string;
  "argument-hint"?: string;
  "allowed-tools"?: string;
  model?: string;
  "disable-model-invocation"?: boolean;
}

// =============================================================================
// Hook placement
// =============================================================================

/** Spec-side hook event names recognized by the default hook placement.
 *  Mirrors what `extension-spec-pi/runtime.ts` wires through `pi.on(...)`. */
export type SpecHookEvent =
  | "session_start"
  | "session_end"
  | "turn_complete"
  | "before_provider_request";

/** Claude hook event names. See
 *  https://docs.claude.com/en/docs/claude-code/hooks for the full set. */
export type ClaudeHookEvent =
  | "SessionStart"
  | "SessionEnd"
  | "Stop"
  | "SubagentStop"
  | "PreToolUse"
  | "PostToolUse"
  | "UserPromptSubmit"
  | "PreCompact"
  | "Notification"
  | "PermissionRequest";

/** Single entry inside Claude's `hooks/hooks.json` matcher-list. */
export interface ClaudeHookCommand {
  type: "command";
  command: string;
  timeout?: number;
}

export interface ClaudeHookMatcher {
  matcher: string;
  hooks: ClaudeHookCommand[];
}

export interface ClaudeHooksFile {
  description?: string;
  hooks: Partial<Record<ClaudeHookEvent, ClaudeHookMatcher[]>>;
}

/** Decide which Claude hook events each spec-side hook surfaces under, and
 *  with what shell command. Returning an empty array drops the hook. */
export type HookPlacementPolicy = (input: HookPlacementInput) => Array<{
  event: ClaudeHookEvent;
  command: ClaudeHookCommand;
}>;

export interface HookPlacementInput {
  /** The spec-side hook event name (loose string because specs may use any
   *  event identifier). */
  specEvent: string;
  /** Spec id (for building dispatch commands). */
  specId: string;
  /** Dispatch binary the materializer was configured with. */
  dispatchBinary: string;
}

// =============================================================================
// Plugin manifest shape
// =============================================================================

/** The shape written to `<pluginRoot>/.claude-plugin/plugin.json`. We don't
 *  exhaustively model Claude's manifest — only the keys we emit. */
export interface ClaudePluginManifest {
  name: string;
  version: string;
  description: string;
  commands?: string;
  agents?: string;
  skills?: string;
  hooks?: string;
  mcpServers?: string;
}
