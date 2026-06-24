import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { atomicWriteJson } from "@gonk/utils/fs";
import { isAbsolute, join, sep } from "node:path";

import type { RootKind, ScopeName } from "./types.ts";

// =============================================================================
// Substrate directory policy
// =============================================================================
//
// One place that decides where a tier's auto-spawned operational substrate
// (memory, knowledge, session sqlite) lives, so it never litters a bare $HOME
// or a project cwd. Leaf module (no imports from resolver/session-id) so both
// can depend on it without a cycle.

/** The hidden namespace under a tier home where gonk's auto-spawned operational
 *  substrate lives. Bound roots (`agents/`, `settings/`, `skills/`, `blobs/`)
 *  are a separate, user-authored layout and are NOT moved here. */
export const SUBSTRATE_NS = ".agents";
const LEGACY_SUBSTRATE_NS = ".gonk";

/** The dir names gonk auto-spawns under a tier's namespace for operational
 *  stores. Distinct from bound roots (agents/settings/skills/blobs), which are
 *  user-authored.
 *
 *  LOAD-BEARING for project detection: `findProjectRoot` uses this set to tell a
 *  cache from a project — a `.agents`/`.gonk` dir holding ONLY these kinds is
 *  treated as substrate, not a project root. If you add a new substrate kind to
 *  any `substrateDir(...)` call site, add it here too, or a dir holding only the
 *  new kind will be falsely promoted to a project root (silently — no error, no
 *  failing test, just over-eager project-tier resolution). */
export const SUBSTRATE_KINDS = ["memory", "knowledge", "sessions", "store"] as const;

/** The one common function that resolves where a tier's operational substrate of
 *  `kind` lives, based on the scope `tier` and its `tierHome`. Nothing should
 *  hardcode these paths — call this.
 *
 *  - **Pure-substrate containers** — a session home (`<home>/.agents/sessions/<id>`)
 *    or a native-host substrate mirror (`<home>/.agents/native/<host>/<id>`). These
 *    hold ONLY substrate (no bound roots), and the home is already inside gonk's
 *    `.agents/` namespace, so substrate lives directly under it (`<home>/<kind>`).
 *    Nesting another `.agents/` would just double-nest.
 *  - **Every other tier** (global/project/directory/persona): the home is a user
 *    dir (`$HOME`, a cwd, a persona definition home), so substrate hides under
 *    `.agents/` (`<tierHome>/.agents/<kind>`) rather than littering the dir.
 *    Resolves with a read-old fallback so existing installs keep reading until
 *    migrated: a pre-existing `.agents/<kind>` wins; else legacy `.gonk/<kind>`;
 *    else legacy bare `<kind>`; else the canonical `.agents` path. */
export function substrateDir(tier: ScopeName, tierHome: string, kind: string): string {
  if (tier === "session" || isNativeMirrorHome(tierHome)) return join(tierHome, kind);
  const next = join(tierHome, SUBSTRATE_NS, kind);
  if (isDir(next)) return next;
  const gonk = join(tierHome, LEGACY_SUBSTRATE_NS, kind);
  if (isDir(gonk)) return gonk;
  const bare = join(tierHome, kind);
  if (isDir(bare)) return bare;
  return next;
}

// =============================================================================
// Native-host substrate mirror
// =============================================================================
//
// A persona defined inside a native HOST directory (`~/.claude/agents/<id>`,
// `.codex`, ...) must NOT get gonk substrate written into the host's managed
// dir — that can collide with the host's own formats and harm its function. So
// its substrate (memory/knowledge) redirects to a gonk-owned mirror, keyed by
// host + id, while the persona DEFINITION and its bound roots stay put.

/** Root kinds owned by a native host tool. A persona discovered under one of
 *  these has its substrate mirrored into gonk's namespace rather than written
 *  into the host's dir. (Bare `agents`, `.agents`, `.gonk` are gonk-native and
 *  keep substrate in the definition home.) */
export const NATIVE_HOST_ROOT_KINDS: readonly RootKind[] = [
  ".claude",
  ".codex",
  ".gemini",
  ".cursor",
  ".windsurf",
  ".opencode",
  ".aider",
  ".pi",
];

/** Dir under the global `.agents/` namespace that holds all native-host mirrors. */
const NATIVE_MIRROR_DIR = "native";

/** Canonical mirror dir for a native-host persona's substrate:
 *  `<globalHome>/.agents/native/<host>/<id>`. Host-keyed so different hosts'
 *  substrate never shares a dir (their formats may differ). */
export function nativeSubstrateMirror(globalHome: string, host: string, id: string): string {
  return join(globalHome, SUBSTRATE_NS, NATIVE_MIRROR_DIR, host, id);
}

/** Whether a tier home is a native-host substrate mirror (`<…>/.agents/native/…`).
 *  Such a home is a pure gonk-owned substrate container, so `substrateDir` keeps
 *  its substrate bare rather than nesting another `.agents/`. Matches the layout
 *  `nativeSubstrateMirror` produces — both live here, so this stays in sync. */
function isNativeMirrorHome(tierHome: string): boolean {
  const segs = tierHome.split(sep);
  const i = segs.indexOf(SUBSTRATE_NS);
  return i >= 0 && segs[i + 1] === NATIVE_MIRROR_DIR;
}

/** Hidden, gonk-namespaced stub a native persona's definition home keeps after
 *  adoption — a portable forwarding pointer to where its substrate moved.
 *  Deliberately NOT a substrate kind name (no `memory` collision) and a plain
 *  file (not a filesystem xattr, which would not survive copy/sync/git across
 *  machines — the same fragility that ruled out symlinks). */
export const SUBSTRATE_STUB_FILE = ".gonk-substrate.json";

interface SubstrateStub {
  path: string;
}

/** Write the forwarding stub into a native persona's definition home. */
export function writeSubstrateStub(definitionHome: string, mirrorPath: string): void {
  mkdirSync(definitionHome, { recursive: true });
  const stub: SubstrateStub = { path: mirrorPath };
  atomicWriteJson(join(definitionHome, SUBSTRATE_STUB_FILE), stub);
}

/** Read the substrate-redirect path from a definition home's stub, or undefined
 *  when there is no stub or it is malformed. */
export function readSubstrateStub(definitionHome: string): string | undefined {
  try {
    const raw = readFileSync(join(definitionHome, SUBSTRATE_STUB_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<SubstrateStub>;
    // Only trust an absolute path. The stub is written programmatically with an
    // absolute mirror path; a relative one (hand-edited / corrupted) would
    // resolve against an unpredictable cwd, so reject it.
    return typeof parsed.path === "string" && isAbsolute(parsed.path) ? parsed.path : undefined;
  } catch {
    return undefined;
  }
}

/** Resolve where a native-host persona's substrate lives, honoring "use what's
 *  available, create only if nothing exists": a stub at the definition home
 *  wins (a prior adoption's forwarding pointer); otherwise the canonical mirror.
 *  Never returns a path inside the host definition dir. */
export function resolveNativeSubstrateHome(
  definitionHome: string,
  globalHome: string,
  host: string,
  id: string,
): string {
  return readSubstrateStub(definitionHome) ?? nativeSubstrateMirror(globalHome, host, id);
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}
