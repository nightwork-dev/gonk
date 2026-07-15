import type { ToolResult } from "./types.ts";

// =============================================================================
// dispatchDetachedWithWait — the tool-layer detach-by-default / wait-opt-in combinator.
//
// gonk's house pattern for heavy (minutes-scale) tools is: dispatch a DETACHED
// worker, return a job handle immediately, and let the caller opt INTO blocking with
// `wait: true` / `sync: true`. That branch was hand-rolled in pi-image, pi-rlm, and
// claude-dispatch, and MISSING from the delegation cluster (subagent / consult /
// self-model-reflect / autotune), which blocked the parent by default. This extracts
// the branch into one combinator so every heavy tool is detach-by-default correctly.
//
// It lives HERE (not @gonk/jobs) because it constructs `ToolResult` and reads
// `input.wait` — those are tool-layer concerns and `ToolResult` is defined in this
// package; @gonk/jobs is transport-free and must not gain a tool-registry dep. It is
// harness-agnostic (pi AND Claude plugins use it), so it does not belong in a
// pi-specific adapter either.
//
// It is a PURE COMBINATOR over injected closures: it owns no dispatch mechanism and no
// job store. `asyncDispatch` (a thunk that ultimately calls @gonk/jobs' dispatchDetached
// and returns at least a `jobId`) and `runInline` (the blocking runner) are supplied by
// the consumer; the consumer also owns both render functions, so no result shape is
// hardcoded onto it.
// =============================================================================

export interface DispatchDetachedWithWaitOptions<TResult, TAsyncResult> {
  /** The tool input; only `wait`/`sync` are read. A caller sets either to opt INTO
   *  blocking (the inline path). Undefined / both-absent ⇒ the default detached path. */
  input: { wait?: boolean; sync?: boolean } | undefined;
  /** Job kind + display label, e.g. "subagent", "consult". */
  kind: string;
  /** The detached path: dispatch the worker and return a handle (at least `jobId`).
   *  Undefined ⇒ no async path is available for this consumer ⇒ inline fallback. */
  asyncDispatch?: () => TAsyncResult & { jobId: string };
  /** The blocking path: run the work inline and resolve its full result. Invoked when
   *  the caller opted sync OR no `asyncDispatch` is wired. */
  runInline: () => Promise<TResult>;
  /** Render the inline result. `meta.ranSyncFallback` is true only when the inline path
   *  was taken because NO `asyncDispatch` was wired (a degraded fallback), not because
   *  the caller asked — so a consumer can stamp/telemeter the difference (pi-image does). */
  renderInline: (result: TResult, meta: { ranSyncFallback: boolean }) => ToolResult;
  /** Render the detached handle. The consumer OWNS the async result shape (subagent
   *  returns workItemId/resultPath/pid, not just jobId). Omit ⇒ a generic
   *  `{ jobId, kind, message }` payload with a "woken on completion" message. */
  renderAsync?: (dispatched: TAsyncResult & { jobId: string }) => ToolResult;
}

/**
 * Detach-by-default with a wait opt-out. Returns the detached-handle result unless the
 * caller passed `wait`/`sync` (or no async path is wired), in which case it runs inline.
 * Throws from `asyncDispatch`/`runInline` propagate unchanged — a dispatch or run failure
 * is a real error, never swallowed.
 */
export async function dispatchDetachedWithWait<TResult, TAsyncResult = { jobId: string }>(
  opts: DispatchDetachedWithWaitOptions<TResult, TAsyncResult>,
): Promise<ToolResult> {
  const optedSync = opts.input?.wait === true || opts.input?.sync === true;

  if (opts.asyncDispatch && !optedSync) {
    const dispatched = opts.asyncDispatch();
    if (opts.renderAsync) return opts.renderAsync(dispatched);
    const message =
      `${opts.kind} dispatched as background job ${dispatched.jobId}; you'll be surfaced ` +
      `the result in a follow-up on completion (poll job_status sooner if needed).`;
    return { data: { jobId: dispatched.jobId, kind: opts.kind, message }, display: message };
  }

  // Inline: the caller opted in (wait/sync), or no async dispatcher exists for this
  // consumer. Distinguish the degraded no-dispatcher case for the consumer's renderer.
  const ranSyncFallback = !opts.asyncDispatch && !optedSync;
  const result = await opts.runInline();
  return opts.renderInline(result, { ranSyncFallback });
}
