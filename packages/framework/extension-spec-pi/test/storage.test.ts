import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FsScopeStore } from "@gonk/scope";
import { namespaceStore } from "@mirk/store";
import { SqliteAdapter } from "@mirk/store/sqlite";

import {
  acquirePiStorage,
  resolvePiAutotuneClaimsDir,
} from "../src/storage.ts";
import type { PiBoundStorageLease } from "../src/storage.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gonk-pi-storage-"));
  roots.push(root);
  const homeRoot = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const env = { cwd, homeRoot, sessionId: "session-1" };
  return { root, homeRoot, cwd, env, scope: new FsScopeStore(env) };
}

function stateOf(lease: PiBoundStorageLease) {
  return lease.state;
}

describe("Pi host storage", () => {
  it("uses one canonical host database for fresh state, survives reopen, and keeps vectors", () => {
    const { homeRoot, env, scope } = fixture();
    const first = acquirePiStorage({ consumer: "memory", scope, env, defaultTier: "global" });
    stateOf(first).kv("memory-curated").set("claim", { value: "kept" });
    first.source.vector("global").upsert("recall", {
      id: "one",
      vector: Float32Array.from([1, 0]),
      metadata: { source: "test" },
    });
    first.close();

    const path = join(homeRoot, ".agents", "gonk", "global", "state.db");
    expect(existsSync(path)).toBe(true);

    const second = acquirePiStorage({ consumer: "memory", scope, env, defaultTier: "global" });
    expect(stateOf(second).kv("memory-curated").get("claim")).toEqual({ value: "kept" });
    expect(second.source.vector("global").count("recall")).toBe(1);
    second.close();
  });

  it("keeps an existing legacy database authoritative over an already-present canonical path", () => {
    const { homeRoot, env, scope } = fixture();
    const legacy = join(homeRoot, ".agents", "pi-state");
    mkdirSync(legacy, { recursive: true });
    const legacyAdapter = new SqliteAdapter({ path: join(legacy, "state.db") });
    namespaceStore(legacyAdapter.kv, "jobs").set("legacy", true);
    legacyAdapter.close();

    const canonical = join(homeRoot, ".agents", "gonk", "global");
    mkdirSync(canonical, { recursive: true });
    const canonicalAdapter = new SqliteAdapter({ path: join(canonical, "state.db") });
    namespaceStore(canonicalAdapter.kv, "jobs").set("canonical", true);
    canonicalAdapter.close();
    const reopened = acquirePiStorage({ consumer: "jobs", scope, env, defaultTier: "global" });
    expect(stateOf(reopened).kv("jobs").get("legacy")).toBe(true);
    expect(stateOf(reopened).kv("jobs").get("canonical")).toBeNull();
    reopened.close();
  });

  it("preserves a legacy memory database's KV and vector records", () => {
    const { homeRoot, env } = fixture();
    const legacy = join(homeRoot, ".agents", "memory-state");
    mkdirSync(legacy, { recursive: true });
    const adapter = new SqliteAdapter({ path: join(legacy, "state.db") });
    adapter.kv.set("memory-key", { preserved: true });
    adapter.vector.upsert("memory-vectors", {
      id: "legacy-vector",
      vector: Float32Array.from([0, 1]),
      metadata: { preserved: true },
    });
    adapter.close();

    const lease = acquirePiStorage({ consumer: "memory", env });
    expect(lease.source.kv("global").get("memory-key")).toEqual({ preserved: true });
    expect(lease.source.vector("global").count("memory-vectors")).toBe(1);
    lease.close();
  });

  it("preserves tiered Pi state and skill-journal compatibility locations", () => {
    const { homeRoot, env, scope } = fixture();
    const tiered = join(homeRoot, ".agents", "pi-state", "global");
    mkdirSync(tiered, { recursive: true });
    const tieredAdapter = new SqliteAdapter({ path: join(tiered, "state.db") });
    namespaceStore(tieredAdapter.kv, "work-items").set("legacy", true);
    tieredAdapter.close();

    const workItems = acquirePiStorage({ consumer: "work-items", scope, env, defaultTier: "global" });
    expect(stateOf(workItems).kv("work-items").get("legacy")).toBe(true);
    workItems.close();

    const skills = join(homeRoot, ".agents", "store", "skills");
    mkdirSync(skills, { recursive: true });
    const skillsAdapter = new SqliteAdapter({ path: join(skills, "state.db") });
    skillsAdapter.kv.set("journal", { legacy: true });
    skillsAdapter.close();

    const skillLease = acquirePiStorage({ consumer: "skill-creator", env });
    expect(skillLease.source.kv("global").get("journal")).toEqual({ legacy: true });
    skillLease.close();
  });

  it("shares an adapter lease, then closes only after its last consumer releases", () => {
    const { env, scope } = fixture();
    const first = acquirePiStorage({ consumer: "jobs", scope, env, defaultTier: "global" });
    const second = acquirePiStorage({ consumer: "persist", scope, env, defaultTier: "global" });
    const raw = first.source.kv("global");
    expect(raw).toBe(second.source.kv("global"));
    stateOf(first).kv("shared").set("value", 1);
    first.close();
    expect(stateOf(second).kv("shared").get("value")).toBe(1);
    second.close();
    expect(() => raw.get("shared")).toThrow(/database connection is not open/i);
    const third = acquirePiStorage({ consumer: "jobs", scope, env, defaultTier: "global" });
    expect(stateOf(third).kv("shared").get("value")).toBe(1);
    third.close();
  });

  it("re-resolves a memory source when its active persona home changes", () => {
    const { root, env, scope } = fixture();
    const firstHome = join(root, "persona-one");
    const secondHome = join(root, "persona-two");
    let activeHome = firstHome;
    const dynamicEnv = { ...env, resolvePersonaHome: () => activeHome };
    const lease = acquirePiStorage({ consumer: "memory", scope, env: dynamicEnv, defaultTier: "global" });

    lease.source.kv("persona").set("identity", "one");
    activeHome = secondHome;
    lease.source.kv("persona").set("identity", "two");
    activeHome = firstHome;
    expect(lease.source.kv("persona").get("identity")).toBe("one");
    activeHome = secondHome;
    expect(lease.source.kv("persona").get("identity")).toBe("two");

    expect(existsSync(join(firstHome, ".agents", "gonk", "persona", "state.db"))).toBe(true);
    expect(existsSync(join(secondHome, ".agents", "gonk", "persona", "state.db"))).toBe(true);
    lease.close();
  });

  it("keeps bound persona state dynamic, including retained tier views", () => {
    const { root, env, scope } = fixture();
    const firstHome = join(root, "bound-persona-one");
    const secondHome = join(root, "bound-persona-two");
    let activeHome = firstHome;
    const dynamicEnv = { ...env, resolvePersonaHome: () => activeHome };
    const lease = acquirePiStorage({ consumer: "memory", scope, env: dynamicEnv, defaultTier: "persona" });
    const retainedPersona = lease.state.at("persona");

    retainedPersona.kv("bound").set("identity", "one");
    activeHome = secondHome;
    retainedPersona.kv("bound").set("identity", "two");
    expect(lease.state.kv("bound").get("identity")).toBe("two");
    activeHome = firstHome;
    expect(lease.state.kv("persona", "bound").get("identity")).toBe("one");
    lease.close();
  });

  it("uses one physical pool key for a fresh database below a symlinked namespace", () => {
    const { homeRoot, env } = fixture();
    const physicalNamespace = join(homeRoot, "physical-agents");
    mkdirSync(physicalNamespace, { recursive: true });
    symlinkSync(physicalNamespace, join(homeRoot, ".agents"));
    const scope = new FsScopeStore(env);
    const first = acquirePiStorage({ consumer: "jobs", scope, env, defaultTier: "global" });
    const second = acquirePiStorage({ consumer: "persist", scope, env, defaultTier: "global" });
    expect(first.source.kv("global")).toBe(second.source.kv("global"));
    first.close();
    second.close();
  });

  it("retains the existing autotune claim directory before creating the host path", () => {
    const { homeRoot, env, scope } = fixture();
    const legacy = join(homeRoot, ".gonk", "autotune-claims");
    mkdirSync(legacy, { recursive: true });
    expect(resolvePiAutotuneClaimsDir(scope, "global")).toBe(legacy);
    rmSync(legacy, { recursive: true, force: true });
    expect(resolvePiAutotuneClaimsDir(scope, "global")).toBe(
      join(homeRoot, ".agents", "gonk", "global", "autotune-claims"),
    );
  });

  it("prefers a session home's bare legacy state over stale nested .agents state", () => {
    const { homeRoot, env, scope } = fixture();
    const sessionHome = join(homeRoot, ".agents", "sessions", "session-1");
    const bare = join(sessionHome, "pi-state");
    const nested = join(sessionHome, ".agents", "pi-state");
    mkdirSync(bare, { recursive: true });
    mkdirSync(nested, { recursive: true });
    const bareAdapter = new SqliteAdapter({ path: join(bare, "state.db") });
    namespaceStore(bareAdapter.kv, "jobs").set("from", "bare");
    bareAdapter.close();
    const nestedAdapter = new SqliteAdapter({ path: join(nested, "state.db") });
    namespaceStore(nestedAdapter.kv, "jobs").set("from", "nested");
    nestedAdapter.close();

    const lease = acquirePiStorage({ consumer: "jobs", scope, env, defaultTier: "session" });
    expect(stateOf(lease).kv("jobs").get("from")).toBe("bare");
    lease.close();
  });

  it("does not recreate an unbound skill KV store after close", () => {
    const { env } = fixture();
    const lease = acquirePiStorage({ consumer: "skill-creator", env });
    lease.source.kv("persona").set("temporary", true);
    lease.close();
    expect(() => lease.source.kv("persona")).toThrow(/lease is closed/);
  });

  it("fails eagerly for a bound unavailable tier, matching the core state binder", () => {
    const { env } = fixture();
    const noSessionEnv = { cwd: env.cwd, homeRoot: env.homeRoot };
    const lease = acquirePiStorage({
      consumer: "jobs",
      scope: new FsScopeStore(noSessionEnv),
      env: noSessionEnv,
      defaultTier: "global",
    });
    expect(() => lease.state.at("session")).toThrow(/no configured home for tier 'session'/);
    lease.close();
  });

  it("does not claim an authored bare gonk directory for fresh runtime state", () => {
    const { homeRoot, env, scope } = fixture();
    mkdirSync(join(homeRoot, "gonk", "notes"), { recursive: true });
    const lease = acquirePiStorage({ consumer: "jobs", scope, env, defaultTier: "global" });
    stateOf(lease).kv("jobs").set("fresh", true);
    expect(existsSync(join(homeRoot, "gonk", "state.db"))).toBe(false);
    expect(existsSync(join(homeRoot, ".agents", "gonk", "global", "state.db"))).toBe(true);
    lease.close();
  });
});
