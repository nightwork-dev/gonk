import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { AuthContext } from "@gonk/auth";
import type { ScopeStore } from "@gonk/scope";
import type { ToolApproval } from "./approval.ts";
import type { ToolAuthorizationResource } from "./security.ts";

// =============================================================================
// Logger / Context
// =============================================================================

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

export interface ToolContext {
  /** Cancellation. Adapters wire this from SIGINT, MCP cancel, Pi interrupt. */
  signal: AbortSignal;

  /** Structured logger. Tools should not write stdout/stderr directly. */
  log: Logger;

  /** Working directory. Defaults to process.cwd(); adapters may override. */
  cwd: string;

  /** Environment variables. Adapters may filter. */
  env: Readonly<Record<string, string | undefined>>;

  /** Cross-tool composition. Goes through the same dispatch path so metrics,
   *  validation, and abort propagation all apply. Cycle detection: throws
   *  ToolError("CYCLE") if `name` is already in callStack. */
  invoke(name: string, input: unknown): AsyncIterable<ToolEvent>;

  /** Names of tools currently on the call stack, root first. */
  readonly callStack: readonly string[];

  /** Five-tier scoped configuration / state (global → persona → project →
   *  directory → session). Adapters wire this from the host environment.
   *  Tools read tier-walk via `ctx.scope.get(key)` or explicit-tier via
   *  `ctx.scope.get(key, "persona")`. Optional because not every adapter
   *  binds it (tests, lightweight CLI use). */
  scope?: ScopeStore;

  /** Bidirectional input stream from the caller. Set by adapters that support
   *  duplex (live audio, interactive sessions). Tools yielding `ToolEvent` can
   *  iterate this concurrently to receive frames from the user.
   *
   *  Non-duplex adapters leave this undefined. Tools declaring
   *  `capabilities.duplex` should fail fast if undefined.
   *
   *  Cross-tool `ctx.invoke()` does NOT forward the parent's input by default —
   *  child tools start with `input: undefined`. The parent must explicitly mux
   *  into a child stream if it wants to forward. */
  input?: AsyncIterable<InputChunk>;

  /** Optional progress channel. Adapters that have a streaming UI (Pi's
   *  tool-execute `onUpdate`, MCP `notifications/progress`) wire this so
   *  handlers can emit milestone updates mid-await without restructuring as
   *  an async generator.
   *
   *  Tools using this MUST tolerate undefined (CLI adapters, MCP without
   *  progress support, test harnesses). Drop the call if absent.
   *
   *  Forwarded through `ctx.invoke()` like every other field. */
  notify?(event: ToolEvent): void;

  /** Opaque host-specific context. Adapters that have a per-call host context
   *  (Pi's tool-execute callback, MCP request extras, etc.) attach it here so
   *  tools that need host-specific surfaces can downcast.
   *
   *  Tools using this MUST be tolerant of undefined — adapters that cannot
   *  provide a host context (CLI, MCP-without-extras) leave it unset. The
   *  shape is adapter-specific; tools depending on it are by definition
   *  host-coupled and should document which adapter populates them.
   *
   *  Forwarded through `ctx.invoke()` like every other field. */
  host?: unknown;

  /** Transport-authenticated principal plus the host/Gonk authorization policy.
   *  Canonical registry dispatch rechecks this context for root and composed
   *  invocations. Raw credentials never belong here. */
  auth?: AuthContext;
}

// =============================================================================
// Duplex / Input
// =============================================================================

export type InputChunk =
  | InputAudioChunk
  | InputTextChunk
  | InputControlChunk
  | InputRawChunk;

export interface InputAudioChunk {
  type: "audio";
  /** Raw PCM samples. Adapters MUST document encoding; default int16 little-endian. */
  pcm: Uint8Array;
  sampleRate: number;
  channels: number;
  /** Monotonic millis since session start, when known. */
  timestampMs?: number;
}

export interface InputTextChunk {
  type: "text";
  text: string;
  /** True if this is a partial / interim token, false for finalized. */
  partial?: boolean;
}

