import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Canonicalize a filesystem path using the OS-native spelling/case. `realpath`
 * requires the target to exist, so a missing tail is re-appended to the
 * canonical spelling of its nearest existing ancestor. A path therefore keeps
 * one spelling before and after it is created (macOS `/var` → `/private/var`).
 * Only ENOENT is a legitimate fallback; other errors (EACCES, ELOOP, etc.)
 * surface rather than silently minting a divergent id/home.
 */
export function canonicalPath(p: string): string {
  const absolute = resolve(p);
  try {
    return realpathSync.native(absolute);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const parent = dirname(absolute);
    if (parent === absolute) return absolute;
    return join(canonicalPath(parent), basename(absolute));
  }
}
