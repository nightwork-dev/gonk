/** Filesystem-backed scope: FS store + the standard root adapter.
 *  Pulls in node:fs, node:path, and yaml. Use `@gonk/scope/types` or
 *  `@gonk/scope/memory` if you don't want this footprint. */
export { FsScopeStore, createScope, ensureRoot } from "./fs-store.ts";
export { StandardRootAdapter } from "./standard-adapter.ts";
