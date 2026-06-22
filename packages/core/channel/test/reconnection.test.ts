import { describe, expect, it } from "vitest";
import { ReconnectionManager } from "../src/base.ts";
import type { ReconnectionDeps } from "../src/base.ts";

// A deterministic timer queue: setTimer enqueues; flush() runs the next pending
// callback. No real timers, no Math.random, no Date.now.
function makeHarness(initialNow = 0) {
  let now = initialNow;
  const queue: Array<{ fn: () => void; handle: number }> = [];
  let nextHandle = 1;
  const deps: ReconnectionDeps = {
    now: () => now,
    random: () => 0, // jitter contributes 0 → delays are exactly deterministic
    setTimer: (fn) => {
      const handle = nextHandle++;
      queue.push({ fn, handle });
      return handle;
    },
    clearTimer: (h) => {
      const idx = queue.findIndex((e) => e.handle === h);
      if (idx >= 0) queue.splice(idx, 1);
    },
  };
  return {
    deps,
    advance: (ms: number) => {
      now += ms;
    },
    pending: () => queue.length,
    flush: () => {
      const e = queue.shift();
      if (e) e.fn();
    },
  };
}

describe("ReconnectionManager backoff schedule", () => {
  it("computes exponential delays capped at maxDelayMs (jitter=0)", () => {
    const h = makeHarness();
    const m = new ReconnectionManager(
      { initialDelayMs: 1000, multiplier: 2, maxDelayMs: 30_000, jitter: 0.25 },
      h.deps,
    );
    // attempt 0 → 1000, 1 → 2000, 2 → 4000, ... capped at 30000.
    const expected = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    const got: number[] = [];
    for (let i = 0; i < expected.length; i++) {
      got.push(m.nextDelay());
      m.onFailure();
    }
    expect(got).toEqual(expected);
  });

  it("opens the circuit after maxRetries consecutive failures", () => {
    const h = makeHarness();
    const m = new ReconnectionManager({ maxRetries: 3 }, h.deps);
    expect(m.getState().circuit).toBe("closed");
    m.onFailure();
    m.onFailure();
    expect(m.getState().circuit).toBe("closed");
    m.onFailure(); // 3rd failure hits maxRetries
    expect(m.getState().circuit).toBe("open");
    expect(m.getState().attempt).toBe(3);
  });

  it("refuses to schedule while the circuit is open, then half-opens after reset", () => {
    const h = makeHarness(1000);
    const m = new ReconnectionManager({ maxRetries: 1, circuitResetMs: 5000 }, h.deps);
    m.onFailure(); // opens circuit (attempt 1 >= maxRetries 1)
    expect(m.getState().circuit).toBe("open");

    // Circuit still open → schedule refused.
    expect(m.scheduleReconnect(async () => {})).toBe(false);

    // Not enough time elapsed.
    h.advance(4999);
    expect(m.scheduleReconnect(async () => {})).toBe(false);

    // Past the reset window → transitions to half-open and schedules.
    h.advance(2);
    expect(m.scheduleReconnect(async () => {})).toBe(true);
    expect(m.getState().circuit).toBe("half-open");
    expect(m.getState().pending).toBe(true);
  });

  it("a successful reconnect resets attempt and closes the circuit", async () => {
    const h = makeHarness();
    const m = new ReconnectionManager({ initialDelayMs: 100 }, h.deps);
    m.onFailure();
    m.onFailure();
    expect(m.getState().attempt).toBe(2);

    let called = 0;
    const ok = m.scheduleReconnect(async () => {
      called++;
    });
    expect(ok).toBe(true);
    expect(h.pending()).toBe(1);

    h.flush(); // run the scheduled callback (await inside resolves on microtask)
    await Promise.resolve();
    await Promise.resolve();

    expect(called).toBe(1);
    expect(m.getState().attempt).toBe(0);
    expect(m.getState().circuit).toBe("closed");
    expect(m.getState().pending).toBe(false);
  });

  it("does not double-schedule while a timer is already pending", () => {
    const h = makeHarness();
    const m = new ReconnectionManager(undefined, h.deps);
    expect(m.scheduleReconnect(async () => {})).toBe(true);
    expect(m.scheduleReconnect(async () => {})).toBe(true); // already scheduled
    expect(h.pending()).toBe(1);
  });

  it("scheduleReconnect returns false when disabled", () => {
    const h = makeHarness();
    const m = new ReconnectionManager({ enabled: false }, h.deps);
    expect(m.scheduleReconnect(async () => {})).toBe(false);
    expect(h.pending()).toBe(0);
  });
});
