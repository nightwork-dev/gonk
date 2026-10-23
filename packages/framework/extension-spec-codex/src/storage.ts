import {
  acquireHostStorage,
  type AcquireBoundHostStorageOptions,
  type AcquireHostStorageOptions,
  type HostBoundStorageLease,
  type HostStorageLease,
  type HostStoragePolicy,
} from "@gonk/store/host-storage";
import type { ScopeEnvironment, ScopeStore } from "@gonk/scope";

/** The Codex host shares Pi's established project-owned authority for portable
 * jobs and comms. This mapping belongs to the host, never to a capability. */
export type CodexStorageConsumer = "jobs" | "comms";

const CODEX_STORAGE_POLICY: HostStoragePolicy<CodexStorageConsumer> = {
  layout: { jobs: "pi-flat", comms: "pi-tiered" },
};

export type CodexStorageLease = HostStorageLease;
export type CodexBoundStorageLease = HostBoundStorageLease;

export interface AcquireCodexStorageOptions extends Omit<AcquireHostStorageOptions<CodexStorageConsumer>, "policy"> {
  env: ScopeEnvironment;
}
export interface AcquireBoundCodexStorageOptions extends Omit<AcquireBoundHostStorageOptions<CodexStorageConsumer>, "policy"> {
  scope: ScopeStore;
}

export function acquireCodexStorage(options: AcquireBoundCodexStorageOptions): CodexBoundStorageLease;
export function acquireCodexStorage(options: AcquireCodexStorageOptions): CodexStorageLease;
export function acquireCodexStorage(options: AcquireCodexStorageOptions): CodexStorageLease {
  return acquireHostStorage({ ...options, policy: CODEX_STORAGE_POLICY });
}
