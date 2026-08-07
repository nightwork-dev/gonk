import type { HostCapabilityProfile } from "@gonk/extension-spec";

/** Codex's capability profile (GR-85 Half A).
 *
 *  - `enforcement: "observe-only"` — declared conservatively: this binding
 *    never emits a decision/block output for any event. `runCodexHook`
 *    hard-clamps every non-boundary event to `{}` after side effects run,
 *    and `CodexHookOutput` (`run-hook.ts`) has no decision variant at all.
 *    Note the honest caveat: `CodexHookEvent` (`types.ts`) also lists
 *    `PreToolUse` and `PermissionRequest` as native Codex event names,
 *    which suggests the host itself may support permission decisions —
 *    but this binding never wires spec hooks to those events and nothing
 *    here confirms their output contract, so this profile reports only
 *    what is provably exercised, not what the host might additionally
 *    support.
 *  - `injectionModel: "scoped"` — only `SessionStart` may emit
 *    `additionalContext` (the `boundary-context` placement kind); the
 *    README documents this as deliberate — Codex itself supports dynamic
 *    context on other events too, but this binding hard-clamps them for
 *    prompt-cache stability (see `README.md` "Hook convention and cache
 *    epochs").
 *  - `commandSurface: "none"` — Codex plugins here expose verbs as
 *    `skills/*\/SKILL.md` (natural-language-triggered), not a native
 *    slash-command surface (see `materialize.ts`'s `buildDefaultSkills`).
 *  - `scheduling: "none"` — no host-side cron/schedule primitive is
 *    materialized or consumed here.
 *  - `executionLocality: "out-of-process"` — each hook invocation spawns
 *    the generated `gonk-codex-hook.mjs` runner as a separate process
 *    (see `materialize.ts`'s `renderHookRunner`). */
export const CODEX_HOST_PROFILE: HostCapabilityProfile = {
  host: "codex",
  enforcement: "observe-only",
  injectionModel: "scoped",
  commandSurface: "none",
  scheduling: "none",
  executionLocality: "out-of-process",
};
