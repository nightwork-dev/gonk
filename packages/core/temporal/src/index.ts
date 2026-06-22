export type {
  TemporalDurableState,
  TemporalReading,
  TemporalInputs,
} from "./temporal.ts";
export {
  computeTemporal,
  loadLastActivity,
  recordActivity,
} from "./temporal.ts";

export type { PolicyOutcome, PolicyDecision, PresencePolicyOptions } from "./policy.ts";
export { decidePersistentPresence } from "./policy.ts";

// Scheduling — the periodic-run decision (folded in from the former
// @gonk/scheduler). `shouldRun` consumes the idle/lastActivity reading
// `computeTemporal` produces, so the two halves of "given time + activity, should
// something happen now" live in one package.
export type { SchedulerState, ScheduleOptions, ScheduleDecision } from "./schedule.ts";
export { shouldRun, defaultSchedulerState } from "./schedule.ts";
