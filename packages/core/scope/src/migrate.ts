import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

/** Summary of a migration run. Inspect this to confirm what changed
 *  before considering the old config.yaml safe to discard. */
export interface MigrationSummary {
  /** Absolute root that was migrated. */
  root: string;
  /** Whether anything was changed on disk. */
  changed: boolean;
  /** Path of the backup file, when one was created. */
  backupPath?: string;
  /** Per-extension key counts written into settings/<ext>.yaml. */
  settingsByExt: Record<string, number>;
  /** Number of `__blob_mime__.<key>` entries converted to sidecars. */
  blobMimesMoved: number;
  /** Keys that had no extension namespace (no dot) and could not be
   *  routed to a per-extension file. They remain in the backup but are
   *  not written to the new layout. The migration is non-destructive
   *  for these — fix them by hand if any appear here. */
  skippedDotlessKeys: string[];
}

export interface MigrateOptions {
  /** When true (default), rename the old config.yaml to
   *  config.yaml.bak.<timestamp> so the data is preserved. When false,
   *  the old file stays in place — useful if you want to inspect the
   *  result before retiring the legacy file. */
  backup?: boolean;
}

/** One-shot migration for any root still holding a legacy config.yaml
 *  (single flat-dotted file + blobs/<key>). Translates into the
 *  StandardRootAdapter layout: settings/<ext>.yaml grouped by the first
 *  dotted segment, plus blobs/<key>.mime sidecars.
 *
 *  Idempotent. Does not touch personas (agents/), skills/, or any
 *  unrelated subdirectory the host tool owns. */
export function migrateRootToStandardLayout(
  root: string,
  opts: MigrateOptions = {},
): MigrationSummary {
  const backup = opts.backup !== false;
  const configPath = join(root, "config.yaml");
  const summary: MigrationSummary = {
    root,
    changed: false,
    settingsByExt: {},
    blobMimesMoved: 0,
    skippedDotlessKeys: [],
  };

  if (!existsSync(configPath)) return summary;

  let cfg: Record<string, unknown>;
  try {
    const text = readFileSync(configPath, "utf8");
    const parsed = parse(text);
    cfg = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return summary; // unreadable; nothing to do
  }

  if (Object.keys(cfg).length === 0) return summary;

  // Phase 1 — separate blob-mime entries from real settings.
  const blobMimes: Record<string, string> = {};
  const realSettings: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (k.startsWith("__blob_mime__.") && typeof v === "string") {
      const blobKey = k.slice("__blob_mime__.".length);
      blobMimes[blobKey] = v;
    } else {
      realSettings[k] = v;
    }
  }

  // Phase 2 — group real settings by extension namespace.
  const byExt = new Map<string, Record<string, unknown>>();
  for (const [k, v] of Object.entries(realSettings)) {
    const dot = k.indexOf(".");
    if (dot < 0) {
      summary.skippedDotlessKeys.push(k);
      continue;
    }
    const ext = k.slice(0, dot);
    const inner = k.slice(dot + 1);
    const bucket = byExt.get(ext) ?? {};
    setPath(bucket, inner, v);
    byExt.set(ext, bucket);
  }

  // Phase 3 — write settings/<ext>.yaml files (merge with anything that
  // might already exist there, narrower wins per sub-key for safety).
  if (byExt.size > 0) {
    const settingsDir = join(root, "settings");
    mkdirSync(settingsDir, { recursive: true });
    for (const [ext, contents] of byExt) {
      const path = join(settingsDir, `${ext}.yaml`);
      let existing: Record<string, unknown> = {};
      if (existsSync(path)) {
        try {
          const text = readFileSync(path, "utf8");
          const parsed = parse(text);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* ignore */
        }
      }
      const merged = deepMerge(contents, existing);
      writeFileSync(path, stringify(merged));
      summary.settingsByExt[ext] = countLeaves(contents);
    }
    summary.changed = true;
  }

  // Phase 4 — convert blob-mime entries to sidecar files alongside blobs.
  for (const [blobKey, mime] of Object.entries(blobMimes)) {
    const blobPath = join(root, "blobs", ...blobKey.split(/[\\/]/));
    if (existsSync(blobPath) && statSync(blobPath).isFile()) {
      writeFileSync(`${blobPath}.mime`, mime);
      summary.blobMimesMoved++;
      summary.changed = true;
    }
  }

  // Phase 5 — backup the old config.yaml.
  if (summary.changed && backup) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${configPath}.bak.${stamp}`;
    renameSync(configPath, backupPath);
    summary.backupPath = backupPath;
  }

  return summary;
}

/** Walk a directory tree for roots that look like the legacy layout (a
 *  config.yaml exists), running migration on each. Returns one summary
 *  per migrated root. Useful for batch-migrating every `.gonk/` under a
 *  workspace in one call. */
export function migrateAllUnder(
  start: string,
  opts: MigrateOptions = {},
  maxDepth = 6,
): MigrationSummary[] {
  const out: MigrationSummary[] = [];
  const visit = (dir: string, depth: number) => {
    if (depth > maxDepth) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    if (entries.includes("config.yaml")) {
      out.push(migrateRootToStandardLayout(dir, opts));
    }
    for (const e of entries) {
      const path = join(dir, e);
      try {
        if (statSync(path).isDirectory()) visit(path, depth + 1);
      } catch {
        /* ignore */
      }
    }
  };
  visit(start, 0);
  return out;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i]!;
    const next = cur[s];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cur[s] = {};
    }
    cur = cur[s] as Record<string, unknown>;
  }
  cur[segs[segs.length - 1]!] = value;
}

/** Deep-merge `narrow` on top of `broad`, narrow winning per leaf. Used to
 *  preserve any new-layout writes that already exist in settings/<ext>.yaml
 *  when the legacy config.yaml is migrated on top. */
function deepMerge(
  broad: Record<string, unknown>,
  narrow: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...broad };
  for (const [k, v] of Object.entries(narrow)) {
    const cur = out[k];
    if (
      cur &&
      typeof cur === "object" &&
      !Array.isArray(cur) &&
      v &&
      typeof v === "object" &&
      !Array.isArray(v)
    ) {
      out[k] = deepMerge(cur as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function countLeaves(obj: unknown): number {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return 1;
  let n = 0;
  for (const v of Object.values(obj as Record<string, unknown>)) n += countLeaves(v);
  return n;
}
