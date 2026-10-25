import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryKv } from "@mirk/store";
import { SqliteAdapter } from "@mirk/store/sqlite";
import { FsScopeStore, MemoryScopeStore } from "@gonk/scope";

import { bindGonkSyncState } from "../src/state.ts";
import { acquireHostStorage } from "../src/host-storage.ts";

const roots: string[] = [];
const closes: Array<() => void> = [];
afterEach(() => {
  for (const close of closes.splice(0)) close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
  const path = mkdtempSync(join(tmpdir(), "gonk-state-transaction-"));
  roots.push(path);
  return path;
}

describe("host-owned synchronous tier transactions", () => {
  it("fails before invoking work when the host does not provide transactions", () => {
    const state = bindGonkSyncState(new MemoryScopeStore(), { kv: () => new InMemoryKv() });
    let invoked = false;
    expect(() => state.at("session").transaction(() => { invoked = true; })).toThrow(/transaction is not configured/);
    expect(invoked).toBe(false);
  });

  it("rolls back both namespace writes and Promise results on the actual owning SQLite connection", () => {
    const path = join(root(), "state.db");
    const adapter = new SqliteAdapter({ path });
    const state = bindGonkSyncState(new MemoryScopeStore(), {
      kv: () => adapter.kv,
      transaction: (_tier, work) => adapter.transaction(work, "immediate"),
    }, { defaultTier: "session" });
    const carrier = state.kv("work-items");
    const inbox = state.kv("inbox");
    expect(() => state.transaction(() => {
      carrier.set("one", { id: "one" });
      inbox.set("one", { id: "one" });
      throw new Error("injected second-write failure");
    })).toThrow(/injected second-write failure/);
    expect(carrier.has("one")).toBe(false);
    expect(inbox.has("one")).toBe(false);
    expect(() => state.transaction(() => {
      carrier.set("async", { id: "async" });
      return Promise.resolve();
    })).toThrow(/must be synchronous/);
    expect(carrier.has("async")).toBe(false);
    state.transaction(() => {
      carrier.set("committed", { id: "committed" });
      inbox.set("committed", { id: "committed" });
    });
    adapter.close();
    const reopened = new SqliteAdapter({ path });
    closes.push(() => reopened.close());
    const restored = bindGonkSyncState(new MemoryScopeStore(), { kv: () => reopened.kv }, { defaultTier: "session" });
    expect(restored.kv("work-items").get("committed")).toEqual({ id: "committed" });
    expect(restored.kv("inbox").get("committed")).toEqual({ id: "committed" });
    expect(restored.kv("inbox").has("one")).toBe(false);
    expect(restored.kv("work-items").has("one")).toBe(false);
  });

  it("forwards transactions through host-bound dynamic state, then closes and reopens the lease", () => {
    const fixture = root();
    const cwd = join(fixture, "project");
    mkdirSync(cwd);
    const env = { cwd, homeRoot: join(fixture, "home"), sessionId: "session-a" };
    const scope = new FsScopeStore(env);
    const options = {
      consumer: "fixture" as const,
      policy: { layout: { fixture: "pi-tiered" as const } },
      env, scope, defaultTier: "session" as const,
    };
    const first = acquireHostStorage(options);
    expect(() => first.state.at("session").transaction(() => {
      first.state.kv("session", "work-items").set("bad", { id: "bad" });
      first.state.kv("session", "inbox").set("bad", { id: "bad" });
      throw new Error("injected failure");
    })).toThrow(/injected failure/);
    first.state.transaction(() => {
      first.state.kv("work-items").set("good", { id: "good" });
      first.state.kv("inbox").set("good", { id: "good" });
    });
    const boundSession = first.state.at("session");
    first.close();
    let invoked = false;
    expect(() => boundSession.transaction(() => { invoked = true; })).toThrow(/lease is closed/);
    expect(invoked).toBe(false);
    const second = acquireHostStorage(options);
    closes.push(() => second.close());
    expect(second.state.kv("inbox").has("bad")).toBe(false);
    expect(second.state.kv("work-items").has("bad")).toBe(false);
    expect(second.state.kv("inbox").get("good")).toEqual({ id: "good" });
    expect(second.state.kv("work-items").get("good")).toEqual({ id: "good" });
  });

  it("fails closed for a host's unbound in-memory tier", () => {
    const fixture = root();
    const env = { cwd: fixture, homeRoot: join(fixture, "home") };
    const scope = new FsScopeStore(env);
    const lease = acquireHostStorage({
      consumer: "fixture", policy: {
        layout: { fixture: "pi-tiered" }, allowUnboundMemoryFor: new Set(["fixture"]),
      }, env, scope,
    });
    closes.push(() => lease.close());
    let invoked = false;
    expect(() => lease.state.at("session").transaction(() => { invoked = true; })).toThrow(/no transactional store for unbound tier/);
    expect(invoked).toBe(false);
  });
});
