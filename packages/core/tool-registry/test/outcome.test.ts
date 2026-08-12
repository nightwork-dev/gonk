import { describe, expect, it, vi } from "vitest";

import { collectToolOutcome } from "../src/outcome.ts";
import { projectToolResultReceipt } from "../src/receipt.ts";
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

  it("preserves result metadata and projects a redaction-safe receipt", async () => {
    await expect(
      collectToolOutcome(
        events({
          type: "result",
          data: { rows: [1] },
          metadata: {
            provenance: {
              sourceKind: "mcp",
              sourceId: "issues",
              sourceRevision: "rev-7",
              evidenceAnchors: [{ kind: "record", value: "issue:1" }],
            },
            freshness: { state: "fresh", observedAt: "2026-08-11T00:00:00Z" },
            cache: {
              policy: "stale-revalidate",
              key: "secret-cache-key",
              validator: "secret-validator",
              guidance: "revalidate within one hour",
            },
            size: { original: 100, returned: 42, unit: "bytes" },
            truncation: {
              truncated: true,
              limit: 42,
              unit: "bytes",
              reason: "host display limit",
              artifact: { id: "artifact-1", digest: "sha256:abc" },
            },
          },
        })
      )
    ).resolves.toMatchObject({
      ok: true,
      metadata: {
        cache: { key: "secret-cache-key" },
        truncation: { artifact: { id: "artifact-1" } },
      },
      receipt: {
        provenance: { sourceId: "issues" },
        cache: { policy: "stale-revalidate", guidance: "revalidate within one hour" },
        truncation: {
          truncated: true,
          reason: "host display limit",
          artifact: { id: "artifact-1", digest: "sha256:abc" },
        },
      },
    });

    const receipt = projectToolResultReceipt({
      cache: { policy: "reusable", key: "secret" },
      truncation: { truncated: true, continuation: { cursor: "secret" } },
    });
    expect(JSON.stringify(receipt)).not.toContain("secret");

    const continuationReceipt = projectToolResultReceipt({
      truncation: { truncated: true, continuation: { cursor: "secret" } },
    });
    expect(JSON.stringify(continuationReceipt)).not.toContain("secret");
  });
});
