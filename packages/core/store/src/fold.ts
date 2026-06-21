import type { LogStore } from "./types.ts";

// =============================================================================
// FoldStore — durable state as an append-only log + fold-on-read.
// =============================================================================
//
// The problem this solves: two independent handles over the same backing each
// load → mutate → write-back a whole state blob, and the last writer clobbers
// the other's update. The fix is to stop read-modify-writing a live blob at all.
//
// Current state is a *derivation*, not a stored value: it is the fold of a pure
// reducer over an append-only log of events. A writer never reads-then-writes a
// state blob — it only `append`s an event. The append's record body lands via
// `O_APPEND` at the write syscall, so concurrent appenders never interleave or
// lose a record body. (The byte-offset `logAppend` returns is best-effort — it
// is computed with a stat-then-append and is NOT concurrency-safe; see the
// FsStoreBackend note. The fold path never reads that offset, so this does not
// affect the no-clobber guarantee.) The derived state therefore contains every
// appended event by construction — no lost write.
//
// Derive-on-wake reconciliation (catch a session up to the present) becomes a
// pure derivation: `state()` reads the log and folds. Because reading writes
// nothing, two sessions waking into the same gap cannot double-apply — they
// both derive the same state from the same log.
//
// When reconciliation must *record* a decision (e.g. "I have processed the gap
// up to here"), that decision is itself an appended event, made idempotent by a
// `dedupeKey`: the fold applies the first event seen for a key and skips later
// duplicates. Two handles reconciling the same gap append two events with the
// SAME key; the fold collapses them to one effect. Idempotent-by-derivation, not
// by a read-modify-write guard.

/** A pure reducer folding event `E` into state `S`. Must not mutate `prev`;
 *  return the next state. Purity is what makes fold-on-read and reconciliation
 *  safe to run from any number of handles. */
export type Reducer<S, E> = (prev: S, event: E) => S;

/** A log record wrapping a domain event. `dedupeKey`, when present, makes the
 *  event idempotent under the fold: only the first occurrence of a key is
 *  applied, so re-appending the same logical event (the derive-on-wake case)
 *  has no additional effect. */
export interface FoldEvent<E> {
  event: E;
  /** Optional idempotency key. Events sharing a key fold to a single effect. */
  dedupeKey?: string;
}

/** Durable state modeled as fold-on-read over an append-only event log.
 *
 *  Construct over a `LogStore<FoldEvent<E>>` obtained from the store factory
 *  (`store.log(tier, namespace)`). Multiple `FoldStore` handles over the same
 *  backing are safe: appends are commutative at the log level and state is
 *  always re-derived, never written back. */
export class FoldStore<S, E> {
  constructor(
    private readonly log: LogStore<FoldEvent<E>>,
    private readonly reducer: Reducer<S, E>,
    private readonly initial: () => S,
  ) {}

  /** Append a domain event. Returns the log byte offset (from the underlying
   *  LogStore). This is the only write path — never a read-modify-write of a
   *  state blob, so concurrent writers cannot clobber one another. */
  append(event: E, opts?: { dedupeKey?: string }): number {
    const record: FoldEvent<E> =
      opts?.dedupeKey !== undefined ? { event, dedupeKey: opts.dedupeKey } : { event };
    return this.log.append(record);
  }

  /** Derive current state by folding the reducer over the whole log. Reads only
   *  — writes nothing — so it is safe to call from any number of handles and is
   *  the reconciliation primitive (derive-on-wake is just `state()`). Events
   *  with a previously-seen `dedupeKey` are skipped, making re-recorded
   *  reconciliation events idempotent. */
  state(): S {
    let acc = this.initial();
    const seen = new Set<string>();
    for (const record of this.log.scan()) {
      if (record.dedupeKey !== undefined) {
        if (seen.has(record.dedupeKey)) continue;
        seen.add(record.dedupeKey);
      }
      acc = this.reducer(acc, record.event);
    }
    return acc;
  }
}

/** A compaction/checkpoint that rewrites the log to a single snapshot event is
 *  the one operation that genuinely needs a cross-process lock: it is a
 *  read-all-then-replace, the exact read-modify-write the append-fold design
 *  removed from the hot path. Two compactors racing could drop events appended
 *  between one's read and its replace. Compaction is therefore intentionally NOT
 *  implemented in this slice — the fs backend has no cross-process lock to make
 *  the replace safe. Append-fold keeps the log bounded-in-practice for a single
 *  persona's durable state; compaction (with a flock/lockfile-guarded replace,
 *  or transactional semantics from a future SqliteStoreBackend) is deferred.
 *
 *  This stub exists so the gap is named in code, not silently skipped. */
export function compact(): never {
  throw new Error(
    "FoldStore.compact: log compaction requires a cross-process lock not provided by the fs backend; deferred (see fold.ts).",
  );
}
