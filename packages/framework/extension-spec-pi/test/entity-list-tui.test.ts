import { describe, expect, it, vi } from "vitest";
import { EntityListTuiBase, type EntityListTuiOptions } from "../src/entity-list-tui.ts";

// ---------------------------------------------------------------------------
// Minimal concrete subclass for testing
// ---------------------------------------------------------------------------

type Item = { id: string };

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";

function makeKb() {
  return {
    matchesKey: (data: string, key: string): boolean => {
      if (key === "escape") return data === "\x1b";
      if (key === "enter") return data === "\r";
      if (key === "ctrl+c") return data === "\x03";
      if (key === "up") return data === "\x1b[A";
      if (key === "down") return data === "\x1b[B";
      if (key === "backspace") return data === "\x7f";
      return data === key;
    },
    parseKey: (data: string): string | undefined =>
      data.length === 1 && data >= " " && data <= "~" ? data : undefined,
  };
}

/** Minimal subclass: exposes mode internals and records renderMode calls.
 *
 *  Its `render` method follows the expected pattern: delegate to `renderMode`
 *  when a custom mode is active, otherwise render the list. This is the same
 *  pattern used by PersonaTuiComponent and SkillTuiComponent. */
class TestTui extends EntityListTuiBase<Item> {
  renderModeCalls: { mode: string; width: number; state: unknown }[] = [];
  handleModeInputCalls: { mode: string; data: string; state: unknown }[] = [];

  /** By default, handleModeInput returns false (fall-through). Tests can
   *  override this to return true for specific modes. */
  modeInputResult = false;

  constructor(overrides: Partial<EntityListTuiOptions<Item>> = {}) {
    super({
      getEntities: () => [{ id: "alpha" }, { id: "beta" }, { id: "gamma" }],
      kb: makeKb(),
      ...overrides,
    });
  }

  render(width: number): string[] {
    // Standard dispatch pattern: custom modes route to renderMode.
    if (this.currentMode() !== "list") {
      return this.renderMode(this.currentMode(), width, this._modeState);
    }
    return [`list:${this.filtered.length}:${width}`];
  }

  protected override handleModeInput(mode: string, data: string, state: unknown): boolean {
    this.handleModeInputCalls.push({ mode, data, state });
    return this.modeInputResult;
  }

  protected override renderMode(mode: string, width: number, state: unknown): string[] {
    this.renderModeCalls.push({ mode, width, state });
    return [`mode:${mode}:${width}`];
  }
}

// ---------------------------------------------------------------------------
// Tests: switchMode / currentMode
// ---------------------------------------------------------------------------

