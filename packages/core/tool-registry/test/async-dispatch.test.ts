import { describe, expect, it, vi } from "vitest";
import { dispatchDetachedWithWait } from "../src/async-dispatch.ts";
import type { ToolResult } from "../src/types.ts";

const renderInline = (r: { text: string }, meta: { ranSyncFallback: boolean }): ToolResult => ({
  data: { text: r.text, ...(meta.ranSyncFallback ? { ranSyncFallback: true } : {}) },
  display: r.text,
});

describe("dispatchDetachedWithWait", () => {
  it("DEFAULT (async wired, no wait): dispatches detached, does NOT run inline", async () => {
    const asyncDispatch = vi.fn(() => ({ jobId: "j-1" }));
    const runInline = vi.fn(async () => ({ text: "inline" }));

    const res = await dispatchDetachedWithWait({
      input: {},
      kind: "subagent",
      asyncDispatch,
      runInline,
      renderInline,
    });

    expect(asyncDispatch).toHaveBeenCalledOnce();
    expect(runInline).not.toHaveBeenCalled(); // regression guard: default must NOT block
    expect(res.data).toMatchObject({ jobId: "j-1", kind: "subagent" });
    expect(String(res.display)).toContain("background job j-1");
  });

  it("wait:true opts into the inline path (async NOT called)", async () => {
    const asyncDispatch = vi.fn(() => ({ jobId: "j-2" }));
    const runInline = vi.fn(async () => ({ text: "the verdict" }));

    const res = await dispatchDetachedWithWait({
      input: { wait: true },
      kind: "consult",
      asyncDispatch,
      runInline,
      renderInline,
    });

    expect(asyncDispatch).not.toHaveBeenCalled();
    expect(runInline).toHaveBeenCalledOnce();
    expect(res.data).toEqual({ text: "the verdict" }); // no ranSyncFallback: caller chose it
  });

  it("sync:true behaves like wait:true", async () => {
    const asyncDispatch = vi.fn(() => ({ jobId: "j-3" }));
    const runInline = vi.fn(async () => ({ text: "sync result" }));

    await dispatchDetachedWithWait({
      input: { sync: true },
      kind: "subagent",
      asyncDispatch,
      runInline,
      renderInline,
    });

    expect(asyncDispatch).not.toHaveBeenCalled();
    expect(runInline).toHaveBeenCalledOnce();
  });

  it("no asyncDispatch wired: runs inline and flags ranSyncFallback", async () => {
    const runInline = vi.fn(async () => ({ text: "degraded" }));

    const res = await dispatchDetachedWithWait({
      input: {},
      kind: "autotune",
      runInline,
      renderInline,
    });

    expect(runInline).toHaveBeenCalledOnce();
    expect(res.data).toEqual({ text: "degraded", ranSyncFallback: true });
  });

  it("renderAsync lets the consumer own the async result shape (subagent's richer handle)", async () => {
    const res = await dispatchDetachedWithWait({
      input: {},
      kind: "subagent",
      asyncDispatch: () => ({ jobId: "j-4", workItemId: "wi-4", resultPath: "/tmp/r.jsonl", pid: 4242 }),
      runInline: async () => ({ text: "unused" }),
      renderInline,
      renderAsync: (d) => ({
        data: { mode: "async", workItemId: d.workItemId, jobId: d.jobId, resultPath: d.resultPath, pid: d.pid },
        display: `subagent launched as ${d.workItemId}`,
      }),
    });

    expect(res.data).toEqual({
      mode: "async",
      workItemId: "wi-4",
      jobId: "j-4",
      resultPath: "/tmp/r.jsonl",
      pid: 4242,
    });
  });

  it("a throwing asyncDispatch propagates (never swallowed)", async () => {
    await expect(
      dispatchDetachedWithWait({
        input: {},
        kind: "subagent",
        asyncDispatch: () => { throw new Error("spawn failed"); },
        runInline: async () => ({ text: "x" }),
        renderInline,
      }),
    ).rejects.toThrow("spawn failed");
  });
});
