import { describe, expect, it } from "vitest";
import { MemoryScopeStore } from "@gonk/scope/memory";

import {
  deleteKeyedSetting,
  readKeyedSetting,
  resolveKeyedIndex,
  writeKeyedSetting,
} from "../src/keyed-by.ts";

describe("readKeyedSetting", () => {
  it("returns plain scope.get when keyedBy is undefined", () => {
    const s = new MemoryScopeStore();
    s.set("foo", "bar", "global");
    expect(readKeyedSetting(s, "foo", undefined)).toBe("bar");
  });

  it("returns map[index] when keyedBy is set", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "alpha", "global");
    s.set(
      "voice.tts.voice-by-model",
      { alpha: "narrator", beta: "anchor" },
      "global",
    );
    const v = readKeyedSetting(s, "voice.tts.voice", {
      source: "voice.tts.model",
      mapKey: "voice.tts.voice-by-model",
    });
    expect(v).toBe("narrator");
  });

  it("returns undefined when keyedBy index has no entry in the map", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "gamma", "global");
    s.set(
      "voice.tts.voice-by-model",
      { alpha: "narrator" },
      "global",
    );
    const v = readKeyedSetting(s, "voice.tts.voice", {
      source: "voice.tts.model",
      mapKey: "voice.tts.voice-by-model",
    });
    expect(v).toBeUndefined();
  });

  it("returns undefined when the source resolves to undefined", () => {
    const s = new MemoryScopeStore();
    s.set(
      "voice.tts.voice-by-model",
      { alpha: "narrator" },
      "global",
    );
    const v = readKeyedSetting(s, "voice.tts.voice", {
      source: "voice.tts.model",
      mapKey: "voice.tts.voice-by-model",
    });
    expect(v).toBeUndefined();
  });

  it("supports a function as source", () => {
    const s = new MemoryScopeStore();
    s.set("a", "x", "global");
    s.set("b", "y", "global");
    s.set("xy-map", { xy: "combined!" }, "global");
    const v = readKeyedSetting(s, "ignored", {
      source: (sc) => `${sc.get<string>("a") ?? ""}${sc.get<string>("b") ?? ""}`,
      mapKey: "xy-map",
    });
    expect(v).toBe("combined!");
  });
});

describe("writeKeyedSetting", () => {
  it("plain scope.set when keyedBy is undefined", () => {
    const s = new MemoryScopeStore();
    writeKeyedSetting(s, "foo", "bar", "session", undefined);
    expect(s.get("foo")).toBe("bar");
  });

  it("merges new entry into the map under the resolved index", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "alpha", "global");
    s.set("voice.tts.voice-by-model", { beta: "anchor" }, "global");
    writeKeyedSetting(
      s,
      "voice.tts.voice",
      "narrator",
      "session",
      {
        source: "voice.tts.model",
        mapKey: "voice.tts.voice-by-model",
      },
    );
    expect(s.get("voice.tts.voice-by-model")).toEqual({
      beta: "anchor",
      alpha: "narrator",
    });
  });

  it("creates a new map when none exists", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "alpha", "global");
    writeKeyedSetting(
      s,
      "voice.tts.voice",
      "narrator",
      "session",
      {
        source: "voice.tts.model",
        mapKey: "voice.tts.voice-by-model",
      },
    );
    expect(s.get("voice.tts.voice-by-model")).toEqual({ alpha: "narrator" });
  });

  it("respects keyedBy.writeTier override", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "alpha", "global");
    writeKeyedSetting(
      s,
      "voice.tts.voice",
      "narrator",
      "session",
      {
        source: "voice.tts.model",
        mapKey: "voice.tts.voice-by-model",
        writeTier: "global",
      },
    );
    // Verify it landed at global, not session
    const chain = s.resolve("voice.tts.voice-by-model");
    expect(chain[0]?.scope).toBe("global");
  });

  it("throws when index source is undefined", () => {
    const s = new MemoryScopeStore();
    expect(() =>
      writeKeyedSetting(s, "voice.tts.voice", "narrator", "session", {
        source: "voice.tts.model",
        mapKey: "voice.tts.voice-by-model",
      }),
    ).toThrow(/index source resolved to undefined/);
  });
});

describe("deleteKeyedSetting", () => {
  it("plain scope.delete when keyedBy is undefined", () => {
    const s = new MemoryScopeStore();
    s.set("foo", "bar", "session");
    deleteKeyedSetting(s, "foo", "session", undefined);
    expect(s.get("foo")).toBeUndefined();
  });

  it("removes only the indexed entry, leaves siblings", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "alpha", "global");
    s.set(
      "voice.tts.voice-by-model",
      { alpha: "narrator", beta: "anchor" },
      "global",
    );
    deleteKeyedSetting(s, "voice.tts.voice", "global", {
      source: "voice.tts.model",
      mapKey: "voice.tts.voice-by-model",
    });
    expect(s.get("voice.tts.voice-by-model")).toEqual({ beta: "anchor" });
  });

  it("deletes the whole map when removal empties it", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "alpha", "global");
    s.set(
      "voice.tts.voice-by-model",
      { alpha: "narrator" },
      "global",
    );
    deleteKeyedSetting(s, "voice.tts.voice", "global", {
      source: "voice.tts.model",
      mapKey: "voice.tts.voice-by-model",
    });
    expect(s.get("voice.tts.voice-by-model")).toBeUndefined();
  });

  it("is a no-op when the index has no entry", () => {
    const s = new MemoryScopeStore();
    s.set("voice.tts.model", "gamma", "global");
    s.set(
      "voice.tts.voice-by-model",
      { alpha: "narrator" },
      "global",
    );
    deleteKeyedSetting(s, "voice.tts.voice", "global", {
      source: "voice.tts.model",
      mapKey: "voice.tts.voice-by-model",
    });
    // Map untouched
    expect(s.get("voice.tts.voice-by-model")).toEqual({ alpha: "narrator" });
  });
});

describe("resolveKeyedIndex", () => {
  it("reads from a string key", () => {
    const s = new MemoryScopeStore();
    s.set("a", "v", "global");
    expect(resolveKeyedIndex(s, "a")).toBe("v");
  });

  it("calls a function source with the scope", () => {
    const s = new MemoryScopeStore();
    expect(resolveKeyedIndex(s, () => "literal")).toBe("literal");
  });
});
