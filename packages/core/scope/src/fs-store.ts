import { mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  bindRoots,
  resolveTierHomes,
  scanDocuments,
} from "./resolver.ts";
import {
  SCOPE_RESOLUTION_ORDER,
  type BlobHandle,
  type DocumentEntry,
  type ResolutionEntry,
  type RootBinding,
  type ScopeEnvironment,
  type ScopeName,
  type ScopeStore,
  type SetOptions,
} from "./types.ts";

interface TierBinding {
  scope: ScopeName;
  /** Canonical scope home dir. */
  home: string;
  /** Roots inside the home, broad→narrow. */
  roots: RootBinding[];
}

/** Filesystem-backed multi-root ScopeStore. Each tier's data is the union of
 *  all known roots within its scope home, plus ambient docs at the home. */
export class FsScopeStore implements ScopeStore {
  private readonly tiers: Map<ScopeName, TierBinding>;
  private readonly tierHomes: Map<ScopeName, string>;

  constructor(private readonly env: ScopeEnvironment) {
    this.tiers = new Map();
    const homes = resolveTierHomes(env);
    this.tierHomes = homes;
    // Dedupe across tiers via canonical paths — if `directory` and `project`
    // resolve to the same dir (symlink, or cwd === project root), the
    // narrower tier wins and the broader is dropped.
    const seenHomes = new Set<string>();
    for (const scope of SCOPE_RESOLUTION_ORDER) {
      const home = homes.get(scope);
      if (!home) continue;
      if (seenHomes.has(home)) continue;
      seenHomes.add(home);
      this.tiers.set(scope, {
        scope,
        home,
        roots: bindRoots(home, env),
      });
    }
  }

  // ---- Settings ------------------------------------------------------------

  get<T = unknown>(key: string, scope?: ScopeName): T | undefined {
    if (scope) {
      const tier = this.tiers.get(scope);
      if (!tier) return undefined;
      // Within a tier: walk roots broad→narrow. For plain-object values,
      // shallow-merge each root's contribution with narrower entries
      // overriding per-sub-key — lets `voice.tts.providers` accumulate
      // entries from `.agents/`, `.claude/`, etc., instead of clobbering.
      // Non-object values (scalars, arrays) use last-found-wins.
      let found: T | undefined;
      let accumMerged: Record<string, unknown> | undefined;
      for (const r of tier.roots) {
        const v = r.adapter.readSetting(key);
        if (v === undefined) continue;
        if (isPlainObject(v)) {
          accumMerged = { ...(accumMerged ?? {}), ...v };
          found = accumMerged as T;
        } else {
          // Scalar or array — replaces any prior, including a partial merge.
          accumMerged = undefined;
          found = v as T;
        }
      }
      return found;
    }
    // Across tiers: walk most→least specific, return first match.
    for (const s of SCOPE_RESOLUTION_ORDER) {
      const v = this.get<T>(key, s);
      if (v !== undefined) return v;
    }
    return undefined;
  }

  set<T = unknown>(key: string, value: T, scope: ScopeName, opts?: SetOptions): void {
    const root = this.pickWriteRoot(scope, opts);
    root.adapter.writeSetting(key, value);
  }

  delete(key: string, scope: ScopeName, opts?: SetOptions): void {
    const tier = this.tiers.get(scope);
    if (!tier) return;
    if (opts?.kind) {
      const r = tier.roots.find((x) => x.kind === opts.kind);
      r?.adapter.deleteSetting(key);
      return;
    }
    // Without a kind, delete from every root that has the key.
    for (const r of tier.roots) {
      if (r.adapter.readSetting(key) !== undefined) {
        r.adapter.deleteSetting(key);
      }
    }
  }

  list(prefix: string, scope?: ScopeName): string[] {
    const seen = new Set<string>();
    const scopes = scope ? [scope] : SCOPE_RESOLUTION_ORDER;
    for (const s of scopes) {
      const tier = this.tiers.get(s);
      if (!tier) continue;
      for (const r of tier.roots) {
        for (const k of r.adapter.listSettings(prefix)) seen.add(k);
      }
    }
    return Array.from(seen).sort();
  }

  resolve<T = unknown>(key: string): ResolutionEntry<T>[] {
    const out: ResolutionEntry<T>[] = [];
    for (const s of SCOPE_RESOLUTION_ORDER) {
      const tier = this.tiers.get(s);
      if (!tier) continue;
      for (const r of tier.roots) {
        const v = r.adapter.readSetting(key);
        if (v !== undefined) {
          out.push({ scope: s, rootKind: r.kind, root: r.path, value: v as T });
        }
      }
    }
    return out;
  }

  // ---- Blobs ---------------------------------------------------------------

