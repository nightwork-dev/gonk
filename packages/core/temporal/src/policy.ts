import type { TemporalReading } from "./temporal.ts";

// ---------------------------------------------------------------------------
// Policy decisions driven by the temporal surface.
// ---------------------------------------------------------------------------

/** Outcome of a policy evaluation. */
export type PolicyOutcome = "wake" | "defer";

/** Decision returned by `decidePersistentPresence`, with a human-readable reason. */
export interface PolicyDecision {
  outcome: PolicyOutcome;
  reason: string;
}

/** Thresholds used by the persistent-presence policy. */
export interface PresencePolicyOptions {
  /** Minimum idle time before waking a presence task, ms.
   *  0 = no idle requirement (fire on any eligible turn). */
  minIdleMs: number;
  /** Maximum context budget used before deferring (0–1). When 0, the budget
   *  gate is disabled and only idle is checked. */
  maxContextFraction: number;
  /** Fraction of the context window currently in use (0–1). */
  contextFraction: number;
}

/** Pure policy: given a temporal reading and thresholds, decide whether to
 *  wake a persistent-presence action or defer it.
 *
 *  Rules (applied in order):
 *  1. Never on the first turn (turnIndex 0) — the session is still booting.
 *  2. Defer when the context budget is at or above `maxContextFraction`.
 *  3. Defer when idleMs is below `minIdleMs` (if minIdleMs > 0).
 *  4. Wake otherwise. */
export function decidePersistentPresence(
  reading: TemporalReading,
  opts: PresencePolicyOptions,
): PolicyDecision {
  if (reading.turnIndex === 0) {
    return { outcome: "defer", reason: "first turn — session still booting" };
  }

  if (
    opts.maxContextFraction > 0 &&
    opts.contextFraction >= opts.maxContextFraction
  ) {
    return {
      outcome: "defer",
      reason: `context at ${(opts.contextFraction * 100).toFixed(0)}% — above ${(opts.maxContextFraction * 100).toFixed(0)}% threshold`,
    };
  }

  if (opts.minIdleMs > 0 && reading.idleMs < opts.minIdleMs) {
    const shortBy = opts.minIdleMs - reading.idleMs;
    return {
      outcome: "defer",
      reason: `not idle enough (${shortBy}ms more idle required)`,
    };
  }

  return {
    outcome: "wake",
    reason: `eligible: turn ${reading.turnIndex}, idle ${reading.idleMs}ms, context ${(opts.contextFraction * 100).toFixed(0)}%`,
  };
}
