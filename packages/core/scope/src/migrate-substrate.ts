import { cpSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  SUBSTRATE_KINDS,
  SUBSTRATE_NS,
  nativeSubstrateMirror,
  substrateDir,
  writeSubstrateStub,
} from "./substrate.ts";

const LEGACY_NS = ".gonk";

export interface SubstrateMove {
  from: string;
  to: string;
}

export interface SubstrateMigrationSummary {
  /** The tier home that was migrated. */
  home: string;
  /** Substrate dirs relocated into `<home>/.agents/<kind>`. */
  moved: SubstrateMove[];
  /** Legacy dirs left in place because the destination already existed (we
   *  never merge sqlite stores). Resolve these by hand if any appear. */
  skipped: { from: string; to: string; reason: string }[];
}

/** Move a NON-session tier home's legacy substrate — bare `<home>/<kind>` and
 *  `<home>/.gonk/<kind>` — into the canonical `<home>/.agents/<kind>` layout, for
 *  every kind in {@link SUBSTRATE_KINDS}.
 *
 *  Idempotent and non-clobbering: once everything lives under `.agents/` a
 *  re-run is a no-op, and if a destination already exists the source is left in
 *  place and reported in `skipped` rather than merged. Moving a whole dir keeps
 *  sqlite WAL/SHM files together (a rename is atomic within a filesystem; across
 *  filesystems it falls back to copy-then-remove). Session homes are NOT passed
 *  here — their substrate already lives bare under the session home.
 *
 *  `dryRun` reports what WOULD move without touching disk. */
export function migrateSubstrateHome(
  home: string,
  opts: { dryRun?: boolean } = {},
): SubstrateMigrationSummary {
  const summary: SubstrateMigrationSummary = { home, moved: [], skipped: [] };
  for (const kind of SUBSTRATE_KINDS) {
    const dest = join(home, SUBSTRATE_NS, kind);
    // Prefer the .gonk namespace over a bare dir if both legacy forms exist.
    for (const src of [join(home, LEGACY_NS, kind), join(home, kind)]) {
      if (src === dest || !isDir(src)) continue;
      if (existsSync(dest)) {
        summary.skipped.push({ from: src, to: dest, reason: "destination already exists" });
        continue;
      }
      if (!opts.dryRun) {
        mkdirSync(join(home, SUBSTRATE_NS), { recursive: true });
        moveDir(src, dest);
      }
      summary.moved.push({ from: src, to: dest });
    }
  }
  return summary;
}

/** Opt-in adoption of a NATIVE-host persona: move its substrate out of the host
 *  definition dir and into the gonk-owned mirror, then leave a portable stub at
 *  the definition home pointing to the mirror. The destination is taken from the
 *  common `substrateDir` policy (so it always equals where live resolution reads
 *  native substrate — never orphaned); sources are the def home's `.agents/<kind>`,
 *  legacy `.gonk/<kind>`, and bare `<kind>`.
 *
 *  Idempotent (a second run moves nothing) and non-clobbering (a pre-existing
 *  destination leaves the source and is reported, never merged). After adoption
 *  the host definition dir holds no substrate dir — only the stub. `dryRun`
 *  reports what WOULD move without touching disk and without writing the stub. */
export function adoptNativePersonaSubstrate(
  definitionHome: string,
  globalHome: string,
  host: string,
  id: string,
  opts: { dryRun?: boolean } = {},
): SubstrateMigrationSummary {
  const mirror = nativeSubstrateMirror(globalHome, host, id);
  const summary: SubstrateMigrationSummary = { home: definitionHome, moved: [], skipped: [] };
  for (const kind of SUBSTRATE_KINDS) {
    const dest = substrateDir("persona", mirror, kind);
    for (const src of [
      join(definitionHome, SUBSTRATE_NS, kind),
      join(definitionHome, LEGACY_NS, kind),
      join(definitionHome, kind),
    ]) {
      if (src === dest || !isDir(src)) continue;
      if (existsSync(dest)) {
        summary.skipped.push({ from: src, to: dest, reason: "destination already exists" });
        continue;
      }
      if (!opts.dryRun) {
        mkdirSync(dirname(dest), { recursive: true });
        moveDir(src, dest);
      }
      summary.moved.push({ from: src, to: dest });
    }
  }
  // Drop the forwarding stub (records the adoption + lets resolution follow it)
  // — but NOT when every source was skipped because the destination already
  // existed: that leaves the user's data in the definition home ("resolve by
  // hand"), so a stub claiming it moved to the mirror would mislead.
  const movedOrNothingToMove = summary.moved.length > 0 || summary.skipped.length === 0;
  if (!opts.dryRun && movedOrNothingToMove) writeSubstrateStub(definitionHome, mirror);
  return summary;
}

/** Rename within a filesystem (atomic, keeps sqlite sidecars together); fall
 *  back to copy-then-remove across filesystems (EXDEV). */
function moveDir(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EXDEV") throw err;
    cpSync(src, dest, { recursive: true });
    rmSync(src, { recursive: true, force: true });
  }
}

function isDir(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}
