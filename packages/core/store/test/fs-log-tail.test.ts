/** Real-disk tests for the cross-process log tail. A writer `append`s to its
 *  LogStore; a `tailLog` over the SAME dir (no shared in-memory state — the
 *  cross-process simulation) receives the records via fs.watch. No mocks. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BackedLogStore, FsStoreBackend, tailLog } from "../src/index.ts";
import type { LogTailRecord } from "../src/index.ts";

interface Rec {
  i: number;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "gonk-store-tail-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Wait for `predicate` to return true, polling fs.watch-style events on a
 *  short interval. Used so tests don't race the async watcher. */
async function waitFor(predicate: () => boolean, timeoutMs = 6000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("tailLog (cross-process log tail)", () => {
  it("delivers records appended AFTER the tail starts (default tail -f semantics)", async () => {
    const writer = new BackedLogStore<Rec>(new FsStoreBackend(dir));
    const received: LogTailRecord<Rec>[] = [];
    const tail = tailLog<Rec>({ dir, onRecord: (e) => received.push(e) });

    try {
      // append AFTER the tail is watching
      writer.append({ i: 1 });
      writer.append({ i: 2 });
      writer.append({ i: 3 });

      await waitFor(() => received.length === 3);

      expect(received.map((e) => e.record)).toEqual([
        { i: 1 },
        { i: 2 },
        { i: 3 },
      ]);
      // offsets strictly increase and are non-negative
      const offsets = received.map((e) => e.offset);
      expect(offsets).toEqual([...offsets].sort((a, b) => a - b));
      expect(offsets[0]).toBe(0);
    } finally {
      tail.close();
    }
  });

  it("is cross-process: a SEPARATE writer instance over the same dir is observed", async () => {
    // Two independent BackedLogStore instances share ONLY the on-disk file —
    // no shared in-memory state. This is the parent/worker topology.
    const worker = new BackedLogStore<Rec>(new FsStoreBackend(dir));
    const received: Rec[] = [];
    const tail = tailLog<Rec>({ dir, onRecord: (e) => received.push(e.record) });

    try {
      worker.append({ i: 10 });
      await waitFor(() => received.length === 1);
      expect(received).toEqual([{ i: 10 }]);
    } finally {
      tail.close();
    }
  });

  it("replays existing history when startOffset is 0", async () => {
    const writer = new BackedLogStore<Rec>(new FsStoreBackend(dir));
    writer.append({ i: 1 });
    writer.append({ i: 2 });

    const received: Rec[] = [];
    const tail = tailLog<Rec>({ dir, onRecord: (e) => received.push(e.record), startOffset: 0 });
    try {
      // existing records are delivered synchronously on start (initial scan)
      await waitFor(() => received.length === 2);
      expect(received).toEqual([{ i: 1 }, { i: 2 }]);
    } finally {
      tail.close();
    }
  });

  it("handles the log file not existing yet at tail start", async () => {
    // No appends yet → log.jsonl absent. Tail watches the parent dir; when the
    // first append creates the file, the record still delivers.
    const received: Rec[] = [];
    const tail = tailLog<Rec>({ dir, onRecord: (e) => received.push(e.record) });

    try {
      const writer = new BackedLogStore<Rec>(new FsStoreBackend(dir));
      writer.append({ i: 99 });
      await waitFor(() => received.length === 1);
      expect(received).toEqual([{ i: 99 }]);
    } finally {
      tail.close();
    }
  });

  it("close() stops delivery", async () => {
    const writer = new BackedLogStore<Rec>(new FsStoreBackend(dir));
    const received: Rec[] = [];
    const tail = tailLog<Rec>({ dir, onRecord: (e) => received.push(e.record) });

    tail.close();
    writer.append({ i: 1 });
    await new Promise((r) => setTimeout(r, 150));
    expect(received).toEqual([]);
  });
});
