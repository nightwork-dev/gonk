import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SUBSTRATE_NS, migrateSubstrateHome, substrateDir } from "../src/index.ts";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "gonk-migrate-sub-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function seedFile(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), body);
}

describe("migrateSubstrateHome", () => {
  it("moves bare <home>/memory into <home>/.agents/memory", () => {
    seedFile(join(home, "memory"), "curated.md", "fact");
    const summary = migrateSubstrateHome(home);
    expect(summary.moved).toContainEqual({
      from: join(home, "memory"),
      to: join(home, SUBSTRATE_NS, "memory"),
    });
    expect(existsSync(join(home, "memory"))).toBe(false);
    expect(readFileSync(join(home, SUBSTRATE_NS, "memory", "curated.md"), "utf8")).toBe("fact");
  });

  it("moves legacy .gonk/<kind> dirs (memory, knowledge, sessions) into .agents/", () => {
    seedFile(join(home, ".gonk", "memory"), "kv.db", "m");
    seedFile(join(home, ".gonk", "knowledge"), "knowledge.db", "k");
    seedFile(join(home, ".gonk", "sessions"), "marker", "s");
    const summary = migrateSubstrateHome(home);
    expect(summary.moved.map((m) => m.to).sort()).toEqual(
      [
        join(home, SUBSTRATE_NS, "knowledge"),
        join(home, SUBSTRATE_NS, "memory"),
        join(home, SUBSTRATE_NS, "sessions"),
      ].sort(),
    );
    expect(readFileSync(join(home, SUBSTRATE_NS, "sessions", "marker"), "utf8")).toBe("s");
  });

  it("after migration, substrateDir resolves to the new .agents path", () => {
    seedFile(join(home, "memory"), "curated.md", "x");
    migrateSubstrateHome(home);
    expect(substrateDir("global", home, "memory")).toBe(join(home, SUBSTRATE_NS, "memory"));
  });

  it("is idempotent — a second run moves nothing", () => {
    seedFile(join(home, "memory"), "curated.md", "x");
    migrateSubstrateHome(home);
    const second = migrateSubstrateHome(home);
    expect(second.moved).toEqual([]);
    expect(second.skipped).toEqual([]);
  });

  it("does not clobber — a pre-existing destination leaves the source in place and reports it", () => {
    seedFile(join(home, "memory"), "old.md", "legacy");
    seedFile(join(home, SUBSTRATE_NS, "memory"), "new.md", "current");
    const summary = migrateSubstrateHome(home);
    expect(summary.moved).toEqual([]);
    expect(summary.skipped).toContainEqual({
      from: join(home, "memory"),
      to: join(home, SUBSTRATE_NS, "memory"),
      reason: "destination already exists",
    });
    // Both dirs untouched — no merge, no data loss.
    expect(readFileSync(join(home, "memory", "old.md"), "utf8")).toBe("legacy");
    expect(readFileSync(join(home, SUBSTRATE_NS, "memory", "new.md"), "utf8")).toBe("current");
  });

  it("dryRun reports moves without touching disk", () => {
    seedFile(join(home, "memory"), "curated.md", "x");
    const summary = migrateSubstrateHome(home, { dryRun: true });
    expect(summary.moved).toHaveLength(1);
    expect(existsSync(join(home, "memory"))).toBe(true); // untouched
    expect(existsSync(join(home, SUBSTRATE_NS, "memory"))).toBe(false);
  });
});
