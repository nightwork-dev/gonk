import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  SUBSTRATE_NS,
  SUBSTRATE_STUB_FILE,
  adoptNativePersonaSubstrate,
  nativeSubstrateMirror,
  readSubstrateStub,
  resolveNativeSubstrateHome,
} from "../src/index.ts";

let tmp: string;
let globalHome: string;
let defHome: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gonk-adopt-"));
  globalHome = join(tmp, "home");
  // A native-host persona definition dir, e.g. ~/.claude/agents/gimble
  defHome = join(tmp, "host", ".claude", "agents", "gimble");
  mkdirSync(globalHome, { recursive: true });
  mkdirSync(defHome, { recursive: true });
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function seed(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

describe("adoptNativePersonaSubstrate", () => {
  it("moves consolidated .agents/<kind> substrate into the mirror and writes a stub", () => {
    seed(join(defHome, SUBSTRATE_NS, "memory"), "curated.md", "gimble-fact");
    const mirror = nativeSubstrateMirror(globalHome, "claude", "gimble");

    const summary = adoptNativePersonaSubstrate(defHome, globalHome, "claude", "gimble");

    expect(summary.moved).toContainEqual({
      from: join(defHome, SUBSTRATE_NS, "memory"),
      to: join(mirror, "memory"),
    });
    // Data moved into the mirror; host dir no longer holds the substrate.
    expect(readFileSync(join(mirror, "memory", "curated.md"), "utf8")).toBe(
      "gimble-fact",
    );
    expect(existsSync(join(defHome, SUBSTRATE_NS, "memory"))).toBe(false);
    // Stub left behind, pointing at the mirror.
    expect(readSubstrateStub(defHome)).toBe(mirror);
    expect(existsSync(join(defHome, SUBSTRATE_STUB_FILE))).toBe(true);
  });

  it("adopts legacy bare <defHome>/<kind> substrate too", () => {
    seed(join(defHome, "knowledge"), "knowledge.db", "k");
    const mirror = nativeSubstrateMirror(globalHome, "claude", "gimble");
    adoptNativePersonaSubstrate(defHome, globalHome, "claude", "gimble");
    expect(readFileSync(join(mirror, "knowledge", "knowledge.db"), "utf8")).toBe("k");
    expect(existsSync(join(defHome, "knowledge"))).toBe(false);
  });

  it("after adoption, resolveNativeSubstrateHome follows the stub to the mirror", () => {
    seed(join(defHome, SUBSTRATE_NS, "memory"), "curated.md", "x");
    const mirror = nativeSubstrateMirror(globalHome, "claude", "gimble");
    adoptNativePersonaSubstrate(defHome, globalHome, "claude", "gimble");
    expect(resolveNativeSubstrateHome(defHome, globalHome, "claude", "gimble")).toBe(mirror);
  });

  it("is idempotent — a second run moves nothing", () => {
    seed(join(defHome, SUBSTRATE_NS, "memory"), "curated.md", "x");
    adoptNativePersonaSubstrate(defHome, globalHome, "claude", "gimble");
    const second = adoptNativePersonaSubstrate(defHome, globalHome, "claude", "gimble");
    expect(second.moved).toEqual([]);
    expect(second.skipped).toEqual([]);
  });

  it("is non-clobbering — a pre-existing mirror dir leaves the source and is reported", () => {
    seed(join(defHome, SUBSTRATE_NS, "memory"), "old.md", "legacy");
    const mirror = nativeSubstrateMirror(globalHome, "claude", "gimble");
    seed(join(mirror, "memory"), "new.md", "current");

    const summary = adoptNativePersonaSubstrate(defHome, globalHome, "claude", "gimble");

    expect(summary.moved).toEqual([]);
    expect(summary.skipped).toContainEqual({
      from: join(defHome, SUBSTRATE_NS, "memory"),
      to: join(mirror, "memory"),
      reason: "destination already exists",
    });
    // Neither side merged or lost.
    expect(readFileSync(join(defHome, SUBSTRATE_NS, "memory", "old.md"), "utf8")).toBe("legacy");
    expect(readFileSync(join(mirror, "memory", "new.md"), "utf8")).toBe("current");
    // No stub written when everything was skipped — the data is still in the
    // definition home, so a "moved to mirror" pointer would mislead.
    expect(existsSync(join(defHome, SUBSTRATE_STUB_FILE))).toBe(false);
  });

  it("dryRun reports moves without touching disk or writing the stub", () => {
    seed(join(defHome, SUBSTRATE_NS, "memory"), "curated.md", "x");
    const summary = adoptNativePersonaSubstrate(defHome, globalHome, "claude", "gimble", {
      dryRun: true,
    });
    expect(summary.moved.length).toBeGreaterThan(0);
    expect(existsSync(join(defHome, SUBSTRATE_NS, "memory"))).toBe(true); // untouched
    expect(existsSync(join(defHome, SUBSTRATE_STUB_FILE))).toBe(false); // no stub
  });
});
