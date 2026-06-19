import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import { ToolRegistry, type ToolDefinition, type ToolEvent } from "@gonk/tool-registry";

import {
  registerGonkTools,
  type PiExtensionAPI,
  type PiToolSpec,
  type PiToolUpdate,
} from "../src/index.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

class FakePi implements PiExtensionAPI {
  registered: PiToolSpec[] = [];
  registerTool(spec: PiToolSpec): void {
    this.registered.push(spec);
  }
}

describe("toPiToolSpec — ctx.notify", () => {
  it("forwards progress events from a Promise-form handler via ctx.notify to onUpdate", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "stepper",
      description: "emits progress",
      input: passthrough(),
      handler: async (_input: unknown, ctx) => {
        ctx.notify?.({ type: "progress", message: "stage 1" });
        ctx.notify?.({ type: "progress", message: "stage 2", percent: 50 });
        ctx.notify?.({ type: "progress", message: "stage 3" });
        return { data: "done" };
      },
    } as ToolDefinition);

    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const spec = pi.registered[0]!;

    const updates: PiToolUpdate[] = [];
    const signal = new AbortController().signal;
    const result = await spec.execute("call-1", {}, signal, (u) => updates.push(u), {});

    expect(updates).toHaveLength(3);
    expect(updates[0]).toEqual({
      content: [{ type: "text", text: "stage 1" }],
      details: { progress: true, message: "stage 1" },
    });
    expect(updates[1]).toEqual({
      content: [{ type: "text", text: "stage 2" }],
      details: { progress: true, message: "stage 2", percent: 50 },
    });
    expect(updates[2]).toEqual({
      content: [{ type: "text", text: "stage 3" }],
      details: { progress: true, message: "stage 3" },
    });
    expect(result.details).toBe("done");
  });

  it("forwards progress events yielded by an async-iterable handler", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "iter-stepper",
      description: "yields progress",
      input: passthrough(),
      handler: async function* (_input: unknown): AsyncGenerator<ToolEvent> {
        yield { type: "progress", message: "first" };
        yield { type: "progress", message: "second", percent: 75 };
        yield { type: "result", data: "iter-done" };
      },
    } as ToolDefinition);

    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const spec = pi.registered[0]!;

    const updates: PiToolUpdate[] = [];
    const signal = new AbortController().signal;
    const result = await spec.execute("call-2", {}, signal, (u) => updates.push(u), {});

    expect(updates).toHaveLength(2);
    expect(updates[0]).toEqual({
      content: [{ type: "text", text: "first" }],
      details: { progress: true, message: "first" },
    });
    expect(updates[1]).toEqual({
      content: [{ type: "text", text: "second" }],
      details: { progress: true, message: "second", percent: 75 },
    });
    expect(result.details).toBe("iter-done");
  });

  it("does not throw when no onUpdate is provided and handler calls ctx.notify", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "no-update-stepper",
      description: "emits progress with no listener",
      input: passthrough(),
      handler: async (_input: unknown, ctx) => {
        ctx.notify?.({ type: "progress", message: "fire and forget" });
        return { data: "ok" };
      },
    } as ToolDefinition);

    const pi = new FakePi();
    registerGonkTools({ pi, source: r });
    const spec = pi.registered[0]!;

    const signal = new AbortController().signal;
    const result = await spec.execute("call-3", {}, signal, undefined, {});
    expect(result.details).toBe("ok");
  });
});
