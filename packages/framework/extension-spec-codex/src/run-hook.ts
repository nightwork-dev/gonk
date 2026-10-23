import type { ExtensionSpec } from "@gonk/extension-spec";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import type {
  CodexActionContextEvent,
  CodexHookEvent,
  CodexHookPlacementAuthorization,
} from "./types.ts";

export interface CodexBoundaryHookContext {
  kind: "boundary-context";
  event: Record<string, unknown>;
  cwd: string;
  source: "startup" | "resume" | "clear" | "compact" | "fork" | undefined;
  injectContext(text: string): void;
}

export interface CodexActionContextHookContext {
  kind: "action-context";
  event: Record<string, unknown>;
  cwd: string;
  hookEventName: CodexActionContextEvent;
  injectContext(text: string): void;
}

export interface CodexSideEffectHookContext {
  kind: "side-effect";
  event: Record<string, unknown>;
  cwd: string;
}

export interface CodexBoundaryHookOutput {
  hookSpecificOutput?: {
    hookEventName: "SessionStart";
    additionalContext: string;
  };
}

export interface CodexActionContextHookOutput {
  hookSpecificOutput?: {
    hookEventName: CodexActionContextEvent;
    additionalContext: string;
  };
}

export type CodexHookOutput =
  | CodexBoundaryHookOutput
  | CodexActionContextHookOutput
  | Record<string, never>;

/** Existing exported cap, applied to every context-producing Codex hook. */
export const MAX_BOUNDARY_CONTEXT_CHARS = 16_384;

const CODEX_HOOK_EVENTS: readonly CodexHookEvent[] = [
  "SessionStart",
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop",
  "SessionEnd",
  "Interrupt",
];

/** Dispatch the materialized placement carried as command arguments. The
 *  payload can confirm the Codex event, but cannot grant context authority. */
export async function dispatchCodexHook(opts: {
  root: string;
  specId: string;
  specEvent: string;
  placement: CodexHookPlacementAuthorization;
  payload?: unknown;
}): Promise<CodexHookOutput> {
  if (!isValidCodexHookPlacement(opts.placement)) return {};
  return withSuppressedHandlerStdout(async () => {
    const specPath = join(opts.root, "dist", "hook-spec.cjs");
    const mod = (await import(pathToFileURL(specPath).href)) as Record<string, unknown>;
    let exported: unknown = mod.default ?? mod;
    if (exported && typeof exported === "object" && "default" in exported) {
      exported = (exported as { default: unknown }).default;
    }
    const spec = typeof exported === "function" ? (exported as () => unknown)() : exported;
    if (!spec || typeof spec !== "object" || !("id" in spec)) {
      throw new Error(`${specPath} did not yield an ExtensionSpec`);
    }
    if (spec.id !== opts.specId) {
      throw new Error(`${specPath} id does not match the materialized hook command`);
    }
    return runCodexHook(spec as ExtensionSpec, opts);
  });
}

/** Render the exact runtime policy into a plugin-local module so an installed
 *  plugin does not depend on this package being present in Codex's runtime. */
export function renderStandaloneCodexHookPolicy(): string {
  return [
    'import { join } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    `const MAX_BOUNDARY_CONTEXT_CHARS = ${MAX_BOUNDARY_CONTEXT_CHARS};`,
    `const CODEX_HOOK_EVENTS = ${JSON.stringify(CODEX_HOOK_EVENTS)};`,
    isSessionStartSource.toString(),
    isActionContextEvent.toString(),
    isValidCodexHookPlacement.toString(),
    buildContextOutput.toString(),
    withSuppressedHandlerStdout.toString(),
    runCodexHook.toString(),
    `async function dispatchCodexHook(opts) {
  if (!isValidCodexHookPlacement(opts.placement)) return {};
  return withSuppressedHandlerStdout(async () => {
    const specPath = join(opts.root, "dist", "hook-spec.cjs");
    const mod = await import(pathToFileURL(specPath).href);
    let exported = mod.default ?? mod;
    if (exported && typeof exported === "object" && "default" in exported) exported = exported.default;
    const spec = typeof exported === "function" ? exported() : exported;
    if (!spec || typeof spec !== "object" || !("id" in spec)) {
      throw new Error(specPath + " did not yield an ExtensionSpec");
    }
    if (spec.id !== opts.specId) {
      throw new Error(specPath + " id does not match the materialized hook command");
    }
    return runCodexHook(spec, opts);
  });
}`,
    "export { dispatchCodexHook };",
    "",
  ].join("\n\n");
}

