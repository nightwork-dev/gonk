import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join, normalize } from "node:path";

import { canonicalPath } from "./canonical-path.ts";
import { substrateDir } from "./substrate.ts";

// =============================================================================
// resolveStableSessionId — stable session-tier scope id derived from cwd
//
// Pi extensions run `setup(pi)` once at load and don't see a stable
// per-conversation id at that moment (sessionManager only appears on per-call
// ExtensionContext, and `pi --print` is one-shot — each invocation is a new
// process with a new pid). A pid-keyed id would give every invocation its own
// scope session-tier home and memory writes from one invocation would be
// invisible to the next.
//
// We derive the id from the realpath-canonicalized cwd: symlinks are resolved
// and the OS-native spelling/case is used where the filesystem reports one, so
// the same physical dir maps to one session scope home regardless of pid, path
// casing, or symlink route. If the cwd does not exist, we gracefully fall back
// to path.resolve(cwd) so defensive/test paths still produce stable ids.
//
// Transition note: older releases keyed symlinked or differently-cased cwd
// spellings separately. This function has no session-home/root context and old
// homes carry no cwd metadata, so there is no clean, non-clobbering automatic
// carry-forward here. Existing forked homes under the old ids may need a manual
// one-time migration/alias to the canonical id if their data must be preserved.
// =============================================================================

/** Compute a stable session id for `ScopeEnvironment.sessionId`. Hashes the
 *  realpath-canonicalized cwd so identical working directories share a
 *  session-tier scope home across `pi --print` invocations even when reached via
 *  different path casing or symlinks. Falls back to `path.resolve(cwd)` when the
 *  cwd does not exist, and to `pi-<pid>` only when no cwd is supplied (test-only
 *  / defensive path). */
export function resolveStableSessionId(opts: {
  cwd: string;
  pid?: number;
}): string {
  const { cwd, pid } = opts;
  if (cwd && cwd.length > 0) {
    const canonical = canonicalPath(cwd);
    const digest = createHash("sha256").update(canonical).digest("hex").slice(0, 12);
    return `pi-cwd-${digest}`;
  }
  return `pi-${pid ?? process.pid}`;
}

/** Resolve the real per-session presence id.
 *
 * Presence entries must be keyed by the host's actual session id, not by the
 * cwd-derived stable scope id. When the host cannot provide one, fall back to a
 * unique process-prefixed UUID so two live agents in the same cwd never clobber
 * each other in the presence directory. */
export function resolveSessionId(opts: { explicitId?: string; pid?: number }): string {
  const explicitId = typeof opts.explicitId === "string" ? opts.explicitId.trim() : "";
  if (explicitId.length > 0) return explicitId;
  return `pi-${opts.pid ?? process.pid}-${randomUUID()}`;
}

// =============================================================================
// sessionMemoryDbPath — canonical path for session-tier sqlite databases
// =============================================================================

export interface SessionMemoryDbPathOptions {
  /** Stable session id, typically from resolveStableSessionId. */
  sessionId: string;
  /** Db file basename (e.g. "triples", "cost-log"). The ".db" suffix is
   *  appended automatically. */
  name: string;
  /**
   * Override the home root. When absent the function resolves in priority order:
   *   1. `process.env.HOME` (if non-empty) — matches FsScopeStore / resolveTierHomes
   *      which use `env.homeRoot ?? homedir()`.
   *   2. `os.homedir()` — the Node.js canonical user home, independent of the
   *      HOME env var. This is deliberately preferred over falling back to
   *      `process.cwd()` (as pi-memory previously did), because
   *      `<cwd>/.gonk/sessions/...` and `~/.gonk/sessions/...` are different
   *      trees and the latter is what the rest of the system (FsScopeStore,
   *      resolveTierHomes, SqliteSessionLayer) always uses.
   */
  homeRoot?: string;
}

/**
 * Returns the canonical path for a session-tier sqlite database:
 *   `<homeRoot>/.agents/sessions/<sessionId>/memory/<name>.db`
 *
 * The sessions container under the user home is resolved via the common
 * `substrateDir` policy (so it agrees with `resolveTierHomes`' session-tier home
 * and falls back to a legacy `.gonk/sessions` until migrated). The per-session
 * `memory/` subdir is bare — the session home is already a `.agents`-namespaced
 * dir, so its substrate lives directly under it.
 *
 * Callers are responsible for ensuring the parent directory exists before
 * opening the db. TriplesLayer, CostLog, and SqliteSessionLayer each create
 * their parent dir on first write — this helper only computes the path.
 */
export function sessionMemoryDbPath(opts: SessionMemoryDbPathOptions): string {
  const { sessionId, name } = opts;
  const home = opts.homeRoot
    ?? (process.env.HOME && process.env.HOME.length > 0 ? process.env.HOME : homedir());
  const sessionsBase = substrateDir("global", normalize(home), "sessions");
  return join(sessionsBase, sessionId, "memory", `${name}.db`);
}
