import type { ExtensionSpec } from "@gonk/extension-spec";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export interface CodexBoundaryHookContext {
  kind: "boundary-context";
  event: Record<string, unknown>;
  cwd: string;
  source: "startup" | "resume" | "clear" | "compact" | undefined;
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

export type CodexHookOutput = CodexBoundaryHookOutput | Record<string, never>;

export const MAX_BOUNDARY_CONTEXT_CHARS = 16_384;

export async function dispatchCodexHook(opts: {
  root: string;
  specEvent: string;
  payload?: unknown;
}): Promise<CodexHookOutput> {
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
    return runCodexHook(spec as ExtensionSpec, opts);
  });
}

/** Render the exact runtime policy into a plugin-local module. Function source
 * is serialized from the implementation above so the package CLI and emitted
 * dispatcher cannot drift into separate cache-safety rules. */
export function renderStandaloneCodexHookPolicy(): string {
  return [
    'import { join } from "node:path";',
    'import { pathToFileURL } from "node:url";',
    `const MAX_BOUNDARY_CONTEXT_CHARS = ${MAX_BOUNDARY_CONTEXT_CHARS};`,
    isSessionStartSource.toString(),
    withSuppressedHandlerStdout.toString(),
    runCodexHook.toString(),
    `async function dispatchCodexHook(opts) {
  return withSuppressedHandlerStdout(async () => {
    const specPath = join(opts.root, "dist", "hook-spec.cjs");
    const mod = await import(pathToFileURL(specPath).href);
    let exported = mod.default ?? mod;
    if (exported && typeof exported === "object" && "default" in exported) exported = exported.default;
    const spec = typeof exported === "function" ? exported() : exported;
    if (!spec || typeof spec !== "object" || !("id" in spec)) {
      throw new Error(\`${"${specPath}"} did not yield an ExtensionSpec\`);
    }
    return runCodexHook(spec, opts);
  });
}`,
    "export { dispatchCodexHook };",
    "",
  ].join("\n\n");
}

/** Execute a portable hook behind the cache-safe Codex boundary. Only
 *  `session_start` can capture and emit developer context. All other spec
 *  events get a context with no injection method and are hard-clamped to an
 *  empty output after their side effects complete. */
export async function runCodexHook(
  spec: ExtensionSpec,
  opts: { specEvent: string; payload?: unknown },
): Promise<CodexHookOutput> {
  const handler = spec.hooks?.[opts.specEvent];
  if (!handler) return {};

  const payload =
    opts.payload && typeof opts.payload === "object"
      ? (opts.payload as Record<string, unknown>)
      : {};
  const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();

  const source = isSessionStartSource(payload.source) ? payload.source : undefined;
  const isBoundary =
    opts.specEvent === "session_start" &&
    payload.hook_event_name === "SessionStart" &&
    source !== undefined;
  if (!isBoundary) {
    const ctx: CodexSideEffectHookContext = { kind: "side-effect", event: payload, cwd };
    await withSuppressedHandlerStdout(() => handler(payload, ctx));
    return {};
  }

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
  const additionalContext = captured.join("\n\n");
  if (!additionalContext) return {};
  if (additionalContext.length > MAX_BOUNDARY_CONTEXT_CHARS) {
    throw new Error(
      `Codex boundary context exceeds ${MAX_BOUNDARY_CONTEXT_CHARS} characters; refusing injection`,
    );
  }
  return {
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext },
  };
}

/** Hook stdout is a host-owned JSON protocol channel. Handlers may use stderr
 *  for diagnostics, but their stdout is discarded so they cannot corrupt the
 *  envelope returned by the dispatcher. Hook dispatch runs one handler per
 *  short-lived process, so the temporary process writer replacement is scoped
 *  to that handler invocation. */
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
): value is "startup" | "resume" | "clear" | "compact" {
  return value === "startup" || value === "resume" || value === "clear" || value === "compact";
}
