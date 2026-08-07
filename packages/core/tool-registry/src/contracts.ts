// =============================================================================
// @gonk/tool-registry/contracts — the client-safe subset (GR-84 part b).
//
// Types and pure functions only, re-exported from the same source files the
// full `.` entry uses — never copied declarations. Ships the tool DEFINITION
// shape (a UI rendering a tool catalog needs `ToolDefinition`/`Display`/
// `ToolHints`, not the dispatch machinery), the outcome shape a UI collapses
// a tool call to, and the security-receipt types (from `@gonk/auth/contracts`)
// a UI showing an audit trail needs. Deliberately excludes `ToolRegistry`
// itself, `makeBaseContext`, and anything that constructs or dispatches
// through a `ToolContext` — those are host/server concerns.
//
// Verified by `scripts/check-client-safe-contracts.mjs`: a fixture tsconfig
// with `types: []` and no Node builtins compiles an import of this file's
// source directly (not the built dist).
// =============================================================================

export type {
  CapabilityReadiness,
  CapabilityState,
  CliHints,
  Display,
  DisplayBlock,
  DuplexControl,
  InputAudioChunk,
  InputChunk,
  InputControlChunk,
  InputRawChunk,
  InputTextChunk,
  McpHints,
  PiHints,
  ToolAuthorization,
  ToolCapabilities,
  ToolCostClass,
  ToolDefinition,
  ToolEvent,
  ToolHandler,
  ToolHandlerReturn,
  ToolHints,
  ToolLatencyClass,
  ToolResult,
  ToolVisibility,
} from "./types.ts";

export type { CollectToolOutcomeOptions, ToolOutcome } from "./outcome.ts";
export { collectToolOutcome } from "./outcome.ts";

export type {
  AuthSecurityReceipt,
  AuthorizationReceipt,
  ApprovalReceipt,
  SecurityReceiptBase,
  SessionBindingReceipt,
} from "@gonk/auth/contracts";
