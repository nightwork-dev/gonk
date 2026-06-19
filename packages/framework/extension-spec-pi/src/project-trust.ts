/**
 * Project-trust inheritance for headless workers.
 *
 * Pi ≥ 0.78 gates project-local files (settings, resources, instructions,
 * packages) behind a trust decision. A gonk extension that spawns a headless
 * worker (`pi -p --mode json`) in the session cwd would make that worker
 * re-resolve trust on its own — and in non-interactive mode it cannot prompt,
 * so project-tier config silently fails to load. The fix: capture the parent
 * session's effective decision once at `session_start` and let spawners carry
 * it into the child as `--approve` / `--no-approve`.
 *
 * Feature-gated end to end: hosts without `ctx.isProjectTrusted()` (older pi,
 * pi 0.75.x) never write the key, so readers emit no flag and the spawn argv
 * is byte-identical to before on those hosts. The flag is also unknown to those
 * binaries, so emitting it there would error — hence the gate is load-bearing.
 *
 * The gonk session scope is keyed by cwd, not by binary, so `pi` instances in
 * the same directory share one store. A trust-aware `pi` session could leave a
 * `true` behind that a later trust-blind `pi` session would read and emit as
 * `--approve` — crashing that worker on an unknown flag. To prevent that, the
 * capture hook CLEARS the key when the current host has no trust concept, so
 * every session normalizes the shared key to its own host before any spawn.
 */

import type { ScopeStore } from "@gonk/scope";

import type { PiExtensionAPI, PiExtensionContext } from "./pi-types.ts";

/** Session-scope key holding the host's effective project-trust decision for
 *  the current cwd (`true` = trusted, `false` = declined). Absent when the host
 *  has no project-trust concept. */
export const PROJECT_TRUST_SCOPE_KEY = "host.project-trusted";

/** Wire a `session_start` capture of the host's project-trust decision into
 *  session scope. Call once from a spawning extension's `setup(pi)` with that
 *  extension's bound scope, so its later spawn paths can read the decision from
 *  the same store. No-op on hosts that don't expose `ctx.isProjectTrusted()`. */
export function captureProjectTrust(pi: PiExtensionAPI, scope: ScopeStore): void {
  pi.on("session_start", (_ev: unknown, ctx: PiExtensionContext) => {
    const fn = ctx?.isProjectTrusted;
    try {
      if (typeof fn === "function") {
        scope.set(PROJECT_TRUST_SCOPE_KEY, fn.call(ctx), "session");
      } else {
        // Trust-blind host (older pi 0.75.x): clear any value a previous
        // trust-aware session left in the cwd-shared store, so this session's
        // workers never inherit a `--approve` the binary can't parse.
        scope.delete(PROJECT_TRUST_SCOPE_KEY, "session");
      }
    } catch {
      // The session tier may have no writable root (e.g. a --no-session
      // parent). Trust inheritance is best-effort; never break session start.
    }
  });
}

/** Read the captured decision as an `approve` flag for `buildHarnessArgv` /
 *  the spawners: `true` → `--approve`, `false` → `--no-approve`, `undefined` →
 *  omit (host had no trust concept, or capture hasn't run). */
export function readProjectTrustApprove(scope: ScopeStore | undefined): boolean | undefined {
  return scope?.get<boolean>(PROJECT_TRUST_SCOPE_KEY);
}
