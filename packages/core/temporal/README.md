# @gonk/temporal

The time-and-activity decision primitive for gonk: a pure temporal-awareness surface (wall clock, session elapsed, turn index, idle signals), a periodic-run scheduler (`shouldRun`), and a persistent-presence policy (`wake`/`defer`). Pure functions where possible; the only I/O is a thin wrapper over a `@gonk/store` `KvStore` for the last-activity timestamp. Subsumes the former `@gonk/scheduler`.

## Three halves of one question

"Given the time and the activity, should something happen now?" — `@gonk/temporal` answers it in three pure pieces:

1. **`computeTemporal`** — read the time. Pure; the host supplies `now`, `sessionStartMs`, `turnIndex`, `lastActivityMs`, and gets back a `TemporalReading` (`sessionElapsedMs`, `idleMs`, …).
2. **`shouldRun`** — schedule a periodic run. Pure; `{ run, reason }` based on interval-elapsed and idle-requirement.
3. **`decidePersistentPresence`** — wake or defer a presence action. Pure; `{ outcome, reason }` based on turn, context budget, and idle.

## Durable state

The single field that must survive across turns — `lastActivityMs` — is read and written through a `@gonk/store` `KvStore<TemporalDurableState>` the caller supplies. `@gonk/temporal` owns no filesystem.

```ts
import { computeTemporal, loadLastActivity, recordActivity } from "@gonk/temporal";

const last = loadLastActivity(kv);                       // 0 if never recorded
const reading = computeTemporal({ now, sessionStartMs, turnIndex, lastActivityMs: last });
recordActivity(kv, now);                                 // once per turn
```

## Entry points

```ts
import {
  computeTemporal,
  loadLastActivity,
  recordActivity,
  shouldRun,
  defaultSchedulerState,
  decidePersistentPresence,
} from "@gonk/temporal";
import type {
  TemporalReading,
  TemporalInputs,
  TemporalDurableState,
  SchedulerState,
  ScheduleOptions,
  ScheduleDecision,
  PolicyOutcome,
  PolicyDecision,
  PresencePolicyOptions,
} from "@gonk/temporal";
```

## Scheduling

`shouldRun(state, opts, lastActivityMs, now)` returns `{ run, reason }`: never when paused, never on a fresh `lastRunAt === 0` (the host seeds it or calls the owner's `runNow()`), otherwise runs when the interval has elapsed *and* the host has been idle for `minIdleHours`. `minIdleHours: 0` disables the idle gate — the consumer fires on interval-elapsed alone (idle and session-end are unreliable triggers for long-lived sessions).

```ts
import { shouldRun, defaultSchedulerState } from "@gonk/temporal";

const state = defaultSchedulerState();                   // { lastRunAt: 0, paused: false, runCount: 0 }
const decision = shouldRun(state, { intervalHours: 6, minIdleHours: 0.5 }, lastActivityMs, now);
if (decision.run) { /* run; then the host writes state.lastRunAt = now, runCount++ */ }
```

## Persistent-presence policy

`decidePersistentPresence(reading, opts)` returns `wake` or `defer` with a reason. Rules, applied in order: never on the first turn (`turnIndex === 0`); defer when the context budget is at or above `maxContextFraction`; defer when `idleMs` is below `minIdleMs`; wake otherwise.

```ts
import { decidePersistentPresence } from "@gonk/temporal";

const { outcome, reason } = decidePersistentPresence(reading, {
  minIdleMs: 5 * 60_000,
  maxContextFraction: 0.8,
  contextFraction: 0.42,
});
```

## Install

```sh
npm i @gonk/temporal
```

## License

Apache-2.0.
