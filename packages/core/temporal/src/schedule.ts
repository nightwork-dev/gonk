/** Persistent scheduler state — host-owned, written to disk by the caller. */
export interface SchedulerState {
  /** ms since epoch. 0 means "never run". */
  lastRunAt: number;
  /** Scheduler is paused — `shouldRun` always returns false. */
  paused: boolean;
  /** How many times the owner has run, ever. */
  runCount: number;
}

/** Resolved scheduling configuration `shouldRun` reads. */
export interface ScheduleOptions {
  intervalHours: number;
  minIdleHours: number;
}

/** Decision returned by `shouldRun`, with a human-readable reason. */
export interface ScheduleDecision {
  run: boolean;
  reason: string;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/** Pure scheduling logic. `{ run: true }` when not paused, the interval has
 *  elapsed since `lastRunAt`, and the host has been idle for `minIdleHours`.
 *  `lastRunAt === 0` is treated as "never run" and refuses — the host seeds
 *  `lastRunAt` to "now" on first boot, or calls the owner's `runNow()`.
 *  `minIdleHours: 0` disables the idle requirement entirely — the consumer fires
 *  on interval-elapsed alone (the turn-hook + time-gate model; idle and
 *  session-end are unreliable triggers for long-lived sessions). */
export function shouldRun(
  state: SchedulerState,
  opts: ScheduleOptions,
  lastActivityMs: number,
  now: number,
): ScheduleDecision {
  if (state.paused) return { run: false, reason: "paused" };

  if (state.lastRunAt === 0) {
    return {
      run: false,
      reason: "never run before; host should seed lastRunAt or call runNow()",
    };
  }

  const intervalMs = opts.intervalHours * MS_PER_HOUR;
  const idleRequiredMs = opts.minIdleHours * MS_PER_HOUR;

  const sinceLastRun = now - state.lastRunAt;
  if (sinceLastRun <= intervalMs) {
    const hoursLeft = (intervalMs - sinceLastRun) / MS_PER_HOUR;
    return {
      run: false,
      reason: `within interval (${hoursLeft.toFixed(1)}h until next eligible run)`,
    };
  }

  const idleFor = now - lastActivityMs;
  if (idleRequiredMs > 0 && idleFor <= idleRequiredMs) {
    const hoursLeft = (idleRequiredMs - idleFor) / MS_PER_HOUR;
    return {
      run: false,
      reason: `not idle enough (${hoursLeft.toFixed(1)}h more idle required)`,
    };
  }

  return {
    run: true,
    reason: `interval elapsed (${(sinceLastRun / MS_PER_HOUR).toFixed(1)}h) and idle for ${(idleFor / MS_PER_HOUR).toFixed(1)}h`,
  };
}

/** Default state — `lastRunAt: 0` means "never run". */
export function defaultSchedulerState(): SchedulerState {
  return { lastRunAt: 0, paused: false, runCount: 0 };
}
