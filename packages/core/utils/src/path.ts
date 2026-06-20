// =============================================================================
// Path containment — pure, platform-neutral, zero imports
// =============================================================================
//
// No node:fs, no node:path, no process — nothing in this module's import graph
// touches a Node builtin, so it bundles for a browser/edge target as-is (no
// path-browserify shim, no bundler aliasing). The Node-only filesystem syscalls
// live in the sibling `./fs` entry; keeping them apart means a browser bundle
// that imports `@gonk/utils/path` can never transitively pull in `node:fs`.
//
// POSIX-oriented: both "/" and "\" are treated as separators (so a key is
// judged safely whichever platform produced it) and results join with "/",
// which Node accepts on every platform and which matches browser OPFS naming.

/** Strip a single trailing separator so joins don't double up. */
function stripTrailingSep(p: string): string {
  return p.endsWith("/") || p.endsWith("\\") ? p.slice(0, -1) : p;
}

/** Resolve `rel`'s segments against a root, collapsing `.` and applying `..`,
 *  throwing the moment `..` would climb above the root. */
function containedSegments(rel: string): string[] {
  const out: string[] = [];
  for (const seg of rel.split(/[\\/]+/)) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length === 0) throw new Error(`path escapes root: ${rel}`);
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out;
}

/** Resolve `rel` under `root` and confirm the result stays inside `root`.
 *  Throws on any path that escapes via `..` or an absolute segment. Internal
 *  `..` that stays within the root (e.g. `a/../b`) is allowed and normalized.
 *  Use whenever a path segment comes from untrusted/unvalidated data (a tool
 *  key, a spec-derived filename) before writing or deleting. */
export function safeJoin(root: string, rel: string): string {
  if (rel.startsWith("/") || rel.startsWith("\\")) {
    throw new Error(`path escapes root: ${rel}`);
  }
  const segs = containedSegments(rel);
  return segs.length ? `${stripTrailingSep(root)}/${segs.join("/")}` : root;
}

/** Resolve a caller-supplied relative key beneath `root`/`subDir`, rejecting any
 *  key that is absolute or contains a `..` segment. Stricter than
 *  {@link safeJoin}: it refuses the key outright rather than normalizing it, so
 *  a stored key round-trips to exactly the path it names. Used for blob storage
 *  where the key is a stable identifier, not a path expression. */
export function safeKeyPath(root: string, subDir: string, key: string): string {
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new Error(`key must be relative: ${key}`);
  }
  const segs = key.split(/[\\/]+/);
  if (segs.some((s) => s === "..")) {
    throw new Error(`key escapes root: ${key}`);
  }
  const clean = segs.filter((s) => s !== "" && s !== ".");
  return [stripTrailingSep(root), subDir, ...clean].join("/");
}
