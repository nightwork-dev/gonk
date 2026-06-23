import type { KvStore } from "@gonk/store/types";

// ---------------------------------------------------------------------------
// Durable state — the one field that must survive across turns.
// ---------------------------------------------------------------------------

/** Host reads/writes this through the @gonk/store KvStore the caller supplies. */
export interface TemporalDurableState {
  /** ms since epoch. Updated by the host via `recordActivity()`. */
  lastActivityMs: number;
}

const DURABLE_KEY = "state";

// ---------------------------------------------------------------------------
// Reading — what callers get back from `computeTemporal`.
// ---------------------------------------------------------------------------

/** Snapshot of all time signals a persistent-presence policy needs. */
export interface TemporalReading {
  /** Wall clock at the moment of the call, ms epoch. */
  wallClockNow: number;
  /** When the session started, ms epoch. */
  sessionStartMs: number;
  /** How long the session has been running, ms. */
  sessionElapsedMs: number;
  /** How many turns the host has completed this session (0-indexed on first). */
  turnIndex: number;
  /** When activity was last recorded, ms epoch. 0 = never. */
  lastActivityMs: number;
  /** How long since the last activity, ms. 0 when lastActivityMs is 0. */
  idleMs: number;
}

/** Inputs the host must supply each call — pure, no I/O. */
export interface TemporalInputs {
  /** Current wall-clock time, ms epoch. */
  now: number;
  /** When this session was created, ms epoch. */
  sessionStartMs: number;
  /** Number of turns completed so far in this session (0 on the first turn). */
  turnIndex: number;
  /** Last recorded activity, ms epoch. 0 = never recorded. Pass the value
   *  returned by `loadLastActivity()` after calling `recordActivity()`. */
  lastActivityMs: number;
}

/** Compute the full temporal reading from host-supplied inputs. Pure — no I/O. */
export function computeTemporal(inputs: TemporalInputs): TemporalReading {
  const { now, sessionStartMs, turnIndex, lastActivityMs } = inputs;
  return {
    wallClockNow: now,
    sessionStartMs,
    sessionElapsedMs: now - sessionStartMs,
    turnIndex,
    lastActivityMs,
    idleMs: lastActivityMs === 0 ? 0 : now - lastActivityMs,
  };
}

// ---------------------------------------------------------------------------
// Durable helpers — the only I/O surface (thin wrapper over the KvStore).
// ---------------------------------------------------------------------------

/** Load the last-activity timestamp from durable storage. Returns 0 if never
 *  recorded (new session, or store not yet written). */
export function loadLastActivity(kv: KvStore<TemporalDurableState>): number {
  return kv.get(DURABLE_KEY)?.lastActivityMs ?? 0;
}

/** Persist `now` as the last-activity timestamp. Call once per turn. */
export function recordActivity(
  kv: KvStore<TemporalDurableState>,
  now: number,
): void {
  kv.set(DURABLE_KEY, { lastActivityMs: now });
}
