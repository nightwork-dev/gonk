import { afterEach, describe, expect, it } from "vitest";
import { InMemoryKv, InMemoryVectorStore } from "@mirk/store";
import { SqliteAdapter } from "@mirk/store/sqlite";
import { MemoryScopeStore } from "@gonk/scope";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bindGonkSyncState } from "../src/index.ts";

const separator = "\u001f";
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("bindGonkSyncState", () => {
  it("binds the same Mirk in-memory ports with isolated logical namespaces", () => {
    const scope = new MemoryScopeStore();
    const kv = new InMemoryKv();
    const vector = new InMemoryVectorStore({ dimensions: 2 });
    const state = bindGonkSyncState(scope, {
      kv: () => kv,
      vector: () => vector,
    });

    const jobs = state.kv("jobs");
    jobs.set("attempt-1", { done: true });
    expect(jobs.get("attempt-1")).toEqual({ done: true });
    expect(kv.get(`${"jobs"}${separator}attempt-1`)).toEqual({ done: true });
    expect(state.kv("other").get("attempt-1")).toBeNull();
    expect(state.at("project").kv("jobs")).not.toBe(jobs);

    const embeddings = state.vector("memory");
    embeddings.upsert("recall", {
      id: "one",
      vector: Float32Array.from([1, 0]),
      metadata: { source: "test" },
    });
    expect(embeddings.count("recall")).toBe(1);
    expect(vector.count(`memory${separator}recall`)).toBe(1);
  });

  it("fails closed when state configuration is missing and when an optional vector port is unavailable", () => {
    const scope = new MemoryScopeStore();
    expect(() => bindGonkSyncState(scope, undefined as never)).toThrow(/caller-provided Mirk source/);

    const state = bindGonkSyncState(scope, { kv: () => new InMemoryKv() });
    expect(() => state.vector("memory")).toThrow(/vector capability is not configured/);
  });

  it("uses a host-owned SQLite adapter for the same KV and vector policy, then survives close and reopen", () => {
    const root = mkdtempSync(join(tmpdir(), "gonk-state-sqlite-"));
    roots.push(root);
    const path = join(root, "state.db");
    const adapter = new SqliteAdapter({ path, dimensions: 2, forceJsCosine: true });
    const scope = new MemoryScopeStore();
    const state = bindGonkSyncState(scope, {
      kv: () => adapter.kv,
      vector: () => adapter.vector,
    }, { defaultTier: "project" });

    state.kv("jobs").set("attempt-1", { done: true });
    state.vector("memory").upsert("embeddings", {
      id: "one",
      vector: Float32Array.from([1, 0]),
      metadata: { source: "sqlite" },
    });
    adapter.close();

    const reopened = new SqliteAdapter({ path, dimensions: 2, forceJsCosine: true });
    const restored = bindGonkSyncState(scope, {
      kv: () => reopened.kv,
      vector: () => reopened.vector,
    }, { defaultTier: "project" });
    expect(restored.kv("jobs").get<{ done: boolean }>("attempt-1")).toEqual({ done: true });
    expect(restored.vector("memory").count("embeddings")).toBe(1);
    reopened.close();
  });
});
