// =============================================================================
// Scopes
// =============================================================================

/** Five tiers of configuration / state, listed least → most specific.
 *  Resolution chain walks most→least. */
export type ScopeName =
  /** Harness-wide. Lives at `~/`. */
  | "global"
  /** Tied to the active persona — the directory containing the persona's
   *  definition file (e.g. `~/agents/alice/` if `alice.md` lives in `~/agents/`,
   *  or `.claude/agents/alice/` if it lives there). */
  | "persona"
  /** Project-wide, independent of cwd. Resolved via project root walk. */
  | "project"
  /** Specific filepath / cwd. Lives at `<cwd>/`. */
  | "directory"
  /** A specific session. Pi keeps session-scoped persistence; CLI/MCP
   *  usually keep it ephemeral in-memory. */
  | "session";

/** Most→least specific. Used when a scope arg is omitted. */
export const SCOPE_RESOLUTION_ORDER: readonly ScopeName[] = [
  "session",
  "directory",
  "project",
  "persona",
  "global",
] as const;

// =============================================================================
// Root kinds — well-known directory conventions we know how to talk to
// =============================================================================

/** Canonical kind names for known roots. A root in the wild may be any of:
 *    `agents/`        — open AGENTS.md spec convention
 *    `.agents/`       — dotted variant
 *    `.gonk/`        — our own, only used when the user creates it
 *    `.claude/`       — Claude Code
 *    `.pi/`           — Pi
 *    `.codex/`        — OpenAI Codex CLI
 *    `.gemini/`       — Gemini CLI
 *    `.cursor/`       — Cursor
 *    `.windsurf/`     — Windsurf
 *    `.opencode/`     — opencode
 *    `.aider/`        — aider
 *    `.claude-code/`  — alt naming variant some installs use
 */
export type RootKind = string;

/** Default broad→narrow scan order. Earlier roots are *broader* (open
 *  standards / multi-tool); later roots are *narrower* (single-tool).
 *  Last-found wins, so narrower overrides broader. */
export const DEFAULT_ROOT_ORDER: readonly RootKind[] = [
  "agents",
  ".agents",
  ".pi",
  ".claude",
  ".codex",
  ".gemini",
  ".cursor",
  ".windsurf",
  ".opencode",
  ".aider",
  ".gonk",
] as const;

// =============================================================================
// Documents — top-level markdown files with persona/context content
// =============================================================================

/** Ambient document kinds. Persona-bearing kinds describe *who* this scope is;
 *  context-bearing kinds add instructions to the active persona. */
export type DocumentKind =
  | "PERSONA"
  | "SOUL"
  | "AGENT"
  | "AGENTS"
  | "CLAUDE"
  | "GEMINI"
  | "CURSORRULES";

export type DocumentRole = "persona" | "context";

/** Map from filename → (kind, role). Filename matching is case-sensitive in
 *  practice but we lowercase before lookup for tolerance. */
export const DOCUMENT_FILES: Record<string, { kind: DocumentKind; role: DocumentRole }> = {
  "PERSONA.md": { kind: "PERSONA", role: "persona" },
  "SOUL.md": { kind: "SOUL", role: "persona" },
  "AGENT.md": { kind: "AGENT", role: "persona" },
  "AGENTS.md": { kind: "AGENTS", role: "context" },
  "CLAUDE.md": { kind: "CLAUDE", role: "context" },
  "GEMINI.md": { kind: "GEMINI", role: "context" },
  ".cursorrules": { kind: "CURSORRULES", role: "context" },
};

export interface DocumentEntry {
  kind: DocumentKind;
  role: DocumentRole;
  scope: ScopeName;
  /** Canonical path of the root that holds this doc, if it lives inside a
   *  known root. Undefined when the doc lives at the scope home directly. */
  root?: string;
  /** Canonical path of the document itself. */
  path: string;
  content: string;
}

// =============================================================================
// Blobs
// =============================================================================

export interface BlobHandle {
  scope: ScopeName;
  /** Kind of root that holds the blob. */
  rootKind: RootKind;
  /** Canonical path of the root. */
  root: string;
  /** Logical key. */
  key: string;
  /** Absolute path on disk. */
  path: string;
  mimeType?: string;
  size: number;
}

// =============================================================================
// Root adapters — per-format read/write of K/V + blobs
// =============================================================================

export interface RootAdapter {
  /** What kind of root this adapter handles. */
  readonly kind: RootKind;
  /** Canonical path of the root directory. */
  readonly path: string;

  // ---- Settings (flat dotted keys) -----------------------------------------
  readSetting(key: string): unknown | undefined;
  writeSetting(key: string, value: unknown): void;
  deleteSetting(key: string): void;
  listSettings(prefix: string): string[];

