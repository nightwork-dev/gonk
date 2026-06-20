import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// =============================================================================
// Atomic filesystem writes — Node-only
// =============================================================================
//
// node:fs syscalls + process.pid: this module is fundamentally non-browser, so
// it is quarantined behind the `@gonk/utils/fs` subpath, separate from the pure
// containment logic in `./path`. A non-Node consumer imports `@gonk/utils/path`
// and the import graph keeps `node:fs` out by construction.
//
// Temp file + rename: a reader never observes a torn file, and a crash mid-write
// leaves the previous version intact rather than a truncated one. Consolidated
// here so @gonk/scope, @gonk/store, and the Claude materializer share one
// implementation instead of each re-deriving it (and drifting).

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
