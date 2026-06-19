import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SUBSTRATE_NS,
  SUBSTRATE_STUB_FILE,
  nativeSubstrateMirror,
  readSubstrateStub,
  resolveNativeSubstrateHome,
  substrateDir,
  writeSubstrateStub,
} from "../src/index.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gonk-native-sub-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("nativeSubstrateMirror", () => {
  it("keys the mirror by host + id under <globalHome>/.agents/native/", () => {
    expect(nativeSubstrateMirror("/home/dr", "claude", "iris")).toBe(
      join("/home/dr", SUBSTRATE_NS, "native", "claude", "iris"),
    );
  });

  it("separates hosts so their substrate never shares a dir", () => {
    const a = nativeSubstrateMirror("/h", "claude", "iris");
    const b = nativeSubstrateMirror("/h", "codex", "iris");
    expect(a).not.toBe(b);
  });
});

describe("substrate stub I/O", () => {
  it("the stub filename is hidden, gonk-namespaced, and not a substrate kind", () => {
    expect(SUBSTRATE_STUB_FILE.startsWith(".")).toBe(true);
    expect(["memory", "knowledge", "sessions"]).not.toContain(SUBSTRATE_STUB_FILE);
  });

  it("round-trips the mirror path", () => {
    const def = join(tmp, "claude", "agents", "iris");
    const mirror = nativeSubstrateMirror(tmp, "claude", "iris");
    writeSubstrateStub(def, mirror);
    expect(readSubstrateStub(def)).toBe(mirror);
  });

  it("returns undefined when no stub exists", () => {
    expect(readSubstrateStub(join(tmp, "nope"))).toBeUndefined();
  });

  it("returns undefined when the stub is malformed JSON", () => {
    const def = join(tmp, "broken");
    writeSubstrateStub(def, "/whatever"); // ensures dir exists
    writeFileSync(join(def, SUBSTRATE_STUB_FILE), "{ not json");
    expect(readSubstrateStub(def)).toBeUndefined();
  });

  it("rejects a relative path (only an absolute mirror path is trusted)", () => {
    const def = join(tmp, "relative");
    writeSubstrateStub(def, "/abs"); // ensures dir exists
    writeFileSync(join(def, SUBSTRATE_STUB_FILE), JSON.stringify({ path: "../escape" }));
    expect(readSubstrateStub(def)).toBeUndefined();
  });
});

describe("resolveNativeSubstrateHome", () => {
  it("returns the canonical mirror when there is no stub", () => {
    const def = join(tmp, "claude", "agents", "iris");
    expect(resolveNativeSubstrateHome(def, tmp, "claude", "iris")).toBe(
      nativeSubstrateMirror(tmp, "claude", "iris"),
    );
  });

  it("follows an existing stub's path (use what's available)", () => {
    const def = join(tmp, "claude", "agents", "iris");
    const moved = join(tmp, "elsewhere", "iris");
    writeSubstrateStub(def, moved);
    expect(resolveNativeSubstrateHome(def, tmp, "claude", "iris")).toBe(moved);
  });

  it("never resolves to a path inside the host definition dir", () => {
    const def = join(tmp, "claude", "agents", "iris");
    const resolved = resolveNativeSubstrateHome(def, tmp, "claude", "iris");
    expect(resolved.startsWith(def)).toBe(false);
  });
});

describe("substrateDir on a native mirror home", () => {
  it("keeps substrate bare under the mirror (no second .agents nesting)", () => {
    // The mirror is already a pure gonk-owned substrate container under
    // .agents/native, so substrate lands at <mirror>/memory, not
    // <mirror>/.agents/memory.
    const mirror = nativeSubstrateMirror(tmp, "claude", "iris");
    expect(substrateDir("persona", mirror, "memory")).toBe(join(mirror, "memory"));
    expect(substrateDir("persona", mirror, "memory")).not.toContain(
      join(SUBSTRATE_NS, "native", "claude", "iris", SUBSTRATE_NS),
    );
  });

  it("still nests a normal persona definition home under .agents", () => {
    const personaHome = join(tmp, "agents", "garnet");
    expect(substrateDir("persona", personaHome, "memory")).toBe(
      join(personaHome, SUBSTRATE_NS, "memory"),
    );
  });
});
