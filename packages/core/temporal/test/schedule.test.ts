import { describe, it, expect } from "vitest";
import { shouldRun, defaultSchedulerState } from "../src/index.ts";

const HOUR = 60 * 60 * 1000;

describe("shouldRun", () => {
  const opts = { intervalHours: 168, minIdleHours: 2 };

  it("refuses when paused", () => {
    const s = { ...defaultSchedulerState(), paused: true, lastRunAt: 1 };
    expect(shouldRun(s, opts, 0, 1000).run).toBe(false);
    expect(shouldRun(s, opts, 0, 1000).reason).toBe("paused");
  });

  it("refuses on first run (lastRunAt 0)", () => {
    const s = defaultSchedulerState();
    expect(shouldRun(s, opts, 0, 1000).run).toBe(false);
  });

  it("refuses within the interval", () => {
    const now = 1_000_000_000_000;
    const s = { ...defaultSchedulerState(), lastRunAt: now - 10 * HOUR };
    expect(shouldRun(s, opts, now - 100 * HOUR, now).run).toBe(false);
  });

  it("refuses when not idle enough", () => {
    const now = 1_000_000_000_000;
    const s = { ...defaultSchedulerState(), lastRunAt: now - 200 * HOUR };
    expect(shouldRun(s, opts, now - 1 * HOUR, now).run).toBe(false);
  });

  it("runs when interval elapsed and idle long enough", () => {
    const now = 1_000_000_000_000;
    const s = { ...defaultSchedulerState(), lastRunAt: now - 200 * HOUR };
    expect(shouldRun(s, opts, now - 5 * HOUR, now).run).toBe(true);
  });

  describe("minIdleHours: 0 disables the idle gate", () => {
    const noIdle = { intervalHours: 168, minIdleHours: 0 };

    it("runs on interval-elapsed even with zero idle (active session)", () => {
      const now = 1_000_000_000_000;
      const s = { ...defaultSchedulerState(), lastRunAt: now - 200 * HOUR };
      // lastActivity === now → idleFor 0; the 2h-idle config would refuse here.
      expect(shouldRun(s, noIdle, now, now).run).toBe(true);
    });

    it("still refuses within the interval (the time-gate is intact)", () => {
      const now = 1_000_000_000_000;
      const s = { ...defaultSchedulerState(), lastRunAt: now - 10 * HOUR };
      expect(shouldRun(s, noIdle, now, now).run).toBe(false);
    });

    it("still refuses on first run (lastRunAt 0) — seeding is the host's job", () => {
      const s = defaultSchedulerState();
      expect(shouldRun(s, noIdle, 0, 1000).run).toBe(false);
    });
  });
});

describe("defaultSchedulerState", () => {
  it("starts never-run", () => {
    expect(defaultSchedulerState().lastRunAt).toBe(0);
    expect(defaultSchedulerState().paused).toBe(false);
    expect(defaultSchedulerState().runCount).toBe(0);
  });
});
