import type { HostCapabilityProfile } from "@gonk/extension-spec";

/** Pi's capability profile (GR-85 Half A).
 *
 *  - `enforcement: "enforcing"` — hooks run in-process and their return
 *    value is consumed by the runtime as an authoritative decision, not
 *    just an observation. `before_agent_start`'s `PiBeforeAgentStartResult`
 *    replaces the assembled system prompt before the turn runs (see
 *    `pi-types.ts`'s `PiHookHandler` doc comment: "result-returning hooks
 *    ... chain their return").
 *  - `injectionModel: "event-driven"` — `pi.on(event, handler)` wires
 *    against pi's native lifecycle events directly; there is no fixed
 *    turn-boundary allowlist the way the out-of-process materializers
 *    enforce for cache safety.
 *  - `commandSurface: "native"` — `pi.registerCommand` registers a real
 *    pi slash command (see `runtime.ts`'s `registerSpecExtension`).
 *  - `scheduling: "none"` — pi has no host-side cron/schedule primitive;
 *    that lives in `@gonk/jobs` (GR-35), not the pi runtime itself.
 *  - `executionLocality: "in-process"` — extension code runs inside the
 *    pi process; hooks are direct function calls, no subprocess spawn. */
export const PI_HOST_PROFILE: HostCapabilityProfile = {
  host: "pi",
  enforcement: "enforcing",
  injectionModel: "event-driven",
  commandSurface: "native",
  scheduling: "none",
  executionLocality: "in-process",
};
