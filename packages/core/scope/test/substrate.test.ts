import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SUBSTRATE_NS, substrateDir } from "../src/index.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gonk-substrate-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("substrateDir — non-session tiers: .agents namespace + read-old fallback", () => {
  it("fresh install: returns <home>/.agents/<kind> when nothing exists", () => {
    expect(substrateDir("global", home, "memory")).toBe(join(home, SUBSTRATE_NS, "memory"));
  });

  it("legacy bare <home>/<kind>: keeps reading it until migrated", () => {
    mkdirSync(join(home, "memory"), { recursive: true });
    expect(substrateDir("global", home, "memory")).toBe(join(home, "memory"));
  });

  it("legacy .gonk/<kind>: keeps reading it until migrated", () => {
    mkdirSync(join(home, ".gonk", "sessions"), { recursive: true });
    expect(substrateDir("global", home, "sessions")).toBe(join(home, ".gonk", "sessions"));
  });

  it("migrated .agents/<kind> wins even when a legacy bare dir also lingers", () => {
    mkdirSync(join(home, "memory"), { recursive: true });
    mkdirSync(join(home, SUBSTRATE_NS, "memory"), { recursive: true });
    expect(substrateDir("global", home, "memory")).toBe(join(home, SUBSTRATE_NS, "memory"));
  });

  it(".agents wins over a lingering .gonk too (new namespace preferred)", () => {
    mkdirSync(join(home, ".gonk", "memory"), { recursive: true });
    mkdirSync(join(home, SUBSTRATE_NS, "memory"), { recursive: true });
    expect(substrateDir("global", home, "memory")).toBe(join(home, SUBSTRATE_NS, "memory"));
  });

  it("precedence when only legacy locations exist: .gonk before bare", () => {
    mkdirSync(join(home, "knowledge"), { recursive: true });
    mkdirSync(join(home, ".gonk", "knowledge"), { recursive: true });
    expect(substrateDir("global", home, "knowledge")).toBe(join(home, ".gonk", "knowledge"));
  });
});

describe("substrateDir — session tier: substrate lives directly under the session home", () => {
  it("does NOT add a second .agents nesting (the session home is already namespaced)", () => {
    // A session-tier home is itself `<home>/.agents/sessions/<id>`; its substrate
    // must land at `<sessionHome>/memory`, not `<sessionHome>/.agents/memory`.
    const sessionHome = join(home, SUBSTRATE_NS, "sessions", "sess-1");
    expect(substrateDir("session", sessionHome, "memory")).toBe(join(sessionHome, "memory"));
  });

  it("ignores any legacy fallback for the session tier (always bare under the home)", () => {
    const sessionHome = join(home, SUBSTRATE_NS, "sessions", "sess-2");
    mkdirSync(join(sessionHome, ".agents", "memory"), { recursive: true });
    // Even if a stray nested .agents exists, the session tier resolves bare.
    expect(substrateDir("session", sessionHome, "memory")).toBe(join(sessionHome, "memory"));
  });
});
