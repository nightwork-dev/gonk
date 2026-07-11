import type { ExtensionSpec, SlashCommandSpec, SubcommandSpec } from "@gonk/extension-spec";

// =============================================================================
// Materialization options + manifest
// =============================================================================

/** Input to `materializeCodexPlugin`. The shared `ExtensionSpec` remains the
 *  source of truth; this adapter translates it into Codex's filesystem plugin
 *  contract. */
export interface MaterializeCodexOptions {
  /** The shared host-agnostic spec to materialize. */
  spec: ExtensionSpec;

  /** Plugin root on disk. The materializer writes only inside this directory,
   *  creating it when missing. */
  outDir: string;

  /** Package name to record in `.codex-plugin/plugin.json`.
   *  Falls back to `spec.id` when absent. */
  packageName?: string;

  /** Version string recorded in `.codex-plugin/plugin.json`.
   *  Defaults to `"0.0.0"` so install-time callers can pin it explicitly. */
  version?: string;

  /** Optional Codex marketplace/interface metadata. Values supplied here
   *  override the defaults derived from the spec. */
  interface?: Partial<CodexPluginInterface>;

  /** Extra manifest fields copied into `.codex-plugin/plugin.json`.
   *  Useful for author/homepage/license metadata owned by the package. */
  manifest?: Partial<
    Omit<
      CodexPluginManifest,
      "name" | "version" | "description" | "skills" | "mcpServers" | "interface"
    >
  >;

  /** Optional override of how the spec command maps to Codex skill files.
   *  Defaults to one skill at `skills/gonk-<command.name>/SKILL.md`. */
  skillPlacement?: SkillPlacementPolicy;

  /** Optional override for translating portable spec hooks into Codex hook
   *  events. The result type separates cache-boundary hooks from side-effect
   *  hooks so non-boundary placements cannot request model context output. */
  hookPlacement?: CodexHookPlacementPolicy;

  /** Command prefix referenced from generated `hooks/hooks.json` entries.
   *  Must contain `$PLUGIN_ROOT`. Defaults to the materializer-emitted local
   *  runner at `node "$PLUGIN_ROOT/hooks/gonk-codex-hook.mjs"`. */
  hookDispatchBinary?: string;

  /** Explicit skills to write. When omitted, the default derives one skill from
   *  `spec.command` if present. */
  skills?: CodexSkill[];

  /** Optional MCP server entry. When present the materializer writes `.mcp.json`
   *  and points the plugin manifest's `mcpServers` field at it. */
  mcpServerEntry?: McpServerEntry;

  /** Key used under `.mcp.json` -> `mcpServers`.
   *  Defaults to `gonk-${spec.id}` to match the existing gonk Codex packages and
   *  keep server identity distinct from Claude's bare capability keys. */
  mcpServerKey?: string;
}

/** Shape of a single entry under `.mcp.json` -> `mcpServers`. Codex plugin
 *  examples use stdio entries with relative cwd rooted at the plugin directory,
 *  but HTTP entries are intentionally allowed for compatibility with existing
 *  Codex plugins. */
export interface McpServerEntry {
  type?: "stdio" | "http";
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  url?: string;
  bearer_token_env_var?: string;
  headers?: Record<string, string>;
}

/** Returned by `materializeCodexPlugin`. Lists every file written, relative to
 *  `outDir`, plus the absolute plugin root. */
export interface MaterializationManifest {
  pluginRoot: string;
  specId: string;
  packageName: string;
  written: string[];
  manifestPath: string;
}

// =============================================================================
// Codex plugin manifest shape
// =============================================================================

/** The shape written to `<pluginRoot>/.codex-plugin/plugin.json`. This models
 *  the keys gonk emits rather than every possible Codex marketplace field. */
export interface CodexPluginManifest {
  name: string;
  version: string;
  description: string;
  author?: {
    name: string;
    email?: string;
    url?: string;
  };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  skills?: string;
  mcpServers?: string;
  hooks?: string;
  interface?: CodexPluginInterface;
  bundledContentVariant?: string;
}

export interface CodexPluginInterface {
  displayName: string;
  shortDescription: string;
  longDescription: string;
  developerName?: string;
  category?: string;
  capabilities?: string[];
  websiteURL?: string;
  privacyPolicyURL?: string;
  termsOfServiceURL?: string;
  supportURL?: string;
  logo?: string;
  logoDark?: string;
  composerIcon?: string;
  defaultPrompt?: string[];
  brandColor?: string;
  brandColorDark?: string;
  screenshots?: string[];
}

// =============================================================================
// Skills
// =============================================================================

export interface CodexSkill {
  /** Directory name under `skills/`, e.g. `gonk-memory`. */
  name: string;
  /** Short routing description written to YAML frontmatter. */
  description: string;
  /** Markdown body written after frontmatter. */
  body: string;
}

export type SkillPlacementResult = CodexSkill | "drop";

export interface SkillPlacementInput {
  spec: ExtensionSpec;
  command: SlashCommandSpec;
  subcommands: Array<[string, SubcommandSpec]>;
}

export type SkillPlacementPolicy = (input: SkillPlacementInput) => SkillPlacementResult;

// =============================================================================
// Hooks
// =============================================================================

export type CodexHookEvent =
  | "SessionStart"
  | "PreToolUse"
  | "PermissionRequest"
  | "PostToolUse"
  | "PreCompact"
  | "PostCompact"
  | "UserPromptSubmit"
  | "SubagentStart"
  | "SubagentStop"
  | "Stop";

export interface CodexHookCommand {
  type: "command";
  command: string;
  timeout?: number;
  statusMessage?: string;
}

export interface CodexHookMatcher {
  matcher?: string;
  hooks: CodexHookCommand[];
}

export interface CodexHooksFile {
  hooks: Partial<Record<CodexHookEvent, CodexHookMatcher[]>>;
}

/** Only `SessionStart` may establish model-visible context. Its `compact`
 *  source is Codex's supported post-compaction cache boundary. */
export interface CodexBoundaryHookPlacement {
  kind: "boundary-context";
  event: "SessionStart";
  matcher: string;
  command: CodexHookCommand;
}

/** Non-boundary hooks may observe and perform side effects, but the generated
 *  runtime never emits prompt/developer context for them. */
export interface CodexSideEffectHookPlacement {
  kind: "side-effect";
  event: Exclude<CodexHookEvent, "SessionStart" | "SubagentStart">;
  matcher?: string;
  command: CodexHookCommand;
}

export type CodexHookPlacement = CodexBoundaryHookPlacement | CodexSideEffectHookPlacement;

export interface CodexHookPlacementInput {
  specEvent: string;
  specId: string;
  dispatchBinary: string;
}

export type CodexHookPlacementPolicy = (
  input: CodexHookPlacementInput,
) => CodexHookPlacement[];
