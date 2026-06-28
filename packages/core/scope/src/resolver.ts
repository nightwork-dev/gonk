import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  DEFAULT_ROOT_ORDER,
  DOCUMENT_FILES,
  type DocumentEntry,
  type RootBinding,
  type RootKind,
  type ScopeEnvironment,
  type ScopeName,
  type ScopeStore,
} from "./types.ts";
import { StandardRootAdapter } from "./standard-adapter.ts";
import { canonicalPath } from "./canonical-path.ts";
import { resolveStableSessionId } from "./session-id.ts";
import { SUBSTRATE_KINDS, substrateDir } from "./substrate.ts";

// =============================================================================
// Tier home discovery
// =============================================================================

/** Map each tier to its "scope home" directory. The scope home is where
 *  ambient docs are scanned and where known roots are looked for as
 *  subdirectories. */
export function resolveTierHomes(env: ScopeEnvironment): Map<ScopeName, string> {
  const out = new Map<ScopeName, string>();

  // Global → user's home (or override)
  const home = env.homeRoot ?? homedir();
  out.set("global", canonical(home));

  // Persona → directory containing the persona definition. Prefer an explicit
  // personaHome; else resolve the *active* persona live via the optional thunk
  // so the persona tier binds to whoever is active now and rebinds on switch.
  const personaHome = env.personaHome ?? env.resolvePersonaHome?.();
  if (personaHome) {
    out.set("persona", canonical(personaHome));
  }

  // Project → walk for marker
  const projectRoot = env.projectRoot ?? findProjectRoot(env.cwd);
  if (projectRoot) out.set("project", canonical(projectRoot));

  // Directory → cwd
  out.set("directory", canonical(resolve(env.cwd)));

  // Session → explicit override; else `<home>/.agents/sessions/<id>` via the
  // common substrate policy (which falls back to a legacy `.gonk/sessions` base
  // until migrated). The sessions container is resolved at the user home, so it
  // resolves as a non-session kind.
  if (env.sessionId) {
    const sessionHome =
      env.sessionHome ?? join(substrateDir("global", home, "sessions"), env.sessionId);
    out.set("session", canonical(sessionHome));
  }

  return out;
}

/** Resolve the session-tier scope home for a cwd, minting the stable per-cwd
 *  session id on the way. This is the directory under which per-session
 *  substrates (memory sqlite, the supervised-compose run registry, the
 *  background-job store) all live, so cross-process readers and writers that
 *  share a cwd agree on one root across `pi --print` invocations.
 *
 *  Single helper so consumers that previously open-coded
 *  `resolveStableSessionId` + `resolveTierHomes` + `homes.get("session")`
 *  share one implementation. */
export function resolveSessionHome(cwd: string): string {
  const sessionId = resolveStableSessionId({ cwd });
  const homes = resolveTierHomes({ cwd, sessionId });
  const sessionHome = homes.get("session");
  if (!sessionHome) {
    // resolveTierHomes always sets "session" when sessionId is present, which
    // it always is here. Defensive only.
    throw new Error("resolveSessionHome: no session-tier home resolved");
  }
  return sessionHome;
}

// Plain markers: their mere presence denotes a project root.
const PLAIN_PROJECT_MARKERS = [".claude", ".pi", "agents", ".git"];
// gonk-managed namespaces. These may hold ONLY auto-spawned substrate
// (memory/knowledge/sessions), which must NOT promote a dir to a project root.
const NAMESPACE_PROJECT_MARKERS = [".agents", ".gonk"];
const SUBSTRATE_KIND_SET = new Set<string>(SUBSTRATE_KINDS);

/** A gonk namespace dir (`.agents`/`.gonk`) marks a project only when it holds
 *  user-bound content — a bound root (agents/settings/skills/blobs) or a doc —
 *  not when it holds ONLY auto-spawned substrate. Without this, writing a cache
 *  into a cwd (`<cwd>/.agents/memory`) would falsely promote it to a project
 *  root and hijack project-tier resolution (e.g. a monorepo subpackage
 *  shadowing the repo-root project). Dotfiles (`.DS_Store`, lock files) are
 *  ignored so they never count as bound content. */
function namespaceMarksProject(nsDir: string): boolean {
  let entries: string[];
  try {
    entries = readdirSync(nsDir);
  } catch {
    return false;
  }
  // Ignore dotfiles (lock files, .DS_Store) when judging contents.
  const meaningful = entries.filter((e) => !e.startsWith("."));
  // An empty (or dotfile-only) namespace stays a marker — a user who created
  // a bare `.gonk`/`.agents` to mark a project still gets one. The exclusion is
  // narrow: a namespace that holds ONLY auto-spawned substrate is NOT a project.
  if (meaningful.length === 0) return true;
  return meaningful.some((e) => !SUBSTRATE_KIND_SET.has(e));
}

