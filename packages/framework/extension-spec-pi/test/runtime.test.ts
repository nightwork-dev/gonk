import { describe, expect, it, vi } from "vitest";
import { ownerPrincipal } from "@gonk/auth";
import type { ExtensionSpec, SettingsItem } from "@gonk/extension-spec";
import { MemoryScopeStore } from "@gonk/scope/memory";

import { defaultEditFlow, registerSpecExtension, type PiSubcommandContext } from "../src/runtime.ts";

const keyedBy = { source: "source.k", mapKey: "x.value-by-source" };

function context(
  scope: MemoryScopeStore,
  ui: PiSubcommandContext["host"]["piCtx"]["ui"],
) {
  const notifications: Array<{ message: string; level: string | undefined }> = [];
  return {
    notifications,
    ctx: {
      scope,
      hasUI: true,
      notify: (message, level) => notifications.push({ message, level }),
      host: { pi: {} as never, piCtx: { hasUI: true, ui } },
    } as PiSubcommandContext,
  };
}

function edit(item: SettingsItem, tier = "global") {
  return { kind: "edit" as const, item, tier: tier as "global" };
}

describe("defaultEditFlow", () => {
  it.each([
    ["text", { kind: "text" }, { editor: vi.fn(async () => "v1") }],
    ["string", { kind: "string" }, { input: vi.fn(async () => "v1") }],
    ["number", { kind: "number", min: 1, max: 5 }, { input: vi.fn(async () => "3") }],
  ] as const)("writes keyed %s settings through their keyed map", async (_name, type, ui) => {
    const scope = new MemoryScopeStore();
    scope.set("source.k", "alpha", "global");
    const item: SettingsItem = { key: "x.value", label: "Value", type, keyedBy };
    const { ctx } = context(scope, { notify: vi.fn(), ...ui });

    await defaultEditFlow(edit(item), ctx);

    expect(scope.get("x.value")).toBeUndefined();
    expect(scope.get("x.value-by-source")).toEqual({ alpha: type.kind === "number" ? 3 : "v1" });
  });

  it("writes keyed custom-picker values through their keyed map", async () => {
    const scope = new MemoryScopeStore();
    scope.set("source.k", "alpha", "global");
    const item: SettingsItem = {
      key: "x.value",
      label: "Value",
      type: { kind: "custom", pick: () => ({ selected: true }) },
      keyedBy,
    };
    const { ctx } = context(scope, { notify: vi.fn() });

    await defaultEditFlow(edit(item), ctx);

    expect(scope.get("x.value-by-source")).toEqual({ alpha: { selected: true } });
  });

  it("clears only the selected keyed entry and validates numeric bounds", async () => {
    const scope = new MemoryScopeStore();
    scope.set("source.k", "alpha", "global");
    scope.set("x.value-by-source", { alpha: 2, beta: 4 }, "global");
    const item: SettingsItem = {
      key: "x.value",
      label: "Value",
      type: { kind: "number", min: 1, max: 5 },
      keyedBy,
    };
    const { ctx, notifications } = context(scope, { notify: vi.fn(), input: vi.fn(async () => "") });

    await defaultEditFlow(edit(item), ctx);
    expect(scope.get("x.value-by-source")).toEqual({ beta: 4 });

    ctx.host.piCtx.ui.input = vi.fn(async () => "8");
    await defaultEditFlow(edit(item), ctx);
    expect(scope.get("x.value-by-source")).toEqual({ beta: 4 });
    expect(notifications.at(-1)?.message).toMatch(/Above maximum/);
  });

  it("leaves keyed values unchanged when an editor is cancelled", async () => {
    const scope = new MemoryScopeStore();
    scope.set("source.k", "alpha", "global");
    scope.set("x.value-by-source", { alpha: "kept" }, "global");
    const item: SettingsItem = { key: "x.value", label: "Value", type: { kind: "string" }, keyedBy };
    const { ctx, notifications } = context(scope, { notify: vi.fn(), input: vi.fn(async () => undefined) });

    await defaultEditFlow(edit(item), ctx);

    expect(scope.get("x.value-by-source")).toEqual({ alpha: "kept" });
    expect(notifications).toEqual([]);
  });
});

describe("registerSpecExtension lifecycle mapping", () => {
  it("registers portable session_end on Pi session_shutdown", () => {
    const on = vi.fn();
    const spec: ExtensionSpec = { id: "shutdown-test", description: "shutdown", hooks: { session_end: () => {} } };

    registerSpecExtension({
      pi: { on, registerTool: vi.fn(), registerCommand: vi.fn() },
      scope: new MemoryScopeStore(),
      auth: ownerPrincipal({ USER: "extension-spec-pi-runtime-test" }),
      security: { approvalMode: "bypass" },
      spec,
    });

    expect(on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  it("registers portable tool_complete on Pi tool_execution_end", () => {
    const on = vi.fn();
    const spec: ExtensionSpec = { id: "tool-test", description: "tool", hooks: { tool_complete: () => {} } };

    registerSpecExtension({
      pi: { on, registerTool: vi.fn(), registerCommand: vi.fn() },
      scope: new MemoryScopeStore(),
      auth: ownerPrincipal({ USER: "extension-spec-pi-runtime-test" }),
      security: { approvalMode: "bypass" },
      spec,
    });

    expect(on).toHaveBeenCalledWith("tool_execution_end", expect.any(Function));
  });
});