  blob(key: string, scope?: ScopeName): BlobHandle | undefined {
    if (scope) {
      const tier = this.tiers.get(scope);
      if (!tier) return undefined;
      let found: BlobHandle | undefined;
      for (const r of tier.roots) {
        const h = r.adapter.blobHandle(key, scope);
        if (h) found = h;
      }
      return found;
    }
    for (const s of SCOPE_RESOLUTION_ORDER) {
      const h = this.blob(key, s);
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
    const root = this.pickWriteRoot(scope, opts);
    const writeOpts = opts?.mimeType !== undefined ? { mimeType: opts.mimeType } : undefined;
    const handle = await root.adapter.writeBlob(key, data, writeOpts);
    // Adapters return scope: "global" placeholder; rewrite with real tier.
    return { ...handle, scope };
  }

  async deleteBlob(key: string, scope: ScopeName, opts?: SetOptions): Promise<void> {
    const tier = this.tiers.get(scope);
    if (!tier) return;
    if (opts?.kind) {
      const r = tier.roots.find((x) => x.kind === opts.kind);
      if (r) await r.adapter.deleteBlob(key);
      return;
    }
    for (const r of tier.roots) {
      await r.adapter.deleteBlob(key);
    }
  }

  async readBlob(key: string, scope?: ScopeName): Promise<Uint8Array | undefined> {
    const handle = this.blob(key, scope);
    if (!handle) return undefined;
    const tier = this.tiers.get(handle.scope);
    const root = tier?.roots.find((r) => r.kind === handle.rootKind && r.path === handle.root);
    if (!root) return undefined;
    return root.adapter.readBlob(key);
  }

  // ---- Documents -----------------------------------------------------------

  documents(scope?: ScopeName): DocumentEntry[] {
    const out: DocumentEntry[] = [];
    const scopes = scope ? [scope] : SCOPE_RESOLUTION_ORDER;
    for (const s of scopes) {
      const tier = this.tiers.get(s);
      if (!tier) continue;
      // Ambient docs at the scope home itself
      out.push(...scanDocuments(tier.home, s));
      // Plus docs inside each root (e.g., .claude/AGENTS.md)
      for (const r of tier.roots) {
        out.push(...scanDocuments(r.path, s, r.path));
      }
    }
    return out;
  }

  // ---- Introspection -------------------------------------------------------

  available(): readonly ScopeName[] {
    return Array.from(this.tiers.keys());
  }

  rootsAt(scope: ScopeName): readonly RootBinding[] {
    return this.tiers.get(scope)?.roots ?? [];
  }

  home(scope: ScopeName): string | undefined {
    // Resolution dedupes colliding tier homes so the same documents and roots
    // are not read twice. Operational state still belongs to the requested
    // tier, however, so retain its resolved home even when a narrower tier
    // claimed the same canonical directory.
    return this.tierHomes.get(scope);
  }

  // ---- Internals -----------------------------------------------------------

  /** Pick a root to write to. Priority:
   *    1. Explicit `opts.kind` matching a bound root
   *    2. `.agents/` or `agents/` if bound (preferred default for new writes —
   *       open AGENTS.md convention, co-habitates with every other tool)
   *    3. Narrowest existing root at the tier (last in broad→narrow)
   *    4. Throw — caller must specify or create a root first
   *  We never silently create any root the user didn't opt into. */
  private pickWriteRoot(scope: ScopeName, opts?: SetOptions): RootBinding {
    const tier = this.tiers.get(scope);
    if (!tier) throw new Error(`Scope tier not bound: ${scope}`);

    if (opts?.kind) {
      const explicit = tier.roots.find((r) => r.kind === opts.kind);
      if (explicit) return explicit;
      throw new Error(
        `Root '${opts.kind}' is not bound at ${scope} scope. Create it (e.g. \`mkdir ${tier.home}/${opts.kind}\`) and reload.`,
      );
    }

    if (tier.roots.length === 0) {
      // No conventional root exists in this tier's home yet — create one rather
      // than failing the write. Prefer `.agents` (the open AGENTS.md convention
      // this store already reads first). This auto-mounts the storage target for
      // e.g. a persona whose home predates root scaffolding.
      mkdirSync(join(tier.home, ".agents"), { recursive: true });
      tier.roots = bindRoots(tier.home, this.env);
      if (tier.roots.length === 0) {
        throw new Error(
          `Could not create a writable root at ${scope} scope (home ${tier.home}). Pass opts.kind explicitly.`,
        );
      }
    }

    // Prefer .agents/ then agents/ if bound — open convention, every other
    // AGENTS.md-aware tool can read what we write there.
    const dotAgents = tier.roots.find((r) => r.kind === ".agents");
    if (dotAgents) return dotAgents;
    const agents = tier.roots.find((r) => r.kind === "agents");
    if (agents) return agents;

    // Fall back to narrowest existing root (last in broad→narrow).
    return tier.roots[tier.roots.length - 1]!;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Convenience factory. */
export function createScope(env: ScopeEnvironment): ScopeStore {
  return new FsScopeStore(env);
}

/** Eagerly create the chosen root directory for a tier. Useful when an adapter
 *  wants to provide a "first-time setup" experience that creates `.gonk/` (or
 *  any other kind) at a tier home so subsequent writes have somewhere to go. */
export function ensureRoot(
  env: ScopeEnvironment,
  scope: ScopeName,
  kind: string,
): string | undefined {
  const homes = resolveTierHomes(env);
  const home = homes.get(scope);
  if (!home) return undefined;
  const path = `${home}/${kind}`;
  mkdirSync(path, { recursive: true });
  return path;
}