describe("EntityListTuiBase mode API — switchMode / currentMode", () => {
  it("currentMode() returns 'list' by default", () => {
    const tui = new TestTui();
    expect(tui.currentMode()).toBe("list");
  });

  it("switchMode updates currentMode()", () => {
    const tui = new TestTui();
    tui.switchMode("expanded");
    expect(tui.currentMode()).toBe("expanded");
  });

  it("switchMode stores the provided state in _modeState", () => {
    const tui = new TestTui();
    const state = { item: { id: "alpha" } };
    tui.switchMode("expanded", state);
    expect(tui["_modeState"]).toBe(state);
  });

  it("switchMode('list') resets to list mode", () => {
    const tui = new TestTui();
    tui.switchMode("expanded", { foo: 1 });
    tui.switchMode("list");
    expect(tui.currentMode()).toBe("list");
  });

  it("switchMode with no state leaves _modeState as undefined", () => {
    const tui = new TestTui();
    tui.switchMode("diff");
    expect(tui["_modeState"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Tests: render dispatch
// ---------------------------------------------------------------------------

describe("EntityListTuiBase mode API — render dispatch", () => {
  it("render calls renderMode when customMode != 'list'", () => {
    const tui = new TestTui();
    const state = { item: { id: "beta" } };
    tui.switchMode("expanded", state);

    const lines = tui.render(100);
    expect(lines).toEqual(["mode:expanded:100"]);
    expect(tui.renderModeCalls).toHaveLength(1);
    expect(tui.renderModeCalls[0]).toEqual({ mode: "expanded", width: 100, state });
  });

  it("render does NOT call renderMode when in list mode", () => {
    const tui = new TestTui();
    tui.render(80);
    expect(tui.renderModeCalls).toHaveLength(0);
  });

  it("render passes _modeState to renderMode on each call", () => {
    const tui = new TestTui();
    const state = { x: 42 };
    tui.switchMode("detail", state);
    tui.render(50);
    tui.render(60);
    expect(tui.renderModeCalls).toHaveLength(2);
    expect(tui.renderModeCalls[1]).toMatchObject({ mode: "detail", width: 60, state });
  });
});

// ---------------------------------------------------------------------------
// Tests: handleInput dispatch
// ---------------------------------------------------------------------------

describe("EntityListTuiBase mode API — handleInput dispatch", () => {
  it("handleInput routes to handleModeInput when customMode != 'list'", () => {
    const tui = new TestTui();
    tui.switchMode("expanded", { foo: "bar" });

    tui.handleInput("x");
    expect(tui.handleModeInputCalls).toHaveLength(1);
    expect(tui.handleModeInputCalls[0]).toMatchObject({
      mode: "expanded",
      data: "x",
      state: { foo: "bar" },
    });
  });

  it("handleInput does NOT call handleModeInput when in list mode", () => {
    const tui = new TestTui();
    tui.handleInput(DOWN);
    expect(tui.handleModeInputCalls).toHaveLength(0);
  });

  it("handleInput falls through to list handling when handleModeInput returns false", () => {
    const onClose = vi.fn();
    const tui = new TestTui({ onClose });
    tui.modeInputResult = false;
    tui.switchMode("expanded");

    // Esc not claimed by handleModeInput → falls through to base list handler → onClose
    tui.handleInput(ESC);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("handleInput stops at handleModeInput when it returns true", () => {
    const onClose = vi.fn();
    const tui = new TestTui({ onClose });
    tui.modeInputResult = true;
    tui.switchMode("expanded");

    tui.handleInput(ESC);
    // handleModeInput claimed it → onClose should NOT be called
    expect(onClose).not.toHaveBeenCalled();
  });

  it("handleInput in list mode still processes navigation keys normally", () => {
    const tui = new TestTui();
    expect(tui["selectedIdx"]).toBe(0);
    tui.handleInput(DOWN);
    expect(tui["selectedIdx"]).toBe(1);
  });

  it("handleInput routes input while Enter is pressed in expanded mode", () => {
    const tui = new TestTui();
    tui.modeInputResult = false; // fall through
    tui.switchMode("expanded");

    const onSelect = vi.fn();
    // re-create with onSelect to test fall-through select path
    const tui2 = new TestTui({ onSelect });
    tui2.modeInputResult = false;
    tui2.switchMode("expanded");
    tui2.handleInput(ENTER);
    // Fell through to list mode → onSelect called on first item
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "alpha" }));
  });
});

// ---------------------------------------------------------------------------
// Tests: renderMode default throws
// ---------------------------------------------------------------------------

describe("EntityListTuiBase renderMode default", () => {
  class MinimalTui extends EntityListTuiBase<Item> {
    render(width: number): string[] {
      // Subclass that forwards to renderMode dispatch (the expected pattern
      // when a subclass calls switchMode but forgets to override renderMode).
      if (this.currentMode() !== "list") {
        return this.renderMode(this.currentMode(), width, this._modeState);
      }
      return [];
    }
    // Does NOT override renderMode — base default should throw
  }

  it("default renderMode throws when a subclass delegates to it for an unknown mode", () => {
    const tui = new MinimalTui({ getEntities: () => [], kb: makeKb() });
    tui.switchMode("unknown");
    expect(() => tui.render(80)).toThrow(/subclass must override renderMode/);
  });
});