export interface InputControlChunk {
  type: "control";
  op: DuplexControl;
  /** Optional payload for ops that carry one (e.g. interrupt-with-replacement). */
  payload?: unknown;
}

export type DuplexControl =
  /** User started speaking; tool may want to fade output. */
  | "barge-in"
  /** Hard stop the current model output. */
  | "interrupt"
  /** User finished their turn explicitly. */
  | "end-turn"
  /** Pause input/output without ending session. */
  | "pause"
  /** Resume from pause. */
  | "resume";

export interface InputRawChunk {
  type: "raw";
  data: unknown;
}

// =============================================================================
// Display blocks (rich content)
// =============================================================================

export type DisplayBlock =
  | { type: "text"; text: string }
  | { type: "markdown"; markdown: string }
  | { type: "code"; language: string; code: string; caption?: string }
  | { type: "json"; value: unknown; caption?: string }
  | { type: "image"; mimeType: string; data: string /* base64 */; alt?: string }
  | { type: "link"; url: string; title?: string };

/** Adapters render what they can; richer types degrade gracefully:
 *    CLI — text/markdown/code/json/link printed; image dropped with placeholder.
 *    MCP — text/markdown -> text; image -> native MCP image content; code/json
 *          -> fenced markdown text.
 *    Pi  — markdown rendered; code highlighted; image shown if terminal supports it.
 *  Plain string is sugar for [{ type: "text", text }]. */
export type Display = string | DisplayBlock[];

// =============================================================================
// Events / Results
// =============================================================================

export type ToolEvent<T = unknown> =
  | {
      type: "log";
      level: "debug" | "info" | "warn" | "error";
      message: string;
      meta?: unknown;
    }
  | { type: "progress"; percent?: number; message?: string }
  | { type: "data"; chunk: unknown }
  | { type: "result"; data: T; display?: Display }
  | { type: "error"; code: string; message: string; details?: unknown };

export interface ToolResult<T = unknown> {
  data: T;
  /** Falls back to JSON.stringify(data) when omitted. */
  display?: Display;
}

export type ToolHandlerReturn<T> =
  | Promise<ToolResult<T>>
  | AsyncIterable<ToolEvent<T>>;

export type ToolHandler<I, O> = (
  input: I,
  ctx: ToolContext
) => ToolHandlerReturn<O>;

// =============================================================================
// Visibility
// =============================================================================

/** Visibility on prompt-budgeted surfaces (MCP, Pi). CLI ignores it. */
export type ToolVisibility =
  /** In the model's tool list every turn. Use sparingly. */
  | "always"
  /** Registered + indexed for search; surfaced via meta-tools (find_tools/load_tool)
   *  or orchestrator pin. */
  | "on-demand";

// =============================================================================
// Tool definition
// =============================================================================

/** Self-declared authorization metadata — *who* may invoke this tool. The
 *  registry includes it in the canonical tool authorization resource; the
 *  injected `AuthContext` policy interprets the host-defined vocabulary.
 *  All fields remain optional and free-form so Gonk does not bake in a role
 *  hierarchy. A trusted invocation with no `ctx.auth` remains backward
 *  compatible and does not claim to be authenticated. */
export interface ToolAuthorization {
  /** Minimum authorization level required to invoke (host-defined vocabulary). */
  authLevel?: string;
  /** Role a caller must hold to invoke (host-defined vocabulary). */
  requiredRole?: string;
  /** Explicit allow-list of caller identities permitted to invoke. */
  allowedCallers?: string[];
}

export interface ToolDefinition<I = unknown, O = unknown> {
  /** Stable id. CLI subcommand, MCP tool name, Pi tool name. kebab-case, verb-noun. */
  name: string;
  description: string;

  /** Display grouping for human-facing listings (list_tools output, CLI --help).
   *  Not used for search — that's what `tags` is for. */
  category?: string;

