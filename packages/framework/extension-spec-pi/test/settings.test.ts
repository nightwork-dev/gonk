import { describe, expect, it } from "vitest";
import { MemoryScopeStore } from "@gonk/scope/memory";
import type {
  SettingsItem,
  SettingsSpec,
  SubcommandContext,
} from "@gonk/extension-spec";

import {
  coerceSettingValue,
  cycleValue,
  findItem,
  isCyclable,
  readSettingValue,
  renderSettingsStatus,
  runSetSubcommand,
  writeSettingValue,
} from "../src/settings.ts";

const STR_ITEM: SettingsItem = {
  key: "foo.bind",
  label: "Bind",
  type: { kind: "string" },
  default: "\\",
};

const NUM_ITEM: SettingsItem = {
  key: "foo.delay",
  label: "Delay",
  type: { kind: "number", min: 0, max: 1000 },
  default: 150,
};

const ENUM_ITEM: SettingsItem = {
  key: "foo.viz",
  label: "Visualization",
  type: { kind: "enum", values: ["spectrograph", "level", "off"] },
  default: "spectrograph",
};

const BOOL_ITEM: SettingsItem = {
  key: "foo.streaming",
  label: "Streaming",
  type: { kind: "boolean" },
  default: true,
};

const SPEC: SettingsSpec = {
  scopeKeyPrefix: "foo",
  sections: [
    { label: "Foo", items: [STR_ITEM, NUM_ITEM, ENUM_ITEM, BOOL_ITEM] },
  ],
};

describe("coerceSettingValue", () => {
  it("string passes through", () => {
    expect(coerceSettingValue(STR_ITEM, "abc")).toBe("abc");
  });

  it("number parses floats", () => {
    expect(coerceSettingValue(NUM_ITEM, "150")).toBe(150);
    expect(coerceSettingValue(NUM_ITEM, "0.5")).toBe(0.5);
  });

  it("number rejects non-numeric", () => {
    expect(() => coerceSettingValue(NUM_ITEM, "abc")).toThrow(/Not a number/);
  });

  it("number enforces min/max bounds", () => {
    expect(() => coerceSettingValue(NUM_ITEM, "-1")).toThrow(/Below minimum/);
    expect(() => coerceSettingValue(NUM_ITEM, "1001")).toThrow(/Above maximum/);
  });

  it("boolean accepts true/false/1/0/yes/no", () => {
    expect(coerceSettingValue(BOOL_ITEM, "true")).toBe(true);
    expect(coerceSettingValue(BOOL_ITEM, "FALSE")).toBe(false);
    expect(coerceSettingValue(BOOL_ITEM, "1")).toBe(true);
    expect(coerceSettingValue(BOOL_ITEM, "no")).toBe(false);
  });

  it("boolean rejects other strings", () => {
    expect(() => coerceSettingValue(BOOL_ITEM, "maybe")).toThrow(/Not a boolean/);
  });

  it("enum accepts only declared values", () => {
    expect(coerceSettingValue(ENUM_ITEM, "level")).toBe("level");
    expect(() => coerceSettingValue(ENUM_ITEM, "rainbow")).toThrow(
      /Not one of/,
    );
  });
});

describe("findItem", () => {
  it("matches a fully-qualified key", () => {
    expect(findItem(SPEC, "foo.bind")).toBe(STR_ITEM);
  });

  it("matches a short key by auto-prefixing", () => {
    expect(findItem(SPEC, "bind")).toBe(STR_ITEM);
  });

  it("returns undefined for unknown key", () => {
    expect(findItem(SPEC, "ghost")).toBeUndefined();
  });
});

describe("readSettingValue / writeSettingValue", () => {
  it("plain read/write without keyedBy", () => {
    const s = new MemoryScopeStore();
    writeSettingValue(s, STR_ITEM, "x", "global");
    expect(readSettingValue(s, STR_ITEM)).toBe("x");
  });

  it("keyedBy round-trips through the map", () => {
    const s = new MemoryScopeStore();
    s.set("source.k", "alpha", "global");
    const item: SettingsItem = {
      key: "x.value",
      label: "Value",
      type: { kind: "string" },
      keyedBy: { source: "source.k", mapKey: "x.value-by-source" },
    };
    writeSettingValue(s, item, "v1", "global");
    expect(readSettingValue(s, item)).toBe("v1");
  });
});

