import type { ScopeStore } from "@gonk/scope";

import { createStore, resolveStoreDir, type CreateStoreOptions } from "./factory.ts";
import { MirkStoreBackend } from "./mirk-backend.ts";
import type { BackendFactory, Store } from "./types.ts";

/** Central, explicit store construction surface for hosts. A provider is a
 *  `Store`, so consumers that already accept an injected `Store` can receive it
 *  unchanged. */
export interface StoreProvider extends Store {}

/** Build a central store provider for a bound scope. Backend selection remains
 *  explicit: pass `opts.backendFactory` to choose a non-default backend. With no
 *  options this delegates to `createStore(scope)` and keeps the existing fs
 *  backend behavior. */
export function createStoreProvider(scope: ScopeStore, opts?: CreateStoreOptions): StoreProvider {
  return createStore(scope, opts);
}

/** Convenience factory for hosts that want the Mirk sqlite backend without
 *  assembling store paths themselves. */
export function mirkBackendFactory(scope: ScopeStore): BackendFactory {
  return (tier, namespace) => new MirkStoreBackend(resolveStoreDir(scope, tier, namespace));
}