  /** Default visibility. Per-adapter override via hints.{mcp,pi}.visibility.
   *  Default: "on-demand". */
  visibility?: ToolVisibility;

  input: StandardSchemaV1<unknown, I>;
  output?: StandardSchemaV1<unknown, O>;

  /** Optional raw JSON Schema override for the input. Used by adapters that
   *  advertise tool schemas to the model (MCP) or generate help (CLI). Prefer
   *  attaching JSON Schema to the Standard Schema input with
   *  `withJsonSchema()` or `shape(..., jsonSchema)` so runtime validation and
   *  advertised schema share one source. */
  inputJsonSchema?: Record<string, unknown>;

  /** Output validation policy. Applied only to `result` events / promise returns;
   *  intermediate `data` chunks are not validated.
   *    - "off"    (default): handler return is trusted.
   *    - "lax":   validate; failures emit ctx.log.warn but don't fail.
   *    - "strict": validate; failures convert to ToolError("OUTPUT_INVALID"). */
  validateOutput?: "off" | "lax" | "strict";

  handler: ToolHandler<I, O>;

  capabilities?: ToolCapabilities;

  /** Discovery metadata for the orchestrator's search. */
  tags?: string[];
  keywords?: string[];
  relatedTo?: string[];

  /** Coarse cost class so the LLM can make budget-aware decisions without
   *  needing the operator to plumb usage data through. The agent surface
   *  (`@gonk/tool-registry-pi`'s `toAgentTool`) appends a "Cost: <class>"
   *  sentence to the description visible to the model.
   *
   *    - "low":     cheap; safe to use freely (e.g. local sqlite ops).
   *    - "moderate": one provider call with normal token budget.
   *    - "high":    multiple provider calls, large token spend, or paid I/O. */
  cost?: ToolCostClass;

  /** Coarse latency class. Same downstream wiring as `cost`.
   *
   *    - "instant": <100ms typical; in-memory or local sqlite.
   *    - "seconds": single network round-trip or sub-second LLM call.
   *    - "minutes": long-running (RLM, multi-step pipelines, batch jobs). */
  latency?: ToolLatencyClass;

  hints?: ToolHints;

  /** Self-declared approval tier — how dangerous this tool is, independent of
   *  any host pattern policy. Accepts a bare tier (`"read"|"write"|"exec"`),
   *  an object (`{ tier, override?, reason? }`), or a function evaluated per
   *  call with the tool's input (so a tool can pick a tier from its args, or
   *  escalate a specific arg pattern — e.g. bash forcing `rm -rf /` to exec
   *  with `override: true`).
   *
   *  Authenticated registry dispatch and approval gates such as
   *  `@gonk/pi-guard` treat NO or malformed declaration as the most-restrictive
   *  tier (`exec`) so unknown / MCP / custom tools fail safe. Trusted internal
   *  dispatch without `ctx.auth` remains ungated. */
  approval?: ToolApproval;

  /** Self-declared authorization — *who* may invoke this tool. Registry
   *  discovery and invocation policies receive this metadata through the
   *  canonical tool resource. Optional, free-form, and backward-compatible. */
  authorization?: ToolAuthorization;

  /** Declares that authenticated invocation requires an authoritative
   *  application resource projection after input validation. */
  authorizationResource?: ToolAuthorizationResource;

  /** Registration-time predicate. When false, `ToolRegistry.register()`
   *  skips the tool — it's not stored, not advertised in `list_tools` /
   *  `find_tools`, not invokable. Use for tools whose preconditions
   *  (provider configured, API key present, host has capability) can be
   *  checked at extension setup() time.
   *
   *  Synchronous: callers that need async info should resolve it before
   *  building the tool, then close over the result. */
  requires?: () => boolean;

