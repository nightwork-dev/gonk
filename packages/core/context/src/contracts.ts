// =============================================================================
// @gonk/context/contracts — the client-safe subset (GR-84 part b).
//
// Receipt types only, re-exported from `./types.ts` — never copied
// declarations. A UI showing "what context did the compiler include/exclude
// and why" needs the receipt shape, not the compiler engine, the
// contributor registry, or the request/candidate types that carry a live
// `AuthContext`.
//
// Verified by `scripts/check-client-safe-contracts.mjs`: a fixture tsconfig
// with `types: []` and no Node builtins compiles an import of this file's
// source directly (not the built dist).
// =============================================================================

export type {
  ContextAudience,
  ContextBlockingReason,
  ContextCompilationReceipt,
  ContextCompileStatus,
  ContextDropReason,
  ContextEstimateQuality,
  ContextNecessity,
  ContextReceiptDrop,
  ContextReceiptSelection,
  ContextTokenCount,
} from "./types.ts";