/** Execute a portable hook. A matching materialized placement is required for
 *  any model-visible context; unplaced direct calls can only run side effects. */
export async function runCodexHook(
  spec: ExtensionSpec,
  opts: {
    specEvent: string;
    payload?: unknown;
    placement?: CodexHookPlacementAuthorization;
  },
): Promise<CodexHookOutput> {
  const payload =
    opts.payload && typeof opts.payload === "object"
      ? (opts.payload as Record<string, unknown>)
      : {};
  if (opts.placement) {
    if (!isValidCodexHookPlacement(opts.placement)) return {};
    if (
      payload.hook_event_name !== undefined &&
      payload.hook_event_name !== opts.placement.event
    ) {
      return {};
    }
  }

  const handler = spec.hooks?.[opts.specEvent];
  if (!handler) return {};

  const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
  const isBoundary =
    opts.specEvent === "session_start" &&
    opts.placement?.kind === "boundary-context" &&
    opts.placement.event === "SessionStart" &&
    payload.hook_event_name === "SessionStart" &&
    isSessionStartSource(payload.source);
  const isActionContext =
    opts.placement?.kind === "action-context" &&
    isActionContextEvent(opts.placement.event) &&
    payload.hook_event_name === opts.placement.event;

  if (isBoundary) {
    const source = payload.source as CodexBoundaryHookContext["source"];
    const captured: string[] = [];
    const ctx: CodexBoundaryHookContext = {
      kind: "boundary-context",
      event: payload,
      cwd,
      source,
      injectContext(text) {
        if (typeof text === "string" && text.trim()) captured.push(text.trim());
      },
    };
    await withSuppressedHandlerStdout(() => handler(payload, ctx));
    return buildContextOutput("SessionStart", captured);
  }

  if (isActionContext) {
    const hookEventName = opts.placement!.event as CodexActionContextEvent;
    const captured: string[] = [];
    const ctx: CodexActionContextHookContext = {
      kind: "action-context",
      event: payload,
      cwd,
      hookEventName,
      injectContext(text) {
        if (typeof text === "string" && text.trim()) captured.push(text.trim());
      },
    };
    await withSuppressedHandlerStdout(() => handler(payload, ctx));
    return buildContextOutput(hookEventName, captured);
  }

  const ctx: CodexSideEffectHookContext = { kind: "side-effect", event: payload, cwd };
  await withSuppressedHandlerStdout(() => handler(payload, ctx));
  return {};
}

function buildContextOutput(
  hookEventName: "SessionStart" | CodexActionContextEvent,
  captured: string[],
): CodexHookOutput {
  const additionalContext = captured.join("\n\n");
  if (!additionalContext) return {};
  if (additionalContext.length > MAX_BOUNDARY_CONTEXT_CHARS) {
    throw new Error(
      `Codex hook context exceeds ${MAX_BOUNDARY_CONTEXT_CHARS} characters; refusing injection`,
    );
  }
  return { hookSpecificOutput: { hookEventName, additionalContext } } as CodexHookOutput;
}

function isActionContextEvent(value: unknown): value is CodexActionContextEvent {
  return value === "PreToolUse" || value === "PostToolUse" || value === "UserPromptSubmit";
}

function isValidCodexHookPlacement(value: unknown): value is CodexHookPlacementAuthorization {
  if (!value || typeof value !== "object") return false;
  const placement = value as { kind?: unknown; event?: unknown };
  if (placement.kind === "boundary-context") return placement.event === "SessionStart";
  if (placement.kind === "action-context") return isActionContextEvent(placement.event);
  if (placement.kind === "side-effect") {
    return CODEX_HOOK_EVENTS.includes(placement.event as CodexHookEvent);
  }
  return false;
}

/** Hook stdout is a host-owned JSON protocol channel. Handlers may use stderr
 *  for diagnostics, but their stdout is discarded so it cannot corrupt the
 *  envelope returned by the dispatcher. */
async function withSuppressedHandlerStdout<T>(run: () => T | Promise<T>): Promise<T> {
  const originalWrite = process.stdout.write;
  const originalLog = console.log;
  const originalInfo = console.info;
  const originalDebug = console.debug;
  process.stdout.write = (() => true) as typeof process.stdout.write;
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
  try {
    return await run();
  } finally {
    process.stdout.write = originalWrite;
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
  }
}

function isSessionStartSource(
  value: unknown,
): value is "startup" | "resume" | "clear" | "compact" | "fork" {
  return (
    value === "startup" ||
    value === "resume" ||
    value === "clear" ||
    value === "compact" ||
    value === "fork"
  );
}
