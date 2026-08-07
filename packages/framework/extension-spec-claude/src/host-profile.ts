import type { HostCapabilityProfile } from "@gonk/extension-spec";

/** Claude's capability profile (GR-85 Half A).
 *
 *  - `enforcement: "enforcing"` — Claude Code's native hook protocol lets a
 *    hook veto a turn: `Stop` and `UserPromptSubmit` — the exact two
 *    events this binding's `SPEC_TO_CLAUDE_EVENT` maps `turn_complete` and
 *    `before_provider_request` onto (see `run-hook.ts`) — natively accept
 *    a `decision: "block"` output. **This binding does not exercise that
 *    capability today**: `runClaudeHook` only ever emits
 *    `hookSpecificOutput.additionalContext`, never a decision field (see
 *    `ClaudeHookOutput` in `run-hook.ts`, which has no decision variant).
 *    The profile describes the host, not this package's current usage of
 *    it — the gap is real and is exactly the kind of mismatch GR-85 Half B
 *    would annotate per-capability.
 *  - `injectionModel: "scoped"` — injection is restricted to the three
 *    boundary events in `CONTEXT_OUTPUT_EVENTS` (`SessionStart`, `Stop`,
 *    `UserPromptSubmit`), not arbitrary lifecycle points.
 *  - `commandSurface: "native"` — the materializer's `commands/*.md`
 *    files are Claude Code's own native plugin slash-command mechanism
 *    (see `materialize.ts` / `placement.ts`), not a fallback surface.
 *  - `scheduling: "none"` — no host-side cron/schedule primitive is
 *    materialized or consumed here.
 *  - `executionLocality: "out-of-process"` — each hook invocation spawns
 *    the `gonk-claude-hook` binary as a separate process (see
 *    `bin/gonk-claude-hook.ts`); there is no persistent in-process
 *    extension runtime. */
export const CLAUDE_HOST_PROFILE: HostCapabilityProfile = {
  host: "claude",
  enforcement: "enforcing",
  injectionModel: "scoped",
  commandSurface: "native",
  scheduling: "none",
  executionLocality: "out-of-process",
};
