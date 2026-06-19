import type { ScopeName, ScopeStore } from "@gonk/scope";
import type { CapabilityReadiness, ToolDefinition } from "@gonk/tool-registry";

// =============================================================================
// Root spec
// =============================================================================

/** Declarative extension definition. A spec is data; host runtimes (e.g.
 *  `@gonk/extension-spec-pi`) consume it and produce a registered extension.
 *
 *  Design intent: 60%+ of every Pi extension we ship is recurring boilerplate
 *  (slash-command parsing, set/instructions/preset subcommands, settings TUI,
 *  preset CRUD). The spec lifts those patterns into framework-managed
 *  primitives so a new capability ships as ~150 lines of declarative spec
 *  plus the genuinely-novel capability code. */
export interface ExtensionSpec {
  /** Stable id, kebab-case. Becomes the manifest id and TUI namespace. */
  id: string;

  /** One-line description shown in extension lists. */
  description: string;

  /** Optional grouping for host-side extension registries. */
  category?: string;

  /** Whether the extension is enabled by default in the host. */
  defaultEnabled?: boolean;

  /** Agent-callable tools. Registered through `@gonk/tool-registry-pi` so the
   *  same definitions can be exposed to CLI / MCP via their adapters too. */
  tools?: ToolDefinition[];

  /** Provider-gated capabilities this extension owns, each with a re-runnable
   *  readiness probe. Recorded at registration *independently of whether the
   *  capability's tool passed its `requires()` gate*, so status surfaces
   *  (`harness_status`, `doctor`) can report a gated-off capability and its
   *  fix. See [operational-readiness-design.md](../../../docs/operational-readiness-design.md). */
  readiness?: CapabilityReadiness[];

  /** Single slash command for the domain (per design-principles.md §2). */
  command?: SlashCommandSpec;

  /** Settings catalog. Drives the auto-generated `set` subcommand, the
   *  settings TUI, and (optionally) the resolver pattern. */
  settings?: SettingsSpec;

  /** Preset catalog. Drives the auto-generated `preset` subcommand and the
   *  preset picker. Requires `settings` (the preset is a snapshot of a
   *  subset of settings keys). */
  presets?: PresetsSpec;

  /** Host-event hooks. Keys are event names the host emits (e.g.
   *  `"session_start"`); values are async handlers. Pi runtime wires via
   *  `pi.on(event, handler)`. */
  hooks?: Record<string, HookHandler>;
}

/** Host-event hook handler. Signature is intentionally loose: the host
 *  decides what `event` and `ctx` are. The Pi runtime narrows them. */
export type HookHandler = (event: unknown, ctx: unknown) => void | Promise<void>;

// =============================================================================
// Slash command
// =============================================================================

export interface SlashCommandSpec {
  /** Command name without the leading `/`. */
  name: string;

  /** Description shown in help output. */
  description: string;

  /** User-defined verbs. Framework auto-injects `set`, `instructions`, and
   *  `preset` if the corresponding spec sections are present. Names listed
   *  here override the framework defaults. */
  subcommands?: Record<string, SubcommandSpec>;

  /** What the framework does when invoked with no args. Default: `"tui"`.
   *
   *  String values:
   *    "tui"    — open the settings TUI (requires `spec.settings`); falls back
   *               to `"status"` when the host has no UI
   *    "status" — print a one-line status of all settings (or just the
   *               extension description if no settings)
   *    "help"   — print the subcommand list
   *
   *  Function value: runs as a custom no-args handler. Use this for
   *  extensions whose no-args behavior is genuinely bespoke (entity-list
   *  TUI, status dashboard, etc.). The framework still falls back to
   *  `"status"` when `ctx.hasUI` is false. */
  noArgs?: "tui" | "status" | "help" | NoArgsHandler;
}

/** Custom no-args handler. The framework invokes this for `noArgs: fn`
 *  when the host has UI; it falls back to `"status"` otherwise. */
export type NoArgsHandler = (ctx: SubcommandContext) => Promise<void> | void;

export interface SubcommandSpec {
  /** One-line description. */
  description: string;

  /** Positional argument names, in order. Framework parses `args.positional`
   *  into a same-length array. */
  positional?: PositionalArg[];

  /** Handler invoked after framework parses args. */
  handler: SubcommandHandler;

  /** Optional registration-time predicate. When false, the framework drops
   *  this subcommand from the verb table — the agent and the user never see
   *  it. Use for verbs whose preconditions (provider configured, host has
   *  capability X) can be checked at extension setup() time.
   *
   *  Synchronous: callers that need async info should resolve it before
   *  building the spec, then close over the result. */
  requires?: () => boolean;
}

export interface PositionalArg {
  name: string;
  required?: boolean;
  /** Free-form description for help text. */
  description?: string;
}

/** Framework parses `/X verb foo bar --flag value` into:
 *    { positional: ["foo", "bar"], flags: { flag: "value" }, raw: "foo bar --flag value" }
 *  Subcommand handlers receive this plus a host-supplied context. */
export interface ParsedSubcommandArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
  /** Raw arg string (with subcommand verb already stripped). Useful for
   *  variadic free-text like `/voice instructions <multi-word text>`. */
  raw: string;
}

