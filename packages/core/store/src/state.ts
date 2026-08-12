import { namespaceStore } from "@mirk/store";
import type { SyncStore } from "@mirk/store";
import type {
  VectorDocument,
  VectorSearchOptions,
  VectorSearchResult,
  Vector,
  VectorStore,
} from "@mirk/store/vector";
import type { ScopeName, ScopeStore } from "@gonk/scope";

/** A host-owned source of synchronous Mirk state.
 *
 * The source owns adapter selection, credentials, lifecycle, and close. Gonk
 * only asks for the port for a scope tier and applies a logical namespace.
 */
export interface GonkSyncStateSource {
  kv(tier: ScopeName): SyncStore;
  vector?(tier: ScopeName): VectorStore;
}

export interface GonkStateBindingOptions {
  /** Tier used by the short `state.kv("namespace")` convenience. */
  defaultTier?: ScopeName;
}

/** A namespace-bound view of a host-provided synchronous Mirk source. */
export interface GonkSyncStateTier {
  readonly tier: ScopeName;
  kv(namespace: string): SyncStore;
  vector(namespace: string): VectorStore;
}

/** Scope-bound synchronous capability state.
 *
 * `at(tier)` is the explicit form. The one-argument `kv` and `vector` methods
 * use `defaultTier` (global unless configured), while the two-argument forms
 * select a tier directly. All returned ports are Mirk ports; this module adds
 * only key/collection namespace binding and does not define another CRUD SPI.
 */
export interface GonkSyncState extends GonkSyncStateTier {
  readonly scope: ScopeStore;
  at(tier: ScopeName): GonkSyncStateTier;
  kv(namespace: string): SyncStore;
  kv(tier: ScopeName, namespace: string): SyncStore;
  vector(namespace: string): VectorStore;
  vector(tier: ScopeName, namespace: string): VectorStore;
}

const DEFAULT_TIER: ScopeName = "global";
const NAMESPACE_SEPARATOR = "\u001f";

/** Bind Gonk scope and logical namespaces to caller-provided Mirk ports.
 *
 * The source is mandatory. No filesystem adapter, path, native database, or
 * fallback provider is selected here. The default tier is resolved eagerly so
 * missing state configuration fails at construction rather than at the first
 * capability write.
 */
export function bindGonkSyncState(
  scope: ScopeStore,
  source: GonkSyncStateSource,
  options: GonkStateBindingOptions = {},
): GonkSyncState {
  assertScope(scope);
  assertSyncSource(source);
  const defaultTier = options.defaultTier ?? DEFAULT_TIER;
  const tiers = new Map<ScopeName, GonkSyncStateTier>();

  const tierFor = (tier: ScopeName): GonkSyncStateTier => {
    const existing = tiers.get(tier);
    if (existing) return existing;

    // Resolve once per tier. The host may memoize a source port, but the
    // binding must not repeatedly ask it for an adapter or alter its lifecycle.
    const kvSource = requireSyncKv(source.kv(tier), tier);
    let vectorSource: VectorStore | undefined;
    let vectorLoaded = false;
    const kvByNamespace = new Map<string, SyncStore>();
    const vectorByNamespace = new Map<string, VectorStore>();
    const tierView: GonkSyncStateTier = {
      tier,
      kv(namespace: string): SyncStore {
        assertNamespace(namespace);
        const cached = kvByNamespace.get(namespace);
        if (cached) return cached;
        const bound = namespaceStore(kvSource, namespace);
        kvByNamespace.set(namespace, bound);
        return bound;
      },
      vector(namespace: string): VectorStore {
        assertNamespace(namespace);
        if (!vectorLoaded) {
          vectorLoaded = true;
          vectorSource = source.vector?.(tier);
        }
        if (!vectorSource) {
          throw new Error(
            `Gonk state vector capability is not configured for tier '${tier}'. Provide source.vector(tier) before requesting namespace '${namespace}'.`,
          );
        }
        const cached = vectorByNamespace.get(namespace);
        if (cached) return cached;
        const bound = namespaceVectorStore(vectorSource, namespace);
        vectorByNamespace.set(namespace, bound);
        return bound;
      },
    };
    tiers.set(tier, tierView);
    return tierView;
  };

  const defaultView = tierFor(defaultTier);
  return makeSyncState(scope, defaultView, tierFor);
}

function makeSyncState(
  scope: ScopeStore,
  defaultView: GonkSyncStateTier,
  tierFor: (tier: ScopeName) => GonkSyncStateTier,
): GonkSyncState {
  const state: GonkSyncState = {
    scope,
    tier: defaultView.tier,
    at: tierFor,
    kv(namespaceOrTier: string, namespace?: string): SyncStore {
      return namespace === undefined
        ? defaultView.kv(namespaceOrTier)
        : tierFor(namespaceOrTier as ScopeName).kv(namespace);
    },
    vector(namespaceOrTier: string, namespace?: string): VectorStore {
      return namespace === undefined
        ? defaultView.vector(namespaceOrTier)
        : tierFor(namespaceOrTier as ScopeName).vector(namespace);
    },
  };
  return state;
}

function assertScope(scope: ScopeStore): void {
  if (!scope || typeof scope !== "object") {
    throw new Error("Gonk state binding requires a ScopeStore");
  }
}

function assertSyncSource(source: GonkSyncStateSource): void {
  if (!source || typeof source !== "object" || typeof source.kv !== "function") {
    throw new Error("Gonk sync state binding requires a caller-provided Mirk source with kv(tier)");
  }
}

function requireSyncKv(source: SyncStore, tier: ScopeName): SyncStore {
  if (!source || typeof source !== "object" || typeof source.get !== "function") {
    throw new Error(`Gonk sync state source returned no usable Mirk KV port for tier '${tier}'`);
  }
  return source;
}

function assertNamespace(namespace: string): void {
  if (!namespace || namespace.includes(NAMESPACE_SEPARATOR)) {
    throw new Error("Gonk state namespace must be non-empty and must not contain the unit separator");
  }
}

function scopedCollection(namespace: string, collection: string): string {
  return `${namespace}${NAMESPACE_SEPARATOR}${collection}`;
}

function namespaceVectorStore(base: VectorStore, namespace: string): VectorStore {
  return {
    meta: base.meta,
    upsert<M extends Record<string, unknown>>(collection: string, doc: VectorDocument<M>): void {
      base.upsert(scopedCollection(namespace, collection), doc);
    },
    upsertMany<M extends Record<string, unknown>>(
      collection: string,
      docs: ReadonlyArray<VectorDocument<M>>,
    ): void {
      base.upsertMany(scopedCollection(namespace, collection), docs);
    },
    get<M extends Record<string, unknown>>(collection: string, id: string): VectorDocument<M> | null {
      return base.get(scopedCollection(namespace, collection), id);
    },
    has(collection: string, id: string): boolean {
      return base.has(scopedCollection(namespace, collection), id);
    },
    remove(collection: string, id: string): boolean {
      return base.remove(scopedCollection(namespace, collection), id);
    },
    count(collection: string): number {
      return base.count(scopedCollection(namespace, collection));
    },
    search<M extends Record<string, unknown>>(
      collection: string,
      query: Vector,
      opts?: VectorSearchOptions,
    ): VectorSearchResult<M>[] {
      return base.search(scopedCollection(namespace, collection), query, opts);
    },
  };
}
