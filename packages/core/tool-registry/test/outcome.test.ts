import { describe, expect, it, vi } from "vitest";

import { collectToolOutcome } from "../src/outcome.ts";
import type { ToolEvent } from "../src/types.ts";

async function* events(...items: ToolEvent[]): AsyncIterable<ToolEvent> {
  yield* items;
}

describe("collectToolOutcome", () => {
  it("returns the last result after consuming the full stream", async () => {
    await expect(
      collectToolOutcome(
        events(
          { type: "result", data: { partial: true } },
          { type: "progress", percent: 100 },
          { type: "result", data: { final: true }, display: "done" }
        )
      )
    ).resolves.toEqual({
      ok: true,
      data: { final: true },
      display: "done",
    });
  });

  it("treats an error as failure even after a partial result", async () => {
    await expect(
      collectToolOutcome(
        events(
          { type: "result", data: { partial: true } },
          {
            type: "error",
            code: "BROKEN",
            message: "failed",
            details: { at: 2 },
          }
        )
      )
    ).resolves.toEqual({
      ok: false,
      code: "BROKEN",
      message: "failed",
      details: { at: 2 },
    });
  });

  it("reports an explicit failure when no result is produced", async () => {
    await expect(
      collectToolOutcome(events({ type: "progress", message: "working" }))
    ).resolves.toEqual({
      ok: false,
      code: "NO_RESULT",
      message: "Tool produced no result",
    });
  });

  it("forwards every consumed event to the observer", async () => {
    const onEvent = vi.fn();
    await collectToolOutcome(
      events(
        { type: "progress", message: "one" },
        { type: "data", chunk: 2 },
        { type: "result", data: 3 }
      ),
      { onEvent }
    );
    expect(onEvent.mock.calls.map(([event]) => event.type)).toEqual([
      "progress",
      "data",
      "result",
    ]);
  });
});