/** Walk up from `start` looking for a recognized project root marker. */
export function findProjectRoot(start: string): string | undefined {
  let current = resolve(start);
  while (true) {
    for (const m of PLAIN_PROJECT_MARKERS) {
      if (isDir(join(current, m))) return current;
    }
    for (const m of NAMESPACE_PROJECT_MARKERS) {
      const nsDir = join(current, m);
      if (isDir(nsDir) && namespaceMarksProject(nsDir)) return current;
    }
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

// =============================================================================
// Root binding — for a tier home, find all known roots inside it
// =============================================================================

/** For each tier home, scan its known root subdirectories, realpath them,
 *  dedupe by canonical path, and bind adapters. Returns broad→narrow per
 *  the requested order. Symlinks are followed; cycles are ignored via
 *  realpath. */
export function bindRoots(
  tierHome: string,
  env: ScopeEnvironment,
): RootBinding[] {
  const order = env.rootKinds ?? DEFAULT_ROOT_ORDER;
  const factories = env.adapterFactories ?? {};
  const seen = new Set<string>();
  const bindings: RootBinding[] = [];

  for (const kind of order) {
    const candidate = join(tierHome, kind);
    if (!isDir(candidate)) continue;
    const real = canonical(candidate);
    if (seen.has(real)) continue;
    seen.add(real);

    const factory = factories[kind] ?? ((p: string) => new StandardRootAdapter(kind, p));
    bindings.push({ kind, path: real, adapter: factory(real) });
  }

  return bindings;
}

// =============================================================================
// Ambient document scanning
// =============================================================================

/** Scan a directory for ambient docs (AGENTS.md, CLAUDE.md, SOUL.md, etc.).
 *  Returns entries with role + kind. The directory itself is the scope home,
 *  not a known root. */
export function scanDocuments(
  dir: string,
  scope: ScopeName,
  rootPath?: string,
): DocumentEntry[] {
  if (!isDir(dir)) return [];
  const out: DocumentEntry[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const seen = new Set<string>();
  // Build a case-insensitive lookup so AGENTS.MD / agents.md / AGENTS.Md
  // all match — aligns with Pi's #3949 fix and tolerates Windows casings.
  const ciFileLookup = new Map<string, (typeof DOCUMENT_FILES)[string]>();
  for (const [k, v] of Object.entries(DOCUMENT_FILES)) ciFileLookup.set(k.toLowerCase(), v);

  for (const name of entries) {
    const meta = DOCUMENT_FILES[name] ?? ciFileLookup.get(name.toLowerCase());
    if (!meta) continue;
    const path = join(dir, name);
    if (!isFile(path)) continue;
    const real = canonical(path);
    if (seen.has(real)) continue;
    seen.add(real);
    let content: string;
    try {
      content = readFileSafe(real);
    } catch {
      continue;
    }
    out.push({
      kind: meta.kind,
      role: meta.role,
      scope,
      ...(rootPath !== undefined ? { root: rootPath } : {}),
      path: real,
      content,
    });
  }
  return out;
}

// =============================================================================
// Helpers
// =============================================================================

export function canonical(path: string): string {
  return canonicalPath(path);
}

/** Where a capability should write its operational state for a tier.
 *
 *  Resolves the scope's OWN home for the tier so a consumer always writes inside
 *  the scope it was handed — a scope bound to a temp/sandbox home (tests) writes
 *  there, never the real user home. The `homedir()` fallback fires only for a
 *  scope with no home for that tier (e.g. an in-memory store) — lightweight CLI
 *  behavior. Centralizes the policy so consumers (curator, reflector, …) never
 *  reach for `process.homedir()` directly, which once aliased test state onto the
 *  production state path. Default tier is `global` (the usual home for
 *  cross-session operational artifacts like scheduler state).
 *
 *  Note: `FsScopeStore.home("global")` returns undefined in the one case where a
 *  narrower tier already claimed the same canonical dir (e.g. cwd IS the user's
 *  home, so `directory` dedupes `global`). The `homedir()` fallback then resolves
 *  to that very same dir, so the result is still correct — it just arrives via the
 *  fallback rather than the tier home. */
export function scopeStateHome(scope: ScopeStore, tier: ScopeName = "global"): string {
  return scope.home(tier) ?? homedir();
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
}

function readFileSafe(path: string): string {
  // Ambient docs are typically <100KB. Read sync.
  return readFileSync(path, "utf8");
}

export type { RootKind };
