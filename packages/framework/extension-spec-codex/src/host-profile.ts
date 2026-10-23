import type { HostCapabilityProfile } from "@gonk/extension-spec";

/** Codex's capability profile (GR-85 Half A).
 *
 *  - `enforcement: "observe-only"` — this binding never emits a
 *    decision/block output for any event. `CodexHookOutput` (`run-hook.ts`)
 *    contains informational context only; explicit action-context placements
 *    are clamped to the declared context events.
 *    Note the honest caveat: `CodexHookEvent` (`types.ts`) also lists
 *    `PreToolUse` and `PermissionRequest` as native Codex event names,
 *    which suggests the host itself may support permission decisions —
 *    but this binding never wires spec hooks to those events and nothing
 *    here confirms their output contract, so this profile reports only
 *    what is provably exercised, not what the host might additionally
 *    support.
 *  - `injectionModel: "scoped"` — the default placement emits context only
 *    at `SessionStart`; `PreToolUse`, `PostToolUse` and `UserPromptSubmit` context requires
 *    an explicit `action-context` placement. Every context output is bound to
 *    the exact event encoded in the materialized command.
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