  /** Optional capability-state predicate. Called at registration time
   *  (by the host adapter, NOT the registry itself) to pick which
   *  description to advertise. Return "full" when all preconditions for
   *  the tool's headline capability are met; "degraded" when the tool
   *  will still operate but with reduced functionality (e.g. semantic
   *  search falling back to keyword-only, semantic recall unavailable).
   *
   *  When this returns "degraded" AND `degradedDescription` is set, the
   *  adapter uses `degradedDescription` in place of `description` for the
   *  LLM-visible tool surface. The handler itself is unchanged — the
   *  tool implementation already handles the degraded path.
   *
   *  Independent of `requires`: a tool that wants the three-state
   *  surface uses both. `requires` returning false drops the tool
   *  entirely; otherwise `capabilityFor` picks between full and
   *  degraded descriptions. */
  capabilityFor?(): "full" | "degraded";

  /** Alternate description used when `capabilityFor()` returns
   *  "degraded". Should explicitly mention what's missing so the LLM
   *  budgets accordingly. Ignored unless `capabilityFor` is set and
   *  returns "degraded" at registration time. */
  degradedDescription?: string;
}

/** Coarse cost class advertised to the model. See `ToolDefinition.cost`. */
export type ToolCostClass = "low" | "moderate" | "high";

/** Coarse latency class advertised to the model. See `ToolDefinition.latency`. */
export type ToolLatencyClass = "instant" | "seconds" | "minutes";

// =============================================================================
// Capability readiness
// =============================================================================

/** Runtime readiness of a provider-gated capability (voice, image, browser,
 *  embedding). Declared on an extension spec (`@gonk/extension-spec`'s
 *  `ExtensionSpec.readiness`) so a host can report a capability's health even
 *  when its tool was dropped by a false `requires()` — the spec is recorded at
 *  setup regardless of whether any individual tool registered.
 *
 *    - "ready":       configured and usable. `detail` optionally names the
 *                     resolved endpoint/provider.
 *    - "degraded":    operates with reduced functionality (e.g. semantic
 *                     recall falling back to keyword-only). `fix` says how to
 *                     restore full function.
 *    - "needs-setup": not usable until configured. `fix` is the concrete step;
 *                     `settingsKeys` names the scope keys to set. */
export type CapabilityState =
  | { status: "ready"; detail?: string }
  | { status: "degraded"; detail: string; fix: string }
  | {
      status: "needs-setup";
      detail: string;
      fix: string;
      settingsKeys?: string[];
    };

/** A capability's self-report. `probe` is a no-arg closure over the bound
 *  scope (matching `ToolDefinition.requires` / `capabilityFor`), re-evaluated
 *  each time a status surface (`harness_status`, `doctor`) runs — so it
 *  reflects live scope config, not setup-time state. The same `probe` is the
 *  single source of truth a tool's `requires` re-expresses against
 *  (`requires: () => probe().status === "ready"`), so gating and health can't
 *  drift. */
export interface CapabilityReadiness {
  /** Stable id, dotted to group sub-capabilities (e.g. "voice.stt"). */
  id: string;
  /** Human label for status output (e.g. "Speech-to-text"). */
  label: string;
  /** Re-runnable readiness check. Closes over scope; reads live values. */
  probe: () => CapabilityState;
}

export interface ToolCapabilities {
  readsFs?: boolean;
  writesFs?: boolean;
  network?: boolean;
  longRunning?: boolean;
  idempotent?: boolean;
  /** Tool requires a bidirectional input stream (ctx.input). Adapters that
   *  cannot provide one should refuse to advertise the tool. */
  duplex?: boolean;
}

export interface ToolHints {
  cli?: CliHints;
  mcp?: McpHints;
  pi?: PiHints;
}

export interface CliHints {
  command?: string;
  positional?: string[];
  aliases?: string[];
  examples?: string[];
}

export interface McpHints {
  mcpName?: string;
  visibility?: ToolVisibility;
  annotations?: {
    readOnly?: boolean;
    destructive?: boolean;
    idempotent?: boolean;
    openWorld?: boolean;
  };
}

export interface PiHints {
  piName?: string;
  visibility?: ToolVisibility;
  requiresApproval?: boolean;
  statusGlyph?: string;
}
