import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import { StandardRootAdapter } from "../src/index.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gonk-std-adapter-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function adapter(): StandardRootAdapter {
  return new StandardRootAdapter(".agents", tmp);
}

describe("StandardRootAdapter — settings", () => {
  it("writes a key to settings/<ext>.yaml using the first dotted segment as ext", () => {
    const a = adapter();
    a.writeSetting("voice.tts.provider", "openai");

    const path = join(tmp, "settings", "voice.yaml");
    expect(existsSync(path)).toBe(true);
    const parsed = parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(parsed).toEqual({ tts: { provider: "openai" } });
  });

  it("roundtrips scalar via read/write/delete", () => {
    const a = adapter();
    expect(a.readSetting("voice.tts.provider")).toBeUndefined();
    a.writeSetting("voice.tts.provider", "openai");
    expect(a.readSetting("voice.tts.provider")).toBe("openai");
    a.deleteSetting("voice.tts.provider");
    expect(a.readSetting("voice.tts.provider")).toBeUndefined();
  });

  it("stores hierarchically — different keys in the same ext share one file", () => {
    const a = adapter();
    a.writeSetting("voice.tts.provider", "openai");
    a.writeSetting("voice.stt.provider", "whisper");

    const parsed = parse(readFileSync(join(tmp, "settings", "voice.yaml"), "utf8"));
    expect(parsed).toEqual({
      tts: { provider: "openai" },
      stt: { provider: "whisper" },
    });
  });

  it("supports Record values stored as nested objects", () => {
    const a = adapter();
    a.writeSetting("voice.tts.providers", {
      openai: { baseURL: "https://api.openai.com/v1" },
      eleven: { baseURL: "https://api.elevenlabs.io" },
    });
    const got = a.readSetting("voice.tts.providers") as Record<string, unknown>;
    expect(Object.keys(got).sort()).toEqual(["eleven", "openai"]);
  });

  it("throws when writing a key without an extension namespace (no dot)", () => {
    const a = adapter();
    expect(() => a.writeSetting("active", "gimble")).toThrow(/extension namespace/);
  });

  it("returns undefined when reading a key without a dot", () => {
    const a = adapter();
    expect(a.readSetting("session")).toBeUndefined();
  });

  it("lists keys with an exact-extension prefix", () => {
    const a = adapter();
    a.writeSetting("voice.tts.provider", "openai");
    a.writeSetting("voice.stt.provider", "whisper");
    a.writeSetting("image.model", "dall-e-3");

    const keys = a.listSettings("voice.").sort();
    expect(keys).toEqual(["voice.stt.provider", "voice.tts.provider"]);
  });

  it("lists keys filtered by ext-name prefix even before the dot", () => {
    const a = adapter();
    a.writeSetting("voice.tts.provider", "openai");
    a.writeSetting("image.model", "dall-e-3");

    // No dot: prefix is filtering by file (ext) name
    const keys = a.listSettings("voi").sort();
    expect(keys).toEqual(["voice.tts.provider"]);
  });

  it("returns empty list when no settings dir exists", () => {
    const a = adapter();
    expect(a.listSettings("")).toEqual([]);
  });

  it("does not return keys after delete", () => {
    const a = adapter();
    a.writeSetting("voice.tts.provider", "openai");
    a.writeSetting("voice.tts.model", "gpt-4o-tts");
    a.deleteSetting("voice.tts.provider");
    const keys = a.listSettings("voice.").sort();
    expect(keys).toEqual(["voice.tts.model"]);
  });

  it("ignores malformed YAML and treats the file as empty", () => {
    mkdirSync(join(tmp, "settings"), { recursive: true });
    writeFileSync(join(tmp, "settings", "voice.yaml"), "{not: valid: yaml::");
    const a = adapter();
    expect(a.readSetting("voice.tts.provider")).toBeUndefined();
  });

  it("reads from a pre-existing .yml file as a fallback", () => {
    mkdirSync(join(tmp, "settings"), { recursive: true });
    writeFileSync(
      join(tmp, "settings", "image.yml"),
      "model: dall-e-3\nprovider: openai\n",
    );
    const a = adapter();
    expect(a.readSetting("image.model")).toBe("dall-e-3");
    expect(a.readSetting("image.provider")).toBe("openai");
  });
});

describe("StandardRootAdapter — blobs", () => {
  it("writes a blob and reads it back", async () => {
    const a = adapter();
    const handle = await a.writeBlob(
      "voice-samples/gimble.wav",
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(handle.rootKind).toBe(".agents");
    expect(handle.size).toBe(4);
    expect(handle.path.endsWith("blobs/voice-samples/gimble.wav")).toBe(true);

    const got = await a.readBlob("voice-samples/gimble.wav");
    expect(got).toEqual(new Uint8Array([1, 2, 3, 4]));
  });

  it("persists mimeType in a sidecar file readable via blobHandle", async () => {
    const a = adapter();
    await a.writeBlob("logo.png", new Uint8Array([1, 2]), {
      mimeType: "image/png",
    });
    const h = a.blobHandle("logo.png", "global");
    expect(h?.mimeType).toBe("image/png");

    // Sidecar lives next to the blob
    expect(existsSync(join(tmp, "blobs", "logo.png.mime"))).toBe(true);
  });

  it("returns undefined when reading a non-existent blob", async () => {
    const a = adapter();
    expect(await a.readBlob("missing")).toBeUndefined();
    expect(a.blobHandle("missing", "global")).toBeUndefined();
  });

  it("deletes blob + sidecar together", async () => {
    const a = adapter();
    await a.writeBlob("x.bin", new Uint8Array([9]), { mimeType: "x/y" });
    expect(existsSync(join(tmp, "blobs", "x.bin"))).toBe(true);
    expect(existsSync(join(tmp, "blobs", "x.bin.mime"))).toBe(true);
    await a.deleteBlob("x.bin");
    expect(existsSync(join(tmp, "blobs", "x.bin"))).toBe(false);
    expect(existsSync(join(tmp, "blobs", "x.bin.mime"))).toBe(false);
  });

  it("rejects keys that escape the root with ..", async () => {
    const a = adapter();
    await expect(
      a.writeBlob("../etc/passwd", new Uint8Array([0])),
    ).rejects.toThrow(/escapes root/);
  });

  it("rejects absolute-path keys", async () => {
    const a = adapter();
    await expect(
      a.writeBlob("/abs/path", new Uint8Array([0])),
    ).rejects.toThrow(/must be relative/);
  });
});

describe("StandardRootAdapter — interop and layout", () => {
  it("co-habitates: leaves unrelated subdirs alone", () => {
    // Simulate a .claude/ that already has its own settings.json
    writeFileSync(join(tmp, "settings.json"), '{"theme":"dark"}');
    const a = adapter();
    a.writeSetting("voice.tts.provider", "openai");

    expect(readFileSync(join(tmp, "settings.json"), "utf8")).toBe(
      '{"theme":"dark"}',
    );
    expect(existsSync(join(tmp, "settings", "voice.yaml"))).toBe(true);
  });

  it("does not touch agents/ — that's persona territory", () => {
    mkdirSync(join(tmp, "agents"), { recursive: true });
    writeFileSync(
      join(tmp, "agents", "gimble.md"),
      "---\nname: Gimble\n---\nHi.",
    );
    const a = adapter();
    a.writeSetting("voice.tts.provider", "openai");

    expect(readFileSync(join(tmp, "agents", "gimble.md"), "utf8")).toContain(
      "name: Gimble",
    );
  });
});
