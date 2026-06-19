import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";

import {
  StandardRootAdapter,
  migrateRootToStandardLayout,
  migrateAllUnder,
} from "../src/index.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gonk-migrate-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("migrateRootToStandardLayout", () => {
  it("returns unchanged=false when no config.yaml exists", () => {
    const r = migrateRootToStandardLayout(tmp);
    expect(r.changed).toBe(false);
    expect(r.settingsByExt).toEqual({});
  });

  it("routes flat-dotted keys into settings/<ext>.yaml grouped by ext", () => {
    writeFileSync(
      join(tmp, "config.yaml"),
      [
        "voice.tts.provider: openai",
        "voice.stt.provider: whisper",
        "image.model: dall-e-3",
        "image.providers:",
        "  openai:",
        "    baseURL: https://api.openai.com/v1",
      ].join("\n"),
    );

    const r = migrateRootToStandardLayout(tmp);
    expect(r.changed).toBe(true);
    expect(r.settingsByExt.voice).toBe(2);
    expect(r.settingsByExt.image).toBe(2);

    const voiceYaml = parse(
      readFileSync(join(tmp, "settings", "voice.yaml"), "utf8"),
    ) as Record<string, unknown>;
    expect(voiceYaml).toEqual({
      tts: { provider: "openai" },
      stt: { provider: "whisper" },
    });

    const imageYaml = parse(
      readFileSync(join(tmp, "settings", "image.yaml"), "utf8"),
    ) as Record<string, unknown>;
    expect(imageYaml).toMatchObject({ model: "dall-e-3" });
  });

  it("the migrated layout is then readable by StandardRootAdapter without changes", () => {
    writeFileSync(
      join(tmp, "config.yaml"),
      "voice.tts.provider: openai\nvoice.tts.model: gpt-4o-tts\n",
    );
    migrateRootToStandardLayout(tmp);

    const a = new StandardRootAdapter(".gonk", tmp);
    expect(a.readSetting("voice.tts.provider")).toBe("openai");
    expect(a.readSetting("voice.tts.model")).toBe("gpt-4o-tts");
  });

  it("backs up the old config.yaml by default", () => {
    writeFileSync(join(tmp, "config.yaml"), "voice.tts.provider: openai");
    const r = migrateRootToStandardLayout(tmp);
    expect(r.backupPath).toBeDefined();
    expect(existsSync(r.backupPath!)).toBe(true);
    expect(existsSync(join(tmp, "config.yaml"))).toBe(false);
    expect(readFileSync(r.backupPath!, "utf8")).toContain("voice.tts.provider");
  });

  it("leaves the old config.yaml in place when backup:false", () => {
    writeFileSync(join(tmp, "config.yaml"), "voice.tts.provider: openai");
    const r = migrateRootToStandardLayout(tmp, { backup: false });
    expect(r.changed).toBe(true);
    expect(existsSync(join(tmp, "config.yaml"))).toBe(true);
    expect(r.backupPath).toBeUndefined();
  });

  it("converts __blob_mime__.<key> entries into sidecar .mime files", () => {
    // Pre-existing blob from the old layout
    mkdirSync(join(tmp, "blobs"), { recursive: true });
    writeFileSync(join(tmp, "blobs", "logo.png"), new Uint8Array([1, 2, 3]));
    writeFileSync(
      join(tmp, "config.yaml"),
      [
        "voice.tts.provider: openai",
        "__blob_mime__.logo.png: image/png",
      ].join("\n"),
    );

    const r = migrateRootToStandardLayout(tmp);
    expect(r.blobMimesMoved).toBe(1);

    const sidecar = join(tmp, "blobs", "logo.png.mime");
    expect(existsSync(sidecar)).toBe(true);
    expect(readFileSync(sidecar, "utf8")).toBe("image/png");

    // And mime is now resolvable via the StandardRootAdapter
    const a = new StandardRootAdapter(".gonk", tmp);
    const handle = a.blobHandle("logo.png", "global");
    expect(handle?.mimeType).toBe("image/png");
  });

  it("does not create a sidecar for a mime entry whose blob is missing", () => {
    writeFileSync(
      join(tmp, "config.yaml"),
      "__blob_mime__.missing.bin: application/octet-stream",
    );
    const r = migrateRootToStandardLayout(tmp);
    expect(r.blobMimesMoved).toBe(0);
    expect(existsSync(join(tmp, "blobs", "missing.bin.mime"))).toBe(false);
  });

  it("collects dotless keys into skippedDotlessKeys instead of writing them", () => {
    writeFileSync(
      join(tmp, "config.yaml"),
      ["voice.tts.provider: openai", "orphan: value"].join("\n"),
    );
    const r = migrateRootToStandardLayout(tmp);
    expect(r.skippedDotlessKeys).toEqual(["orphan"]);
    // Dotless key is preserved only in the backup
    expect(readFileSync(r.backupPath!, "utf8")).toContain("orphan: value");
  });

  it("merges into an existing settings/<ext>.yaml; preserves prior new-layout writes", () => {
    // Simulate: someone already wrote to the new layout, then runs migration
    // against a stale config.yaml. New-layout writes should not be lost.
    mkdirSync(join(tmp, "settings"), { recursive: true });
    writeFileSync(
      join(tmp, "settings", "voice.yaml"),
      "tts:\n  model: already-here\n",
    );
    writeFileSync(
      join(tmp, "config.yaml"),
      "voice.tts.provider: openai",
    );

    migrateRootToStandardLayout(tmp);

    const voice = parse(
      readFileSync(join(tmp, "settings", "voice.yaml"), "utf8"),
    ) as Record<string, unknown>;
    expect(voice).toEqual({
      tts: { provider: "openai", model: "already-here" },
    });
  });

  it("is idempotent — running twice produces no further changes", () => {
    writeFileSync(join(tmp, "config.yaml"), "voice.tts.provider: openai");
    const r1 = migrateRootToStandardLayout(tmp);
    expect(r1.changed).toBe(true);

    const r2 = migrateRootToStandardLayout(tmp);
    expect(r2.changed).toBe(false);
  });
});

describe("migrateAllUnder", () => {
  it("finds and migrates every directory that has a config.yaml", () => {
    // Two roots in the workspace, each in the legacy layout
    mkdirSync(join(tmp, "a", ".gonk"), { recursive: true });
    writeFileSync(
      join(tmp, "a", ".gonk", "config.yaml"),
      "voice.tts.provider: openai",
    );
    mkdirSync(join(tmp, "b", ".gonk"), { recursive: true });
    writeFileSync(
      join(tmp, "b", ".gonk", "config.yaml"),
      "image.model: dall-e-3",
    );

    const summaries = migrateAllUnder(tmp);
    expect(summaries).toHaveLength(2);
    expect(summaries.every((s) => s.changed)).toBe(true);

    const voice = parse(
      readFileSync(join(tmp, "a", ".gonk", "settings", "voice.yaml"), "utf8"),
    );
    expect(voice).toEqual({ tts: { provider: "openai" } });
  });

  it("ignores directories without a config.yaml", () => {
    mkdirSync(join(tmp, "empty"), { recursive: true });
    expect(migrateAllUnder(tmp)).toEqual([]);
  });
});
