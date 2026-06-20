import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";

// =============================================================================
// Filesystem safety primitives
// =============================================================================
//
// Path containment + atomic writes, consolidated here so every caller shares one
// implementation instead of re-deriving it. Before this package the same logic
// lived (and quietly drifted) in @gonk/scope, @gonk/store, and the Claude
// materializer. Pure node:fs/node:path — no domain coupling — so it sits at the
// bottom of the dependency tree and any package (or downstream extension) can
// import just this entry without pulling in config/persistence machinery.
//
// Import the subpath, not a barrel: `import { safeJoin } from "@gonk/utils/fs"`.
// Extensions run as unbundled Node ESM where tree-shaking does not apply, so an
// explicit subpath is what actually bounds load cost.

/** Resolve `rel` under `root` and confirm the result stays inside `root`.
 *  Throws on any path that escapes via `..`, an absolute segment, etc. `root`
 *  must already be absolute (resolve it at the call site). Use this whenever a
 *  path segment comes from untrusted/unvalidated data (a tool key, a spec-
 *  derived filename) before writing or deleting. */
export function safeJoin(root: string, rel: string): string {
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    throw new Error(`path escapes root: ${rel}`);
  }
  return abs;
}

/** Resolve a caller-supplied relative key beneath `root`/`subDir`, rejecting any
 *  key that is absolute or contains `..`/empty segments. Stricter than
 *  {@link safeJoin}: it refuses the key outright rather than normalizing it, so
 *  a stored key round-trips to exactly the path it names. Used for blob storage
 *  where the key is a stable identifier, not a path expression. */
export function safeKeyPath(root: string, subDir: string, key: string): string {
  if (key.startsWith("/") || key.startsWith("\\")) {
    throw new Error(`key must be relative: ${key}`);
  }
  const segments = normalize(key).split(/[\\/]/);
  if (segments.some((s) => s === ".." || s === "")) {
    throw new Error(`key escapes root: ${key}`);
  }
  return join(root, subDir, ...segments);
}

// -----------------------------------------------------------------------------
// Atomic writes — temp file + rename. A reader never observes a torn file; a
// crash mid-write leaves the previous version intact, not a truncated one.
// -----------------------------------------------------------------------------

function tmpFor(path: string): string {
  return `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}`;
}

/** Atomically write UTF-8 text, creating parent dirs as needed. */
export function atomicWriteText(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tmpFor(path);
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** Atomically write raw bytes, creating parent dirs as needed. */
export function atomicWriteBytes(path: string, bytes: Uint8Array): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = tmpFor(path);
  writeFileSync(tmp, bytes);
  renameSync(tmp, path);
}

/** Atomically write `value` as pretty JSON with a trailing newline. */
export function atomicWriteJson(path: string, value: unknown): void {
  atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`);
}
