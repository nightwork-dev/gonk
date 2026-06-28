import { realpathSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Canonicalize a filesystem path using the OS-native spelling/case when the path
 * exists. `realpath` requires the target to exist, so only ENOENT is a legitimate
 * fallback to `path.resolve`; other errors (EACCES, ELOOP, etc.) should surface
 * rather than silently minting a divergent id/home.
 */
export function canonicalPath(p: string): string {
  try {
    return realpathSync.native(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return resolve(p);
  }
}