describe("cycleValue / isCyclable", () => {
  it("isCyclable matches enum and boolean", () => {
    expect(isCyclable(ENUM_ITEM.type)).toBe(true);
    expect(isCyclable(BOOL_ITEM.type)).toBe(true);
    expect(isCyclable(STR_ITEM.type)).toBe(false);
    expect(isCyclable(NUM_ITEM.type)).toBe(false);
  });

  it("boolean cycles toggle current value", () => {
    expect(cycleValue(BOOL_ITEM.type, true, +1)).toBe(false);
    expect(cycleValue(BOOL_ITEM.type, false, -1)).toBe(true);
  });

  it("enum cycles forward and wraps", () => {
    expect(cycleValue(ENUM_ITEM.type, "spectrograph", +1)).toBe("level");
    expect(cycleValue(ENUM_ITEM.type, "off", +1)).toBe("spectrograph");
  });

  it("enum cycles backward", () => {
    expect(cycleValue(ENUM_ITEM.type, "spectrograph", -1)).toBe("off");
  });

  it("returns undefined for non-cyclable types", () => {
    expect(cycleValue(STR_ITEM.type, "x", +1)).toBeUndefined();
  });
});

describe("runSetSubcommand", () => {
  function makeCtx(scope: MemoryScopeStore) {
    const notifications: { message: string; level: string | undefined }[] = [];
    const ctx: SubcommandContext = {
      scope,
      hasUI: false,
      notify: (message, level) => notifications.push({ message, level }),
    };
    return { ctx, notifications };
  }

  it("set short-key value writes to default tier (session)", () => {
    const s = new MemoryScopeStore();
    const { ctx, notifications } = makeCtx(s);
    runSetSubcommand(
      { positional: ["bind", "\\"], raw: "bind \\" },
      ctx,
      SPEC,
    );
    expect(s.get("foo.bind")).toBe("\\");
    const chain = s.resolve("foo.bind");
    expect(chain[0]?.scope).toBe("session");
    expect(notifications[0]?.level).toBe("info");
  });

  it("set extracts trailing tier when present", () => {
    const s = new MemoryScopeStore();
    const { ctx } = makeCtx(s);
    runSetSubcommand(
      { positional: ["bind", "/", "global"], raw: "bind / global" },
      ctx,
      SPEC,
    );
    const chain = s.resolve("foo.bind");
    expect(chain[0]?.scope).toBe("global");
    expect(s.get("foo.bind")).toBe("/");
  });

  it("set with full key works", () => {
    const s = new MemoryScopeStore();
    const { ctx } = makeCtx(s);
    runSetSubcommand(
      { positional: ["foo.bind", "x"], raw: "foo.bind x" },
      ctx,
      SPEC,
    );
    expect(s.get("foo.bind")).toBe("x");
  });

  it("set unknown key errors with hint", () => {
    const s = new MemoryScopeStore();
    const { ctx, notifications } = makeCtx(s);
    runSetSubcommand(
      { positional: ["ghost", "x"], raw: "ghost x" },
      ctx,
      SPEC,
    );
    expect(notifications[0]?.level).toBe("error");
    expect(notifications[0]?.message).toMatch(/Unknown setting/);
  });

  it("set with no value errors with usage hint listing keys", () => {
    const s = new MemoryScopeStore();
    const { ctx, notifications } = makeCtx(s);
    runSetSubcommand({ positional: ["bind"], raw: "bind" }, ctx, SPEC);
    expect(notifications[0]?.level).toBe("error");
    expect(notifications[0]?.message).toMatch(/Usage:/);
  });

  it("set value=clear deletes the setting", () => {
    const s = new MemoryScopeStore();
    s.set("foo.bind", "x", "session");
    const { ctx } = makeCtx(s);
    runSetSubcommand(
      { positional: ["bind", "clear"], raw: "bind clear" },
      ctx,
      SPEC,
    );
    expect(s.get("foo.bind")).toBeUndefined();
  });

  it("set rejects bad coercion (number)", () => {
    const s = new MemoryScopeStore();
    const { ctx, notifications } = makeCtx(s);
    runSetSubcommand(
      { positional: ["delay", "abc"], raw: "delay abc" },
      ctx,
      SPEC,
    );
    expect(notifications[0]?.level).toBe("error");
    expect(notifications[0]?.message).toMatch(/Not a number/);
  });
});

describe("renderSettingsStatus", () => {
  it("includes every item's label", () => {
    const s = new MemoryScopeStore();
    s.set("foo.bind", "\\", "global");
    const out = renderSettingsStatus(s, SPEC);
    for (const item of SPEC.sections[0]!.items) {
      expect(out).toMatch(new RegExp(item.label));
    }
  });

  it("shows '(default: …)' for unset items", () => {
    const s = new MemoryScopeStore();
    const out = renderSettingsStatus(s, SPEC);
    expect(out).toMatch(/default:/);
  });
});
