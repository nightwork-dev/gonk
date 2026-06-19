export type {
  BlobHandle,
  DocumentEntry,
  DocumentKind,
  DocumentRole,
  ResolutionEntry,
  RootAdapter,
  RootBinding,
  RootKind,
  ScopeEnvironment,
  ScopeName,
  ScopeStore,
  SetOptions,
} from "./types.ts";
export { DEFAULT_ROOT_ORDER, DOCUMENT_FILES, SCOPE_RESOLUTION_ORDER } from "./types.ts";
export {
  bindRoots,
  canonical,
  findProjectRoot,
  resolveSessionHome,
  resolveTierHomes,
  scanDocuments,
  scopeStateHome,
} from "./resolver.ts";
export {
  NATIVE_HOST_ROOT_KINDS,
  SUBSTRATE_NS,
  SUBSTRATE_STUB_FILE,
  nativeSubstrateMirror,
  readSubstrateStub,
  resolveNativeSubstrateHome,
  substrateDir,
  writeSubstrateStub,
} from "./substrate.ts";
export { adoptNativePersonaSubstrate, migrateSubstrateHome } from "./migrate-substrate.ts";
export type { SubstrateMigrationSummary, SubstrateMove } from "./migrate-substrate.ts";
export { FsScopeStore, createScope, ensureRoot } from "./fs-store.ts";
export { MemoryScopeStore } from "./memory-store.ts";
export { StandardRootAdapter } from "./standard-adapter.ts";
export {
  migrateRootToStandardLayout,
  migrateAllUnder,
} from "./migrate.ts";
export type { MigrateOptions, MigrationSummary } from "./migrate.ts";
export { resolveStableSessionId, sessionMemoryDbPath } from "./session-id.ts";
export type { SessionMemoryDbPathOptions } from "./session-id.ts";