/** Subcommand handler signature. The `ctx` parameter is host-typed at the
 *  runtime layer (Pi runtime narrows it to ExtensionContext). */
export type SubcommandHandler = (
  args: ParsedSubcommandArgs,
  ctx: SubcommandContext,
) => void | Promise<void>;

/** Minimum context every host runtime provides to a subcommand handler. */
export interface SubcommandContext {
  /** Bound scope store for this invocation. */
  scope: ScopeStore;
  /** Notify the user. Hosts map this to their notification primitive. */
  notify: (message: string, level?: "info" | "error" | "warn") => void;
  /** Whether the host has an interactive UI. Subcommands check this to
   *  decide between TUI prompts and plain notify. */
  hasUI: boolean;
  /** Host-specific extras (the Pi runtime adds `pi`, `ui`, etc.). */
  host?: unknown;
}

// =============================================================================
// Settings
// =============================================================================

export interface SettingsSpec {
  /** Scope key prefix for the auto-generated `set <key> <value>` subcommand.
   *  When the user types `/voice set bind \\`, framework prepends this and
   *  routes to scope key `voice.stt.bind`. */
  scopeKeyPrefix: string;

  /** One or more sections shown as TUI headers. Most extensions have one
   *  section; voice has two (STT, TTS). */
  sections: SettingsSection[];

  /** Default tier the `set` subcommand writes to when none is specified.
   *  Default: `"session"`. */
  defaultSetTier?: ScopeName;
}

export interface SettingsSection {
  /** Section header text. */
  label: string;

  items: SettingsItem[];
}

export interface SettingsItem {
  /** Full scope key. */
  key: string;

  /** Display label. */
  label: string;

  /** Type discriminant — drives both validation and TUI rendering. */
  type: SettingsItemType;

  /** Default value shown in TUI when no scope value is set. */
  default?: unknown;

  /** Optional descriptive help text. */
  description?: string;

  /** Optional indirection: store the value inside a Record keyed by another
   *  setting's resolved value. The canonical example is "TTS voice keyed by
   *  current TTS model" — stored at `voice.tts.voice-by-model[model]`,
   *  not at a single scope key.
   *
   *  When set:
   *    - Read: `scope.get(mapKey)?.[scope.get(sourceKey) ?? defaultSource]`
   *    - Write: merges `{ [sourceValue]: newValue }` into the map
   *    - TUI renders the resolved value with a `[for: <sourceValue>]` hint
   *
   *  Without `keyedBy`, settings live at `key` directly — the simple case. */
  keyedBy?: KeyedByConfig;

  /** For `model` / `provider` / `voice` types — picker domain identifier.
   *  Hosts route this to the appropriate provider/model fetch logic. */
  pickerDomain?: string;
}

/** Indirection config: store value in a per-key map instead of at the bare
 *  `key`. The framework reads/writes through the map so settings authors
 *  declare the pattern rather than hand-rolling Record manipulation. */
export interface KeyedByConfig {
  /** Scope key whose resolved value is the index into the map. May be a
   *  bare scope key (framework reads via `scope.get`) or a function that
   *  derives the index from any number of scope keys. */
  source: string | KeyedBySourceFn;

  /** Scope key that holds the `Record<string, unknown>`. */
  mapKey: string;

  /** Tier the framework writes the updated map back to. Default: same tier
   *  the user is editing under (for TUI) or session (for `set`). */
  writeTier?: ScopeName;
}

export type KeyedBySourceFn = (scope: ScopeStore) => string | undefined;

/** Discriminated union over the supported setting types. Each arm controls
 *  what the TUI renders and what the `set` parser accepts. */
export type SettingsItemType =
  | { kind: "string" }
  | { kind: "number"; min?: number; max?: number }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "text" } // multi-line; opens an editor in TUI hosts
  | { kind: "model" } // host-specific model picker
  | { kind: "provider" } // host-specific provider picker
  | { kind: "voice" } // TTS voice picker (typically combined with keyedBy)
  | { kind: "custom"; pick: CustomPickFn };

/** Custom picker for non-standard setting kinds. Returns the new value or
 *  undefined to cancel. The framework persists the return value via the
 *  normal write path (honoring `keyedBy` if set). */
export type CustomPickFn = (
  ctx: SubcommandContext,
  current: unknown,
  tier: ScopeName,
) => Promise<unknown> | unknown;

// =============================================================================
// Presets
// =============================================================================

export interface PresetsSpec {
  /** Scope key holding `Record<presetName, Record<presetField, unknown>>`. */
  scopeKey: string;

  /** Maps each preset field to a scope key the snapshot reads from and apply
   *  writes to. Example: `{ scopeKey: "voice.tts.model", field: "model" }`
   *  — saves the current model under `preset.model`, restores it back. */
  fields: PresetField[];

  /** Tier the `preset save` subcommand writes the preset list to.
   *  Default: `"global"`. */
  saveTier?: ScopeName;

  /** Tier the `preset apply` subcommand writes individual settings to.
   *  Default: `"session"`. */
  applyTier?: ScopeName;
}

export interface PresetField {
  /** Scope key to snapshot from / apply to. */
  scopeKey: string;
  /** Field name in the preset object. Defaults to last segment of scopeKey. */
  field: string;
}
