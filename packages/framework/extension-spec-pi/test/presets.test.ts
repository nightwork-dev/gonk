import { describe, expect, it, vi } from "vitest";
import { MemoryScopeStore } from "@gonk/scope/memory";
import type { PresetsSpec, SubcommandContext } from "@gonk/extension-spec";

import {
  applyPreset,
  deletePreset,
  readPresetCatalog,
  runPresetSubcommand,
  savePreset,
  snapshotPreset,
} from "../src/presets.ts";

const FIELDS = [
  { scopeKey: "foo.model", field: "model" },
  { scopeKey: "foo.voice", field: "voice" },
  { scopeKey: "foo.format", field: "format" },
];

const SPEC: PresetsSpec = {
  scopeKey: "foo.presets",
  fields: FIELDS,
  saveTier: "global",
  applyTier: "session",
};

function makeCtx(scope: MemoryScopeStore): SubcommandContext & {
  notifications: { message: string; level: string | undefined }[];
} {
  const notifications: { message: string; level: string | undefined }[] = [];
  return {
    scope,
    hasUI: false,
    notify: (message, level) => notifications.push({ message, level }),
    notifications,
  };
}

describe("snapshotPreset", () => {
  it("captures only set fields, omits unset", () => {
    const s = new MemoryScopeStore();
    s.set("foo.model", "m1", "global");
    s.set("foo.voice", "v1", "global");
    // foo.format unset
    const snap = snapshotPreset(s, FIELDS);
    expect(snap).toEqual({ model: "m1", voice: "v1" });
  });
});

describe("applyPreset", () => {
  it("writes preset fields to scope at the given tier", () => {
    const s = new MemoryScopeStore();
    applyPreset(s, { model: "m1", voice: "v1" }, FIELDS, "session");
    expect(s.get("foo.model")).toBe("m1");
    expect(s.get("foo.voice")).toBe("v1");
  });

  it("clears fields the preset doesn't include (full-replace)", () => {
    const s = new MemoryScopeStore();
    s.set("foo.format", "mp3", "session");
    applyPreset(s, { model: "m1" }, FIELDS, "session");
    expect(s.get("foo.format")).toBeUndefined();
  });
});

describe("savePreset / deletePreset / readPresetCatalog", () => {
  it("save persists to scope at saveTier", () => {
    const s = new MemoryScopeStore();
    savePreset(s, SPEC, "fast", { model: "m1" });
    const cat = readPresetCatalog(s, SPEC);
    expect(cat).toEqual({ fast: { model: "m1" } });
    const chain = s.resolve("foo.presets");
    expect(chain[0]?.scope).toBe("global");
  });

  it("save replaces existing preset under the same name", () => {
    const s = new MemoryScopeStore();
    savePreset(s, SPEC, "p", { model: "old" });
    savePreset(s, SPEC, "p", { model: "new" });
    expect(readPresetCatalog(s, SPEC).p).toEqual({ model: "new" });
  });

  it("delete removes a single preset, leaves others", () => {
    const s = new MemoryScopeStore();
    savePreset(s, SPEC, "a", { model: "ma" });
    savePreset(s, SPEC, "b", { model: "mb" });
    deletePreset(s, SPEC, "a");
    expect(readPresetCatalog(s, SPEC)).toEqual({ b: { model: "mb" } });
  });

  it("delete is a no-op for missing names", () => {
    const s = new MemoryScopeStore();
    savePreset(s, SPEC, "a", { model: "ma" });
    deletePreset(s, SPEC, "missing");
    expect(readPresetCatalog(s, SPEC)).toEqual({ a: { model: "ma" } });
  });
});

describe("runPresetSubcommand", () => {
  it("list shows saved presets", async () => {
    const s = new MemoryScopeStore();
    savePreset(s, SPEC, "a", {});
    savePreset(s, SPEC, "b", {});
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["list"] }, ctx, SPEC);
    expect(ctx.notifications[0]?.message).toMatch(/a/);
    expect(ctx.notifications[0]?.message).toMatch(/b/);
  });

  it("list with no presets says so", async () => {
    const s = new MemoryScopeStore();
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["list"] }, ctx, SPEC);
    expect(ctx.notifications[0]?.message).toMatch(/No presets/);
  });

  it("save snapshots current scope", async () => {
    const s = new MemoryScopeStore();
    s.set("foo.model", "m1", "global");
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["save", "fast"] }, ctx, SPEC);
    expect(readPresetCatalog(s, SPEC).fast).toEqual({ model: "m1" });
  });

  it("save with no name errors", async () => {
    const s = new MemoryScopeStore();
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["save"] }, ctx, SPEC);
    expect(ctx.notifications[0]?.level).toBe("error");
  });

  it("apply sets scope from preset", async () => {
    const s = new MemoryScopeStore();
    savePreset(s, SPEC, "fast", { model: "m1", voice: "v1" });
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["apply", "fast"] }, ctx, SPEC);
    expect(s.get("foo.model")).toBe("m1");
    expect(s.get("foo.voice")).toBe("v1");
  });

  it("apply unknown preset errors", async () => {
    const s = new MemoryScopeStore();
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["apply", "ghost"] }, ctx, SPEC);
    expect(ctx.notifications[0]?.level).toBe("error");
    expect(ctx.notifications[0]?.message).toMatch(/not found/i);
  });

  it("delete removes a saved preset", async () => {
    const s = new MemoryScopeStore();
    savePreset(s, SPEC, "fast", {});
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["delete", "fast"] }, ctx, SPEC);
    expect(readPresetCatalog(s, SPEC).fast).toBeUndefined();
  });

  it("default action when no arg behaves like list", async () => {
    const s = new MemoryScopeStore();
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: [] }, ctx, SPEC);
    expect(ctx.notifications[0]?.message).toMatch(/No presets/);
  });

  it("unknown action errors with hint", async () => {
    const s = new MemoryScopeStore();
    const ctx = makeCtx(s);
    await runPresetSubcommand({ positional: ["frobnicate"] }, ctx, SPEC);
    expect(ctx.notifications[0]?.level).toBe("error");
    expect(ctx.notifications[0]?.message).toMatch(/list, save/);
  });
});

// Quick sanity check: vi import is used (avoids unused-import error if removed)
describe("vi", () => {
  it("is loaded", () => {
    expect(vi).toBeDefined();
  });
});
