import {
  SCOPE_RESOLUTION_ORDER,
  type BlobHandle,
  type DocumentEntry,
  type ResolutionEntry,
  type RootBinding,
  type ScopeName,
  type ScopeStore,
  type SetOptions,
} from "./types.ts";

/** In-memory ScopeStore for testing. Single virtual root per tier (kind:
 *  "memory"). Multi-root semantics are exercised separately via FsScopeStore
 *  on a tmpdir. */
export class MemoryScopeStore implements ScopeStore {
  private readonly data = new Map<ScopeName, Map<string, unknown>>();
  private readonly blobs = new Map<ScopeName, Map<string, { data: Uint8Array; mimeType?: string }>>();
  private readonly enabled: Set<ScopeName>;
  private readonly docs = new Map<ScopeName, DocumentEntry[]>();

  constructor(enabledScopes: ScopeName[] = [...SCOPE_RESOLUTION_ORDER]) {
    this.enabled = new Set(enabledScopes);
    for (const s of enabledScopes) {
      this.data.set(s, new Map());
      this.blobs.set(s, new Map());
      this.docs.set(s, []);
    }
  }

  get<T = unknown>(key: string, scope?: ScopeName): T | undefined {
    if (scope) return this.data.get(scope)?.get(key) as T | undefined;
    for (const s of SCOPE_RESOLUTION_ORDER) {
      const m = this.data.get(s);
      if (m && m.has(key)) return m.get(key) as T;
    }
    return undefined;
  }

  set<T = unknown>(key: string, value: T, scope: ScopeName, _opts?: SetOptions): void {
    this.requireScope(scope);
    this.data.get(scope)!.set(key, value);
  }

  delete(key: string, scope: ScopeName, _opts?: SetOptions): void {
    this.data.get(scope)?.delete(key);
  }

  list(prefix: string, scope?: ScopeName): string[] {
    const seen = new Set<string>();
    const scopes = scope ? [scope] : SCOPE_RESOLUTION_ORDER;
    for (const s of scopes) {
      const m = this.data.get(s);
      if (!m) continue;
      for (const k of m.keys()) if (k.startsWith(prefix)) seen.add(k);
    }
    return Array.from(seen).sort();
  }

  resolve<T = unknown>(key: string): ResolutionEntry<T>[] {
    const out: ResolutionEntry<T>[] = [];
    for (const s of SCOPE_RESOLUTION_ORDER) {
      const m = this.data.get(s);
      if (m && m.has(key)) {
        out.push({ scope: s, rootKind: "memory", root: `memory://${s}`, value: m.get(key) as T });
      }
    }
    return out;
  }

  blob(key: string, scope?: ScopeName): BlobHandle | undefined {
    if (scope) return this.blobAt(key, scope);
    for (const s of SCOPE_RESOLUTION_ORDER) {
      const h = this.blobAt(key, s);
      if (h) return h;
    }
    return undefined;
  }

  async putBlob(
    key: string,
    data: Uint8Array,
    scope: ScopeName,
    opts?: SetOptions & { mimeType?: string },
  ): Promise<BlobHandle> {
    this.requireScope(scope);
    this.blobs.get(scope)!.set(key, { data, ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}) });
    return {
      scope,
      rootKind: "memory",
      root: `memory://${scope}`,
      key,
      path: `memory://${scope}/${key}`,
      size: data.byteLength,
      ...(opts?.mimeType ? { mimeType: opts.mimeType } : {}),
    };
  }

  async deleteBlob(key: string, scope: ScopeName, _opts?: SetOptions): Promise<void> {
    this.blobs.get(scope)?.delete(key);
  }

  async readBlob(key: string, scope?: ScopeName): Promise<Uint8Array | undefined> {
    const scopes = scope ? [scope] : SCOPE_RESOLUTION_ORDER;
    for (const s of scopes) {
      const e = this.blobs.get(s)?.get(key);
      if (e) return e.data;
    }
    return undefined;
  }

  documents(scope?: ScopeName): DocumentEntry[] {
    const out: DocumentEntry[] = [];
    const scopes = scope ? [scope] : SCOPE_RESOLUTION_ORDER;
    for (const s of scopes) out.push(...(this.docs.get(s) ?? []));
    return out;
  }

  available(): readonly ScopeName[] {
    return Array.from(this.enabled);
  }

  rootsAt(_scope: ScopeName): readonly RootBinding[] {
    return [];
  }

  /** In-memory store: no filesystem home. Consumers that need a writable base
   *  dir fall back to their own default (e.g. homedir()) when this is undefined. */
  home(_scope: ScopeName): string | undefined {
    return undefined;
  }

  /** Test helper — seed an ambient document at a tier. */
  seedDocument(entry: DocumentEntry): void {
    this.requireScope(entry.scope);
    this.docs.get(entry.scope)!.push(entry);
  }

  private blobAt(key: string, scope: ScopeName): BlobHandle | undefined {
    const e = this.blobs.get(scope)?.get(key);
    if (!e) return undefined;
    return {
      scope,
      rootKind: "memory",
      root: `memory://${scope}`,
      key,
      path: `memory://${scope}/${key}`,
      size: e.data.byteLength,
      ...(e.mimeType ? { mimeType: e.mimeType } : {}),
    };
  }

  private requireScope(scope: ScopeName): void {
    if (!this.enabled.has(scope)) {
      throw new Error(`Scope not available: ${scope}`);
    }
  }
}
