import { join } from "node:path";

import { resolveTierHomes } from "./resolver.ts";
import { substrateDir } from "./substrate.ts";

export interface WorkspaceMemoryDbPathOptions {
  /** Working directory whose directory-tier home anchors the sqlite db. */
  cwd: string;
  /** Db file basename (e.g. "triples", "cost-log"). The ".db" suffix is appended automatically. */
  name: string;
  /** Optional user home override, passed through to the shared tier-home resolver. */
  homeRoot?: string;
}

/**
 * Returns the canonical path for a workspace-continuity sqlite database:
 *   `<directory-home>/.agents/memory/<name>.db`
 *
 * The directory home is resolved by the same `resolveTierHomes` policy as the
 * rest of @gonk/scope, and the memory substrate directory is resolved via
 * `substrateDir` so native `.agents/` vs legacy `.gonk/` placement stays
 * consistent. This deliberately does not derive or use a session id: memory and
 * knowing stores must survive separate invocations in the same cwd while staying
 * isolated from other cwds. No one-time migration is attempted; old
 * session-keyed dbs are orphaned by this re-tiering.
 */
export function workspaceMemoryDbPath(opts: WorkspaceMemoryDbPathOptions): string {
  const homes = resolveTierHomes({
    cwd: opts.cwd,
    ...(opts.homeRoot !== undefined ? { homeRoot: opts.homeRoot } : {}),
  });
  const directoryHome = homes.get("directory");
  if (!directoryHome) {
    throw new Error("workspaceMemoryDbPath: no directory-tier home resolved");
  }
  return join(substrateDir("directory", directoryHome, "memory"), `${opts.name}.db`);
}