  // ---- Blobs ---------------------------------------------------------------
  readBlob(key: string): Promise<Uint8Array | undefined>;
  writeBlob(key: string, data: Uint8Array, opts?: { mimeType?: string }): Promise<BlobHandle>;
  deleteBlob(key: string): Promise<void>;
  blobHandle(key: string, scope: ScopeName): BlobHandle | undefined;
}

// =============================================================================
// ScopeStore — public API surface every tool sees
// =============================================================================

export interface ResolutionEntry<T = unknown> {
  scope: ScopeName;
  /** Kind of root that produced the value. */
  rootKind?: RootKind;
  /** Canonical root path. */
  root?: string;
  value: T;
}

export interface SetOptions {
  /** Target a specific root by kind (e.g., "claude", "gonk", "agents").
   *  If omitted, the default-write target for the tier is used: the
   *  narrowest existing root, or an error if none exists. */
  kind?: RootKind;
}

export interface ScopeStore {
  /** Read a key. With scope omitted, walks the resolution chain. Within a
   *  tier, walks roots broad→narrow and returns the *last* found (narrower
   *  overrides broader). */
  get<T = unknown>(key: string, scope?: ScopeName): T | undefined;

  /** Set a key. Always specifies a tier; root is chosen by `opts.kind` or
   *  by default-write resolution. */
  set<T = unknown>(key: string, value: T, scope: ScopeName, opts?: SetOptions): void;

  /** Remove a key at a specific tier (and optionally a specific root). */
  delete(key: string, scope: ScopeName, opts?: SetOptions): void;

  /** List all keys with the given prefix, deduped, ordered. */
  list(prefix: string, scope?: ScopeName): string[];

  /** Return every (scope, root, value) tuple where this key is set. */
  resolve<T = unknown>(key: string): ResolutionEntry<T>[];

  blob(key: string, scope?: ScopeName): BlobHandle | undefined;

  putBlob(
    key: string,
    data: Uint8Array,
    scope: ScopeName,
    opts?: SetOptions & { mimeType?: string },
  ): Promise<BlobHandle>;

  deleteBlob(key: string, scope: ScopeName, opts?: SetOptions): Promise<void>;

  readBlob(key: string, scope?: ScopeName): Promise<Uint8Array | undefined>;

  /** Ambient documents discovered at scope homes and within known roots.
   *  With scope omitted, returns all tiers concatenated, ordered most→least
   *  specific. */
  documents(scope?: ScopeName): DocumentEntry[];

  /** Which tiers are reachable (have at least one bound root or scope home). */
  available(): readonly ScopeName[];

  /** Which roots are bound at the given tier. */
  rootsAt(scope: ScopeName): readonly RootBinding[];

  /** The resolved scope-home directory for a tier (the parent that its roots
   *  live under), or undefined if the tier has no home. Unlike `rootsAt`, this
   *  resolves even when no root subdir (`.gonk`/`.agents`/…) has been created in
   *  the home yet. Use it when a consumer needs a writable base dir for a tier:
   *  resolving via the scope's own home keeps that consumer inside the scope it
   *  was handed, instead of falling through to `process.homedir()`. */
  home(scope: ScopeName): string | undefined;
}

export interface RootBinding {
  kind: RootKind;
  path: string;
  adapter: RootAdapter;
}

// =============================================================================
// Environment for resolving tiers and roots
// =============================================================================

export interface ScopeEnvironment {
  /** Current working directory. */
  cwd: string;
  /** The directory that holds the active persona's definition. Set by the
   *  harness after persona resolution. The persona scope tier is bound to
   *  that dir if present. */
  personaHome?: string;
  /** Live resolver for the active persona's home, consulted at tier-resolution
   *  time when `personaHome` is unset. Lets a long-lived consumer (the memory
   *  layers, the knowledge store) bind the persona tier to whoever is active
   *  *now* and rebind on `switch_persona` — instead of freezing one persona at
   *  construction. Returns undefined when no persona is active or its home
   *  can't be resolved (the persona tier then stays unbound). See
   *  `makeResolvePersonaHome` in `@gonk/persona`. */
  resolvePersonaHome?: () => string | undefined;
  /** Active session id. */
  sessionId?: string;
  /** Override of the user's home directory (for tests / containers). */
  homeRoot?: string;
  /** Override of the project root. If unset, walk from `cwd` looking for a
   *  root marker (`.gonk`, `.claude`, `.agents`, `agents`, then `.git`). */
  projectRoot?: string;
  /** Override session-scope home. If unset, sessions live under
   *  `<homeRoot>/.gonk/sessions/<id>/`. */
  sessionHome?: string;
  /** Restrict which root kinds are scanned. If unset, all in DEFAULT_ROOT_ORDER. */
  rootKinds?: readonly RootKind[];
  /** Custom adapter factories — register additional root kinds or override
   *  defaults. Key is the directory name (e.g., "agents", ".claude"); value
   *  builds an adapter for that kind given a directory path. */
  adapterFactories?: Record<string, (path: string) => RootAdapter>;
}
