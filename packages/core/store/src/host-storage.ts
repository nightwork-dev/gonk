import { existsSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { canonicalPath, resolveTierHomes, type ScopeEnvironment, type ScopeName, type ScopeStore } from "@gonk/scope";
import { InMemoryKv, type SyncStore } from "@mirk/store";
import { SqliteAdapter } from "@mirk/store/sqlite";
import type { VectorStore } from "@mirk/store/vector";

import { bindGonkSyncState, type GonkSyncState, type GonkSyncStateSource, type GonkSyncStateTier } from "./state.ts";

export type LegacyStorageLayout = "memory" | "pi-flat" | "pi-tiered" | "skills";

export interface HostStorageSource extends GonkSyncStateSource {
  vector(tier: ScopeName): VectorStore;
}

export interface HostStorageLease {
  readonly source: HostStorageSource;
  close(): void;
}

export interface HostBoundStorageLease extends HostStorageLease {
  readonly state: GonkSyncState;
}

export interface HostStoragePolicy<Consumer extends string> {
  readonly layout: Readonly<Record<Consumer, LegacyStorageLayout>>;
  readonly allowUnboundMemoryFor?: ReadonlySet<Consumer>;
}

export interface AcquireHostStorageOptions<Consumer extends string> {
  consumer: Consumer;
  policy: HostStoragePolicy<Consumer>;
  scope?: ScopeStore;
  env: ScopeEnvironment;
  defaultTier?: ScopeName;
}

export interface AcquireBoundHostStorageOptions<Consumer extends string>
  extends AcquireHostStorageOptions<Consumer> {
  scope: ScopeStore;
}

interface PoolEntry { readonly adapter: SqliteAdapter; leases: number; }

/**
 * Acquires a host-owned Mirk lease using the established Gonk compatibility
 * paths. A host supplies its finite consumer-to-layout policy; capability code
 * only receives the resulting source or bound state.
 */
export function acquireHostStorage<Consumer extends string>(options: AcquireBoundHostStorageOptions<Consumer>): HostBoundStorageLease;
export function acquireHostStorage<Consumer extends string>(options: AcquireHostStorageOptions<Consumer>): HostStorageLease;
export function acquireHostStorage<Consumer extends string>(options: AcquireHostStorageOptions<Consumer>): HostStorageLease {
  const entries = registry();
  const adapters = new Map<string, PoolEntry>();
  const unbound = new Map<ScopeName, InMemoryKv>();
  let closed = false;
  const canUseUnboundMemory = options.policy.allowUnboundMemoryFor?.has(options.consumer) ?? false;

  const source: HostStorageSource = {
    kv(tier) { return kvFor(tier); },
    vector(tier) { return vectorFor(tier); },
  };
  const state = options.scope ? dynamicBoundState(options.scope, source, options.defaultTier) : undefined;

  function kvFor(tier: ScopeName): SyncStore {
    if (closed) throw new Error("host storage lease is closed");
    const home = resolveTierHomes(options.env).get(tier);
    if (!home && canUseUnboundMemory) {
      let memory = unbound.get(tier);
      if (!memory) unbound.set(tier, memory = new InMemoryKv());
      return memory;
    }
    return adapterFor(tier, home).kv;
  }

  function vectorFor(tier: ScopeName): VectorStore {
    if (closed) throw new Error("host storage lease is closed");
    const home = resolveTierHomes(options.env).get(tier);
    if (!home && canUseUnboundMemory) {
      throw new Error(`host storage has no vector port for unbound tier '${tier}'`);
    }
    return adapterFor(tier, home).vector;
  }

  function adapterFor(tier: ScopeName, home: string | undefined): SqliteAdapter {
    if (!home) throw new Error(`host ${options.consumer} storage has no configured home for tier '${tier}'`);
    const path = physicalDbPath(resolveHostStoragePath(options.policy.layout[options.consumer], tier, home));
    const leased = adapters.get(path);
    if (leased) return leased.adapter;
    let entry = entries.get(path);
    if (!entry) {
      entry = { adapter: new SqliteAdapter({ path }), leases: 0 };
      entries.set(path, entry);
    }
    entry.leases += 1;
    adapters.set(path, entry);
    return entry.adapter;
  }

  const lease: HostStorageLease = {
    source,
    close() {
      if (closed) return;
      closed = true;
      for (const [path, entry] of adapters) {
        entry.leases -= 1;
        if (entry.leases === 0) { entry.adapter.close(); entries.delete(path); }
      }
      adapters.clear();
      unbound.clear();
    },
  };
  return state === undefined ? lease : ({ ...lease, state } as HostBoundStorageLease);
}

export function resolveHostStoragePath(layout: LegacyStorageLayout, tier: ScopeName, home: string): string {
  for (const legacy of legacyPaths(layout, tier, home)) if (existsSync(legacy)) return legacy;
  return join(resolveHostRuntimeRoot(tier, home), tier, "state.db");
}

/** Gonk-owned runtime root for a resolved scope home. */
export function resolveHostRuntimeRoot(tier: ScopeName, home: string): string {
  return isPureSubstrateHome(tier, home) ? join(home, "gonk") : join(home, ".agents", "gonk");
}

function legacyPaths(layout: LegacyStorageLayout, tier: ScopeName, home: string): string[] {
  const roots = isPureSubstrateHome(tier, home)
    ? [home, join(home, ".agents"), join(home, ".gonk")]
    : [join(home, ".agents"), join(home, ".gonk"), home];
  switch (layout) {
    case "memory": return roots.map((root) => join(root, "memory-state", "state.db"));
    case "pi-flat": return roots.map((root) => join(root, "pi-state", "state.db"));
    case "pi-tiered": return roots.map((root) => join(root, "pi-state", tier, "state.db"));
    case "skills": return roots.map((root) => join(root, "store", "skills", "state.db"));
  }
}

function isPureSubstrateHome(tier: ScopeName, home: string): boolean {
  if (tier === "session") return true;
  const parts = home.split(/[\\/]/);
  const index = parts.indexOf(".agents");
  return index >= 0 && parts[index + 1] === "native";
}

function dynamicBoundState(scope: ScopeStore, source: HostStorageSource, defaultTier?: ScopeName): GonkSyncState {
  const resolvedDefault = defaultTier ?? "global";
  const tier = (name: ScopeName): GonkSyncStateTier => {
    source.kv(name);
    return {
      tier: name,
      kv(namespace) { return bindGonkSyncState(scope, source, { defaultTier: name }).kv(namespace); },
      vector(namespace) { return bindGonkSyncState(scope, source, { defaultTier: name }).vector(namespace); },
    };
  };
  const defaultView = tier(resolvedDefault);
  return {
    scope, tier: resolvedDefault, at: tier,
    kv(tierOrNamespace: string, namespace?: string): SyncStore {
      return namespace === undefined ? defaultView.kv(tierOrNamespace) : tier(tierOrNamespace as ScopeName).kv(namespace);
    },
    vector(tierOrNamespace: string, namespace?: string): VectorStore {
      return namespace === undefined ? defaultView.vector(tierOrNamespace) : tier(tierOrNamespace as ScopeName).vector(namespace);
    },
  };
}

function physicalDbPath(requested: string): string {
  mkdirSync(dirname(requested), { recursive: true });
  const parent = canonicalPath(dirname(requested));
  const candidate = join(parent, basename(requested));
  return existsSync(candidate) ? canonicalPath(candidate) : candidate;
}

function registry(): Map<string, PoolEntry> {
  const symbol = Symbol.for("gonk.host-storage.v1");
  const global = globalThis as typeof globalThis & { [key: symbol]: Map<string, PoolEntry> | undefined };
  return global[symbol] ??= new Map();
}
