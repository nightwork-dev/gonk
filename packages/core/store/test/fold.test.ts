import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BackedLogStore, compact, FoldStore, FsStoreBackend } from "../src/index.ts";
import type { FoldEvent } from "../src/index.ts";

// A persona's durable counter-state, modeled as an event log:
//   - { type: "bump", by } increments a named counter
// Current state is the fold of these events. No handle ever read-modify-writes
// a state blob, so two handles over the same backing cannot clobber.
type Event = { type: "bump"; name: string; by: number };
type State = Record<string, number>;

const reducer = (prev: State, e: Event): State =>
  e.type === "bump" ? { ...prev, [e.name]: (prev[e.name] ?? 0) + e.by } : prev;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-fold-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A FoldStore over a fresh LogStore + FsStoreBackend on `dir`. Each call models
 *  an INDEPENDENT handle (own backend instance, no shared in-memory state) over
 *  the SAME on-disk backing — i.e. two processes / two bound scopes. */
function handle(): FoldStore<State, Event> {
  const log = new BackedLogStore<FoldEvent<Event>>(new FsStoreBackend(dir));
  return new FoldStore<State, Event>(log, reducer, () => ({}));
}

describe("FoldStore (append-fold)", () => {
  it("two handles over the same backing each append → fold derives BOTH (no lost write)", () => {
    const a = handle();
    const b = handle();

    // Two independent handles each mutate. With the old read-modify-write-the-blob
    // model the second writer would clobber the first. Here each only appends.
    a.append({ type: "bump", name: "x", by: 1 });
    b.append({ type: "bump", name: "x", by: 1 });
    a.append({ type: "bump", name: "y", by: 5 });
    b.append({ type: "bump", name: "y", by: 2 });

    // A third, fresh handle derives state from the shared log. Both writers'
    // effects are present — neither was lost.
    const derived = handle().state();
    expect(derived).toEqual({ x: 2, y: 7 });
  });

  it("derive-on-wake reconciliation from two handles into the same gap does NOT double-apply", () => {
    // Seed a gap: some history already in the log.
    handle().append({ type: "bump", name: "seen", by: 3 });

    // Two sessions wake into the SAME gap and each run reconciliation, recording
    // a "caught up to checkpoint c1" decision. Because the decision is an event
    // with a shared dedupeKey, the fold applies it exactly once.
    const wake1 = handle();
    const wake2 = handle();
    wake1.append({ type: "bump", name: "reconciled", by: 10 }, { dedupeKey: "checkpoint:c1" });
    wake2.append({ type: "bump", name: "reconciled", by: 10 }, { dedupeKey: "checkpoint:c1" });

    // Both reconciliation events are physically in the log...
    const rawCount = new BackedLogStore<FoldEvent<Event>>(new FsStoreBackend(dir))
      .scan()
      .filter((r) => r.dedupeKey === "checkpoint:c1").length;
    expect(rawCount).toBe(2);

    // ...but the fold collapses the duplicate key to a single effect: reconciled
    // is 10, not 20. No double-apply.
    expect(handle().state()).toEqual({ seen: 3, reconciled: 10 });
  });

  it("pure derivation: state() writes nothing, so repeated reconciliation is stable", () => {
    handle().append({ type: "bump", name: "n", by: 1 }, { dedupeKey: "k" });
    const first = handle().state();
    // Re-deriving any number of times never mutates the log → identical result.
    expect(handle().state()).toEqual(first);
    expect(handle().state()).toEqual({ n: 1 });
  });

  it("compaction is named, not silently skipped: it throws until a cross-process lock exists", () => {
    expect(() => compact()).toThrow(/cross-process lock/);
  });
});
