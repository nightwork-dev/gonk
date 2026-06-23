import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FsScopeStore, type ScopeName } from "@gonk/scope";

import {
  createStore,
  createStoreProvider,
  FsStoreBackend,
  mirkBackendFactory,
  resolveStoreDir,
  type BackendFactory,
} from "../src/index.ts";
import { mirkStoreDbPath } from "../src/mirk-backend.ts";

let root: string;
let home: string;
let cwd: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gonk-store-provider-"));
  home = join(root, "home");
  cwd = join(root, "work");
  mkdirSync(home, { recursive: true });
  mkdirSync(cwd, { recursive: true });
  home = realpathSync(home);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function scopeFor() {
  return new FsScopeStore({ cwd, homeRoot: home });
}

describe("StoreProvider", () => {
  it("defaults to the fs backend and behaves like createStore(scope)", () => {
    const scope = scopeFor();
    const provider = createStoreProvider(scope);
    const namespace = "provider.fs";

    const kv = provider.kv<{ n: number }>("global", namespace);
    kv.set("k", { n: 1 });
    expect(kv.get("k")).toEqual({ n: 1 });

    const store = createStore(scope);
    expect(store.kv<{ n: number }>("global", namespace).get("k")).toEqual({ n: 1 });
    expect(existsSync(mirkStoreDbPath(resolveStoreDir(scope, "global", namespace)))).toBe(false);
  });

  it("can explicitly route through the mirk backend", () => {
    const scope = scopeFor();
    const provider = createStoreProvider(scope, { backendFactory: mirkBackendFactory(scope) });
    const namespace = "provider.mirk";

    provider.kv<string>("global", namespace).set("k", "v");

    const dbPath = mirkStoreDbPath(resolveStoreDir(scope, "global", namespace));
    expect(existsSync(dbPath)).toBe(true);
    expect(readFileSync(dbPath).subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");
  });

  it("honors an explicit backendFactory as a thin pass-through", () => {
    const scope = scopeFor();
    const calls: Array<{ tier: ScopeName; namespace: string }> = [];
    const backendDir = (tier: ScopeName, namespace: string) => join(root, "explicit", tier, namespace);
    const backendFactory: BackendFactory = (tier, namespace) => {
      calls.push({ tier, namespace });
      return new FsStoreBackend(backendDir(tier, namespace));
    };
    const provider = createStoreProvider(scope, { backendFactory });
    const namespace = "provider.explicit";

    provider.kv<string>("global", namespace).set("k", "v");

    expect(calls).toEqual([{ tier: "global", namespace }]);
    expect(existsSync(join(backendDir("global", namespace), "kv.json"))).toBe(true);
    expect(existsSync(resolveStoreDir(scope, "global", namespace))).toBe(false);
  });
});
