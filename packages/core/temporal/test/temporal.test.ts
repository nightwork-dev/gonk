import { describe, it, expect } from "vitest";
import {
  computeTemporal,
  loadLastActivity,
  recordActivity,
  decidePersistentPresence,
  type TemporalDurableState,
} from "../src/index.ts";
import type { KvStore } from "@gonk/store/types";

// ---------------------------------------------------------------------------
// Minimal in-memory KvStore stub — no real filesystem, controlled time.
// ---------------------------------------------------------------------------

function makeKv(): KvStore<TemporalDurableState> {
  const store = new Map<string, TemporalDurableState>();
  return {
    get: (key) => store.get(key),
    set: (key, value) => { store.set(key, value); },
    patch: (key, partial) => {
      const existing = store.get(key) ?? ({} as TemporalDurableState);
      store.set(key, { ...existing, ...partial });
    },
    delete: (key) => { store.delete(key); },
    list: (prefix) => [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).sort(),
    entries: (prefix) =>
      [...store.entries()]
        .filter(([k]) => !prefix || k.startsWith(prefix))
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => a.key.localeCompare(b.key)),
  };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const BASE_NOW = 1_750_000_000_000;
const SESSION_START = BASE_NOW - 30 * MINUTE;

describe("computeTemporal", () => {
  it("computes sessionElapsedMs correctly", () => {
    const r = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 3,
      lastActivityMs: BASE_NOW - 5 * MINUTE,
    });
    expect(r.sessionElapsedMs).toBe(30 * MINUTE);
  });

  it("computes idleMs as now − lastActivityMs", () => {
    const r = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 1,
      lastActivityMs: BASE_NOW - 10 * MINUTE,
    });
    expect(r.idleMs).toBe(10 * MINUTE);
  });

  it("returns idleMs 0 when lastActivityMs is 0 (never recorded)", () => {
    const r = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 0,
      lastActivityMs: 0,
    });
    expect(r.idleMs).toBe(0);
    expect(r.lastActivityMs).toBe(0);
  });

  it("passes through all fields", () => {
    const r = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 7,
      lastActivityMs: BASE_NOW - 2 * HOUR,
    });
    expect(r.wallClockNow).toBe(BASE_NOW);
    expect(r.sessionStartMs).toBe(SESSION_START);
    expect(r.turnIndex).toBe(7);
  });
});

describe("loadLastActivity / recordActivity", () => {
  it("returns 0 before any write", () => {
    const kv = makeKv();
    expect(loadLastActivity(kv)).toBe(0);
  });

  it("returns the written timestamp after recordActivity", () => {
    const kv = makeKv();
    recordActivity(kv, BASE_NOW);
    expect(loadLastActivity(kv)).toBe(BASE_NOW);
  });

  it("updates on successive calls", () => {
    const kv = makeKv();
    recordActivity(kv, BASE_NOW - HOUR);
    recordActivity(kv, BASE_NOW);
    expect(loadLastActivity(kv)).toBe(BASE_NOW);
  });
});

// ---------------------------------------------------------------------------
// Policy tests — the load-bearing assertions.
// The surface feeds a real decision; we verify the outcome, not just getters.
// ---------------------------------------------------------------------------

describe("decidePersistentPresence — policy over temporal surface", () => {
  const opts = {
    minIdleMs: 5 * MINUTE,
    maxContextFraction: 0.8,
    contextFraction: 0.3,
  };

  it("defers on turn 0 regardless of idle / context", () => {
    const kv = makeKv();
    recordActivity(kv, BASE_NOW - 30 * MINUTE);

    const reading = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 0,
      lastActivityMs: loadLastActivity(kv),
    });
    const d = decidePersistentPresence(reading, opts);
    expect(d.outcome).toBe("defer");
    expect(d.reason).toMatch(/first turn/);
  });

  it("defers when context budget is exhausted (>= maxContextFraction)", () => {
    const kv = makeKv();
    recordActivity(kv, BASE_NOW - 30 * MINUTE);

    const reading = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 5,
      lastActivityMs: loadLastActivity(kv),
    });
    const d = decidePersistentPresence(reading, {
      ...opts,
      maxContextFraction: 0.8,
      contextFraction: 0.85, // over budget
    });
    expect(d.outcome).toBe("defer");
    expect(d.reason).toMatch(/context at/);
  });

  it("defers when idle < minIdleMs (active session, high context)", () => {
    const kv = makeKv();
    // Activity 1 minute ago — not idle enough for the 5-minute gate.
    recordActivity(kv, BASE_NOW - MINUTE);

    const reading = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 3,
      lastActivityMs: loadLastActivity(kv),
    });
    const d = decidePersistentPresence(reading, opts);
    expect(d.outcome).toBe("defer");
    expect(d.reason).toMatch(/not idle enough/);
  });

  it("wakes when idle >= minIdleMs and context is within budget", () => {
    const kv = makeKv();
    // Activity 10 minutes ago — well past the 5-minute gate.
    recordActivity(kv, BASE_NOW - 10 * MINUTE);

    const reading = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 4,
      lastActivityMs: loadLastActivity(kv),
    });
    const d = decidePersistentPresence(reading, opts);
    expect(d.outcome).toBe("wake");
    expect(d.reason).toMatch(/eligible/);
  });

  it("wakes with minIdleMs 0 even when session is fully active (no idle gate)", () => {
    const kv = makeKv();
    recordActivity(kv, BASE_NOW); // activity right now

    const reading = computeTemporal({
      now: BASE_NOW,
      sessionStartMs: SESSION_START,
      turnIndex: 2,
      lastActivityMs: loadLastActivity(kv),
    });
    const d = decidePersistentPresence(reading, {
      minIdleMs: 0,
      maxContextFraction: 0,
      contextFraction: 0,
    });
    expect(d.outcome).toBe("wake");
  });
});
