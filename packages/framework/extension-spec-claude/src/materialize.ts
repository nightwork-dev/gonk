import { mkdirSync, readdirSync, readFileSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

import { safeJoin } from "@gonk/utils/path";

import { defaultCommandPlacement, defaultHookPlacement } from "./placement.ts";
import type {
  ClaudeHooksFile,
  ClaudeHookMatcher,
  ClaudePluginManifest,
  CommandFrontmatter,
  MaterializationManifest,
  MaterializeClaudeOptions,
} from "./types.ts";

// =============================================================================
// Constants
// =============================================================================

const MANIFEST_DIR = ".claude-plugin";
const MANIFEST_FILE = "plugin.json";
const COMMANDS_DIR = "commands";
const HOOKS_DIR = "hooks";
const HOOKS_FILE = "hooks.json";
const MCP_FILE = ".mcp.json";
const MATERIALIZE_MANIFEST_FILE = ".gonk-materialize.json";
const DEFAULT_DISPATCH_BINARY = "gonk-claude-hook";

// =============================================================================
// Entry point
// =============================================================================

/** Materialize an `ExtensionSpec` into a Claude Code plugin tree.
 *
 *  Idempotent: re-running with the same spec produces the same files. Any
 *  files previously written by gonk that the new spec no longer needs are
 *  removed (tracked via the `.gonk-materialize.json` sidecar).
 *
 *  PR 1 scope: writes `plugin.json`, `commands/*.md`, `hooks/hooks.json`.
 *  Future PRs will add `agents/`, `skills/`, `.mcp.json`. */
export function materializeClaudePlugin(opts: MaterializeClaudeOptions): MaterializationManifest {
  const pluginRoot = resolve(opts.outDir);
  const packageName = opts.packageName ?? opts.spec.id;
  const version = opts.version ?? "0.0.0";
  const dispatchBinary = opts.hookDispatchBinary ?? DEFAULT_DISPATCH_BINARY;
  const commandPlacement = opts.commandPlacement ?? defaultCommandPlacement;
  const hookPlacement = opts.hookPlacement ?? defaultHookPlacement;

  mkdirSync(pluginRoot, { recursive: true });

  // Sweep previously-written files so the on-disk tree matches the new
  // materialization. Anything outside the prior write set we leave alone —
  // Claude may store cache, an operator may have edited a hand-rolled file
  // we don't own.
  const previous = readPreviousManifest(pluginRoot);
  const targets = new WriteBuffer(pluginRoot);

  // 1. plugin.json
  const manifest = buildPluginManifest({
    spec: opts.spec,
    packageName,
    version,
    hasCommands: Boolean(opts.spec.command),
    hasMcp: Boolean(opts.mcpServerEntry),
  });
  targets.write(join(MANIFEST_DIR, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");

  // 1b. .mcp.json (per-plugin stdio MCP server, keyed by spec.id)
  if (opts.mcpServerEntry) {
    const payload = { mcpServers: { [opts.spec.id]: opts.mcpServerEntry } };
    targets.write(MCP_FILE, JSON.stringify(payload, null, 2) + "\n");
  }

  // 2. commands/*.md
  if (opts.spec.command) {
    const cmd = opts.spec.command;
    // Bare command (always emit — it's the user's entry point).
    const bare = commandPlacement({ command: cmd, verb: null, subcommand: null });
    if (bare !== "drop") {
      targets.write(join(COMMANDS_DIR, bare.filename), renderMarkdown(bare.frontmatter, bare.body));
    }
    // Per-verb commands. Sort by verb for deterministic output (prompt-cache
    // discipline; design-principles §8). Capability-gated verbs
    // (`requires()===false`) are dropped before consulting the placement
    // policy so policy authors don't have to re-implement the gate.
    const subs = Object.entries(cmd.subcommands ?? {})
      .filter(([, sub]) => sub.requires?.() !== false)
      .sort(([a], [b]) => a.localeCompare(b));
    for (const [verb, subcommand] of subs) {
      const result = commandPlacement({ command: cmd, verb, subcommand });
      if (result === "drop") continue;
      targets.write(join(COMMANDS_DIR, result.filename), renderMarkdown(result.frontmatter, result.body));
    }
  }

  // 3. hooks/hooks.json — collect, sort, render
  const hooksFile = buildHooksFile(opts.spec, hookPlacement, opts.spec.id, dispatchBinary);
  if (hasAnyHook(hooksFile)) {
    targets.write(join(HOOKS_DIR, HOOKS_FILE), JSON.stringify(hooksFile, null, 2) + "\n");
  }

  // 4. Self-describing manifest sidecar (consumed by `gonk doctor` and the
  //    next materialize run for sweep).
  const written = targets.relativePaths();
  const materializeManifest: MaterializationManifest = {
    pluginRoot,
    specId: opts.spec.id,
    packageName,
    written: [...written, MATERIALIZE_MANIFEST_FILE].sort(),
    manifestPath: MATERIALIZE_MANIFEST_FILE,
  };
  targets.write(MATERIALIZE_MANIFEST_FILE, JSON.stringify(materializeManifest, null, 2) + "\n");

  // 5. Sweep — delete files written by a prior run that this run didn't
  //    rewrite. Only delete inside directories we own.
  sweepObsolete({
    pluginRoot,
    previous,
    current: new Set(targets.relativePaths()),
  });

  return materializeManifest;
}

/** Inverse: remove every file the manifest claims gonk wrote. Leaves the
 *  directory itself in place when other files are present. */
export function unmaterializeClaudePlugin(opts: { outDir: string }): { removed: string[] } {
  const pluginRoot = resolve(opts.outDir);
  const previous = readPreviousManifest(pluginRoot);
  const removed: string[] = [];
  // Sort so the manifest itself comes last; that keeps recovery semantics
  // intuitive if rmSync throws mid-loop.
  const ordered = [...previous].sort();
  for (const rel of ordered) {
    if (rel === MATERIALIZE_MANIFEST_FILE) continue;
    // Same containment guard as the sweep: a manifest path that resolves
    // outside the plugin root is skipped, never deleted.
    let abs: string;
    try {
      abs = safeJoin(pluginRoot, rel);
    } catch {
      continue;
    }
    try {
      rmSync(abs);
      removed.push(rel);
    } catch {
      // Already gone — fine.
    }
  }
  // Clean up the materialize sidecar itself.
  try {
    rmSync(join(pluginRoot, MATERIALIZE_MANIFEST_FILE));
  } catch {
    // Best-effort.
  }
  // Prune any owned directories that are now empty (commands/, hooks/,
  // .claude-plugin/). Leaves non-owned directories alone.
  for (const dir of OWNED_DIRS) {
    pruneIfEmpty(join(pluginRoot, dir));
  }
  return { removed };
}

// =============================================================================
// Pieces
// =============================================================================

function buildPluginManifest(args: {
  spec: MaterializeClaudeOptions["spec"];
  packageName: string;
  version: string;
  hasCommands: boolean;
  hasMcp: boolean;
}): ClaudePluginManifest {
  const manifest: ClaudePluginManifest = {
    name: args.packageName,
    version: args.version,
    description: args.spec.description,
  };
  if (args.hasCommands) manifest.commands = `./${COMMANDS_DIR}/`;
  // NB: do NOT set manifest.hooks for the standard hooks/hooks.json — Claude Code
  // auto-loads that file, so referencing it here is a DUPLICATE and makes the
  // whole hook load FAIL (the entire SessionStart hook silently stops firing).
  // manifest.hooks is only for ADDITIONAL, non-standard hook files, which the
  // materializer never writes. The file is still emitted below and auto-loaded.
  if (args.hasMcp) manifest.mcpServers = `./${MCP_FILE}`;
  return manifest;
}

function buildHooksFile(
  spec: MaterializeClaudeOptions["spec"],
  policy: NonNullable<MaterializeClaudeOptions["hookPlacement"]>,
  specId: string,
  dispatchBinary: string,
): ClaudeHooksFile {
  const grouped: Partial<Record<string, ClaudeHookMatcher[]>> = {};
  const specEvents = Object.keys(spec.hooks ?? {}).sort();
  for (const specEvent of specEvents) {
    const placements = policy({ specEvent, specId, dispatchBinary });
    for (const { event, command } of placements) {
      const list = (grouped[event] ??= []);
      // One matcher per spec event so hooks/hooks.json reads cleanly.
      list.push({ matcher: "*", hooks: [command] });
    }
  }
  const hooks: ClaudeHooksFile["hooks"] = {};
  // Deterministic event ordering.
  for (const key of Object.keys(grouped).sort()) {
    hooks[key as keyof ClaudeHooksFile["hooks"]] = grouped[key]!;
  }
  return { description: `gonk-materialized hooks for ${spec.id}`, hooks };
}

function hasAnyHook(file: ClaudeHooksFile): boolean {
  return Object.keys(file.hooks).length > 0;
}

function renderMarkdown(frontmatter: CommandFrontmatter | undefined, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) return body.endsWith("\n") ? body : `${body}\n`;
  const lines: string[] = ["---"];
  // Sorted keys for stable output.
  for (const key of Object.keys(frontmatter).sort()) {
    const value = (frontmatter as Record<string, unknown>)[key];
    if (value === undefined) continue;
    lines.push(`${key}: ${serializeFrontmatterValue(value)}`);
  }
  lines.push("---", "", body.replace(/\n+$/, ""), "");
  return lines.join("\n");
}

function serializeFrontmatterValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  // String: quote if it contains characters that confuse YAML's bare scalar
  // parser (colons, leading/trailing whitespace, etc.). Bias toward
  // double-quoting; the cost is one extra character and the win is
  // round-trippable output.
  const str = String(value);
  return needsQuoting(str) ? JSON.stringify(str) : str;
}

function needsQuoting(s: string): boolean {
  if (s.length === 0) return true;
  if (/^[\s'"`]/.test(s) || /[\s]$/.test(s)) return true;
  // Restrict the danger set to characters that genuinely confuse YAML's
  // bare-scalar parser at the start of a value. `<`, `>`, `[`, `]` etc.
  // are valid in bare scalars (Claude's argument-hint commonly uses
  // `<query>` style). Quote only when the first char is a flow/structural
  // indicator or when the value contains a colon-space sequence.
  if (/^[!&*|>%@`#?]/.test(s)) return true;
  if (/:\s/.test(s)) return true;
  return false;
}

// =============================================================================
// Previous-manifest tracking and sweep
// =============================================================================

function readPreviousManifest(pluginRoot: string): Set<string> {
  try {
    const sidecarPath = join(pluginRoot, MATERIALIZE_MANIFEST_FILE);
    const stat = statSync(sidecarPath);
    if (!stat.isFile()) return new Set();
    const raw = readFileSync(sidecarPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MaterializationManifest>;
    if (!parsed.written || !Array.isArray(parsed.written)) return new Set();
    return new Set(parsed.written.filter((p) => typeof p === "string"));
  } catch {
    return new Set();
  }
}

function sweepObsolete(args: {
  pluginRoot: string;
  previous: Set<string>;
  current: Set<string>;
}): void {
  for (const rel of args.previous) {
    if (args.current.has(rel)) continue;
    if (rel === MATERIALIZE_MANIFEST_FILE) continue;
    if (!isInsideOwnedDir(rel)) continue;
    // Never delete outside the plugin root. A manifest carrying a traversing
    // path (`commands/../../x` passes isInsideOwnedDir on its first segment but
    // resolves outside) is skipped rather than honored.
    let abs: string;
    try {
      abs = safeJoin(args.pluginRoot, rel);
    } catch {
      continue;
    }
    try {
      rmSync(abs);
    } catch {
      // Already gone — fine.
    }
    pruneEmptyParents(args.pluginRoot, dirname(abs));
  }
}

const OWNED_DIRS = new Set([MANIFEST_DIR, COMMANDS_DIR, HOOKS_DIR]);
const OWNED_ROOT_FILES = new Set([MCP_FILE]);

function isInsideOwnedDir(rel: string): boolean {
  const top = rel.split(sep)[0] ?? rel.split("/")[0] ?? "";
  if (OWNED_DIRS.has(top)) return true;
  // Allow sweeping a root-level owned file (e.g. .mcp.json) when the new
  // materialization no longer needs it.
  return OWNED_ROOT_FILES.has(rel);
}

function pruneIfEmpty(dir: string): void {
  try {
    const entries = readdirSync(dir);
    if (entries.length === 0) rmdirSync(dir);
  } catch {
    // Best-effort.
  }
}

function pruneEmptyParents(pluginRoot: string, dir: string): void {
  if (!dir.startsWith(pluginRoot) || dir === pluginRoot) return;
  try {
    const entries = readdirSync(dir);
    if (entries.length === 0) {
      rmdirSync(dir);
      pruneEmptyParents(pluginRoot, dirname(dir));
    }
  } catch {
    // Best-effort.
  }
}

// =============================================================================
// WriteBuffer — batched, deterministic
// =============================================================================

class WriteBuffer {
  private readonly entries = new Map<string, string>();
  constructor(private readonly pluginRoot: string) {}

  write(relPath: string, content: string): void {
    // Confine the write to the plugin root. relPath is derived from spec data
    // (command names, verb keys) that is only kebab-case "by convention" and
    // never validated — a name like `../../etc/x` would otherwise escape the
    // tree. safeJoin throws on escape rather than writing outside.
    const abs = safeJoin(this.pluginRoot, relPath);
    const normalized = relPath.split(sep).join("/");
    this.entries.set(normalized, content);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  relativePaths(): string[] {
    return [...this.entries.keys()].sort();
  }
}

// =============================================================================
// Helper for tests + future gonk-doctor consumers
// =============================================================================

/** Read the manifest sidecar without re-materializing. Returns `null` if no
 *  prior manifest exists in `pluginRoot`. */
export function readMaterializationManifest(pluginRoot: string): MaterializationManifest | null {
  const sidecar = join(pluginRoot, MATERIALIZE_MANIFEST_FILE);
  try {
    const raw = readFileSync(sidecar, "utf8");
    return JSON.parse(raw) as MaterializationManifest;
  } catch {
    return null;
  }
}

/** Resolve a path inside the plugin root, useful for tests that want to
 *  read materialized output back. */
export function pluginPath(pluginRoot: string, ...parts: string[]): string {
  const target = resolve(pluginRoot, ...parts);
  // Sanity: ensure we stay inside the plugin root.
  if (!relative(pluginRoot, target).startsWith("..")) return target;
  throw new Error(`pluginPath escaped pluginRoot: ${target}`);
}
