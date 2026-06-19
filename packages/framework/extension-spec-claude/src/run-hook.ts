/** General runtime for Claude Code hooks declared in an ExtensionSpec.
 *
 *  A spec declares `hooks: { session_start, before_provider_request, ... }`.
 *  The materializer emits a `hooks.json` that runs the `gonk-claude-hook`
 *  binary; the binary loads the plugin's spec and calls `runClaudeHook`, which
 *  invokes the handler and turns anything the handler injects into Claude's
 *  `hookSpecificOutput.additionalContext` envelope.
 *
 *  Host-agnostic: handlers stay `(event, ctx) => void`. The injection channel
 *  is `ctx.injectContext(text)`, the same shape a Pi handler would call. */

import type { ExtensionSpec } from "@gonk/extension-spec";

/** Narrowed hook context the Claude runtime provides. Handlers receive this as
 *  their second argument (typed `unknown` at the spec layer). */
export interface ClaudeHookContext {
  /** Parsed Claude hook payload (hookEventName, source, cwd, ...). */
  event: Record<string, unknown>;
  /** Directory the hook fired in (from the payload, else process.cwd()). */
  cwd: string;
  /** For SessionStart: "startup" | "resume" | "compact" | "clear". The
   *  `"compact"` source is how post-compaction re-injection arrives. */
  source?: string;
  /** Inject text into the model's context. Concatenated and emitted as
   *  `additionalContext`. Empty/whitespace injections are ignored. */
  injectContext(text: string): void;
}

export interface ClaudeHookOutput {
  hookSpecificOutput?: { hookEventName: string; additionalContext: string };
}

/** Spec hook event → Claude hook event. Only events that can inject context
 *  are mapped; others produce no output. */
const SPEC_TO_CLAUDE_EVENT: Record<string, string> = {
  session_start: "SessionStart",
  before_provider_request: "UserPromptSubmit",
};

/** Invoke a spec's hook handler for `specEvent` and return the Claude hook
 *  output. Returns `{}` when there is no handler, no mapping, or nothing was
 *  injected. Pure except for the handler's own effects. */
export async function runClaudeHook(
  spec: ExtensionSpec,
  opts: { specEvent: string; payload?: unknown },
): Promise<ClaudeHookOutput> {
  const handler = spec.hooks?.[opts.specEvent];
  const hookEventName = SPEC_TO_CLAUDE_EVENT[opts.specEvent];
  if (!handler || !hookEventName) return {};

  const payload =
    opts.payload && typeof opts.payload === "object"
      ? (opts.payload as Record<string, unknown>)
      : {};
  const cwd = typeof payload.cwd === "string" ? payload.cwd : process.cwd();
  const source = typeof payload.source === "string" ? payload.source : undefined;

  const captured: string[] = [];
  const ctx: ClaudeHookContext = {
    event: payload,
    cwd,
    ...(source !== undefined ? { source } : {}),
    injectContext: (text) => {
      if (typeof text === "string" && text.trim()) captured.push(text.trim());
    },
  };

  await handler(payload, ctx);

  const additionalContext = captured.join("\n\n");
  if (!additionalContext) return {};
  return { hookSpecificOutput: { hookEventName, additionalContext } };
}
