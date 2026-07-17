import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { FsScopeStore } from "@gonk/scope";

import { createStore, resolveStoreDir } from "../src/index.ts";

let root: string;
let home: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gonk-store-factory-"));
  home = join(root, "home");
  cwd = join(root, "work");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  // Scope canonicalizes tier homes via realpathSync; on macOS /var → /private/var.
  // Compare against the canonical home so assertions match what scope resolves.
  home = realpathSync(home);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function scopeFor() {
  // A scope whose global home is the temp dir, so the factory writes there and
  // never the real user home.
  return new FsScopeStore({ cwd, homeRoot: home });
}

describe("createStore factory — scope resolution", () => {
  it("resolves the store dir under the scope home, preferring .agents/", () => {
    const scope = scopeFor();
    const dir = resolveStoreDir(scope, "global", "memory.recall");

    // Under the scope home, not a bare path elsewhere.
    expect(dir.startsWith(home + sep)).toBe(true);
    // Prefers .agents/ (not a bare .gonk/).
    expect(dir.split(sep)).toContain(".agents");
    expect(dir.split(sep)).not.toContain(".gonk");
    // Namespaced terminal segment.
    expect(dir.endsWith(join(".agents", "store", "memory.recall"))).toBe(true);
  });

  it("prefers a pre-existing .agents/ over legacy .gonk/", () => {
    // Pre-seed both; substrate resolution should keep using .agents/.
    mkdirSync(join(home, ".agents", "store", "ns"), { recursive: true });
    mkdirSync(join(home, ".gonk", "store", "ns"), { recursive: true });
    const scope = scopeFor();
    const dir = resolveStoreDir(scope, "global", "ns");
    expect(dir).toBe(join(home, ".agents", "store", "ns"));
  });

  it("keeps state inside an explicit home when cwd is that same directory", () => {
    const scope = new FsScopeStore({ cwd: home, homeRoot: home, projectRoot: home });

    expect(resolveStoreDir(scope, "global", "same-home")).toBe(
      join(home, ".agents", "store", "same-home"),
    );
  });

  it("round-trips real data through every store type via the factory", () => {
    const scope = scopeFor();
    const store = createStore(scope);

    const kv = store.kv<{ n: number }>("global", "demo");
    kv.set("k", { n: 5 });
    expect(kv.get("k")).toEqual({ n: 5 });

    const blob = store.blob("global", "demo");
    blob.put("b", new Uint8Array([1, 2]));
    expect(blob.get("b")).toEqual(new Uint8Array([1, 2]));

    const log = store.log<{ x: number }>("global", "demo");
    const off = log.append({ x: 1 });
    expect(log.readAt(off)).toEqual({ x: 1 });

    const vec = store.vector("global", "demo");
    vec.upsert("v", [1, 0]);
    expect(vec.search([1, 0], 1)[0]!.id).toBe("v");

    // Data actually landed on disk under the scope home's .agents/store.
    expect(existsSync(join(home, ".agents", "store", "demo"))).toBe(true);
  });
});
