import {
  acquireHostStorage,
  resolveHostRuntimeRoot,
  type AcquireBoundHostStorageOptions,
  type AcquireHostStorageOptions,
  type HostBoundStorageLease,
  type HostStorageLease,
  type HostStoragePolicy,
} from "@gonk/store/host-storage";
import type { ScopeEnvironment, ScopeName, ScopeStore } from "@gonk/scope";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Pi's host-owned compatibility policy. Consumers only name their capability;
 * the shared host-storage primitive owns paths, adapters, pooling, and leases. */
export type PiStorageConsumer =
  | "memory" | "persona" | "knowing" | "introspect" | "probe"
  | "autotune" | "image" | "jobs" | "persist" | "rlm" | "comms"
  | "curator" | "handoff" | "reflector" | "subagent" | "work-items" | "skill-creator";

const PI_STORAGE_POLICY: HostStoragePolicy<PiStorageConsumer> = {
  layout: {
    memory: "memory", persona: "memory", knowing: "memory", introspect: "memory", probe: "memory",
    autotune: "pi-flat", image: "pi-flat", jobs: "pi-flat", persist: "pi-flat", rlm: "pi-flat",
    comms: "pi-tiered", curator: "pi-tiered", handoff: "pi-tiered", reflector: "pi-tiered",
    subagent: "pi-tiered", "work-items": "pi-tiered", "skill-creator": "skills",
  },
  allowUnboundMemoryFor: new Set(["skill-creator"]),
};

export type PiStorageSource = HostStorageLease["source"];
export type PiStorageLease = HostStorageLease;
export type PiBoundStorageLease = HostBoundStorageLease;

export interface AcquirePiStorageOptions extends Omit<AcquireHostStorageOptions<PiStorageConsumer>, "policy"> {
  env: ScopeEnvironment;
}
export interface AcquireBoundPiStorageOptions extends Omit<AcquireBoundHostStorageOptions<PiStorageConsumer>, "policy"> {
  scope: ScopeStore;
}

export function acquirePiStorage(options: AcquireBoundPiStorageOptions): PiBoundStorageLease;
export function acquirePiStorage(options: AcquirePiStorageOptions): PiStorageLease;
export function acquirePiStorage(options: AcquirePiStorageOptions): PiStorageLease {
  return acquireHostStorage({ ...options, policy: PI_STORAGE_POLICY });
}

/** Autotune keeps its cross-process `wx` claim algorithm, but Pi's host policy
 * decides its compatibility location. */
export function resolvePiAutotuneClaimsDir(scope: ScopeStore, tier: ScopeName): string {
  const home = scope.home(tier);
  if (!home) throw new Error(`Pi autotune claims have no configured home for tier '${tier}'`);
  const legacy = join(home, ".gonk", "autotune-claims");
  if (existsSync(legacy)) return legacy;
  return join(resolveHostRuntimeRoot(tier, home), tier, "autotune-claims");
}
