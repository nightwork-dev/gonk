import type {
  ToolDefinition,
  ToolEvent,
  ToolRegistry,
  ToolVisibility,
} from "@gonk/tool-registry";

import type {
  Orchestrator,
  OrchestratorOptions,
  PinDiff,
  RankedTool,
  RecommendationContext,
  Scope,
} from "./types.ts";

import { metaTools } from "./meta-tools.ts";
import { bm25Search } from "./bm25.ts";

interface InternalState {
  /** Committed pins, in commit order. */
  committed: string[];
  /** Tombstoned pins (committed then unpinned, awaiting next compaction). */
  tombstoned: Set<string>;
  /** Pending queues. */
  pendingAdd: string[];
  pendingRemove: string[];
  /** Last-used timestamps per tool. */
  used: Map<string, number>;
}

export function createOrchestrator(opts: OrchestratorOptions): Orchestrator {
  const state: InternalState = {
    committed: [],
    tombstoned: new Set(),
    pendingAdd: [],
    pendingRemove: [],
    used: new Map(),
  };

  const scope: Scope = opts.scope;
  const registries = opts.registries;
  const searchRanker = opts.search ?? bm25Search;
  const recommender = opts.recommend ?? defaultRecommend;

  // Eagerly load persisted pins if a store is provided.
  if (opts.pinStore) {
    const initial = opts.pinStore.load();
    if (Array.isArray(initial)) {
      state.committed = initial.slice();
    } else {
      initial.then((pins) => {
        state.committed = pins.slice();
      });
    }
  }

  function findTool(name: string): ToolDefinition | undefined {
    for (const r of registries) {
      const t = r.get(name);
      if (t) return t;
    }
    return undefined;
  }

  function findRegistry(name: string): ToolRegistry | undefined {
    for (const r of registries) {
      if (r.has(name)) return r;
    }
    return undefined;
  }

  function allToolsList(): ToolDefinition[] {
    const seen = new Map<string, ToolDefinition>();
    for (const r of registries) {
      for (const t of r.list()) {
        if (!seen.has(t.name)) seen.set(t.name, t);
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  function effectiveVisibility(t: ToolDefinition): ToolVisibility {
    const hint =
      scope === "mcp"
        ? t.hints?.mcp?.visibility
        : scope === "pi"
          ? t.hints?.pi?.visibility
          : undefined;
    return hint ?? t.visibility ?? "on-demand";
  }

  const orchestrator: Orchestrator = {
    allTools: allToolsList,

    activeSet() {
      const all = allToolsList();
      const always = all.filter((t) => effectiveVisibility(t) === "always");
      // already sorted by name from allToolsList
      const pinned: ToolDefinition[] = [];
      for (const name of state.committed) {
        if (state.tombstoned.has(name)) continue;
        const t = findTool(name);
        if (t && effectiveVisibility(t) !== "always") pinned.push(t);
      }
      return [...always, ...pinned];
    },

    visibilityOf(name) {
      const t = findTool(name);
      return t ? effectiveVisibility(t) : "on-demand";
    },

    search(query, options) {
      const tools = allToolsList();
      const ranked = searchRanker(query, tools);
      const limit = options?.limit ?? 20;
      return ranked.slice(0, limit);
    },

    recommend(ctx, options) {
      const tools = allToolsList();
      const ranked = recommender(ctx, tools);
      const limit = options?.limit ?? 5;
      return ranked.slice(0, limit);
    },

    pin(name) {
      // Cancel any pending unpin for this name.
      state.pendingRemove = state.pendingRemove.filter((n) => n !== name);
      // Already active and not tombstoned → nothing to do.
      if (state.committed.includes(name) && !state.tombstoned.has(name)) return;
      if (!state.pendingAdd.includes(name)) {
        state.pendingAdd.push(name);
      }
    },

    unpin(name) {
      // Drop from pending adds first.
      const idx = state.pendingAdd.indexOf(name);
      if (idx >= 0) {
        state.pendingAdd.splice(idx, 1);
        return;
      }
      if (state.committed.includes(name) && !state.pendingRemove.includes(name)) {
        state.pendingRemove.push(name);
      }
    },

    pendingPins() {
      return { add: state.pendingAdd.slice(), remove: state.pendingRemove.slice() };
    },

    committedPins() {
      return state.committed.filter((n) => !state.tombstoned.has(n));
    },

    async commitPins() {
      const added: string[] = [];
      const tombstoned: string[] = [];
      const unchanged = state.committed.filter((n) => !state.tombstoned.has(n));

      for (const name of state.pendingAdd) {
        if (!findTool(name)) continue;
        if (!state.committed.includes(name)) {
          state.committed.push(name);
          added.push(name);
        } else if (state.tombstoned.has(name)) {
          // Resurrecting a tombstone — leave the slot in place.
          state.tombstoned.delete(name);
          added.push(name);
        }
      }

      for (const name of state.pendingRemove) {
        if (state.committed.includes(name) && !state.tombstoned.has(name)) {
          state.tombstoned.add(name);
          tombstoned.push(name);
        }
      }

      state.pendingAdd = [];
      state.pendingRemove = [];

      // After tombstones reach the next compaction boundary, an adapter may
      // choose to call .reapTombstones() (not yet implemented; left as an
      // explicit action). For now tombstones persist until process restart.

      if (opts.pinStore) {
        await opts.pinStore.save(state.committed);
      }

      const diff: PinDiff = { added, tombstoned, unchanged };
      return diff;
    },

    markUsed(name) {
      state.used.set(name, Date.now());
    },

    usedSince(timestamp) {
      const out: string[] = [];
      for (const [name, t] of state.used) {
        if (t >= timestamp) out.push(name);
      }
      return out;
    },

    invoke(name, input, ctx) {
      const r = findRegistry(name);
      if (!r) {
        return notFoundStream(name);
      }
      orchestrator.markUsed(name);
      return r.invoke(name, input, ctx);
    },
  };

  // Auto-register meta-tools.
  if (opts.registerMetaTools !== false && registries[0]) {
    const meta = metaTools(orchestrator);
    // Inject into the first registry — they're regular ToolDefinitions and
    // discoverable via allTools().
    registries[0].register(meta, { overwrite: true });
  }

  return orchestrator;
}

async function* notFoundStream(name: string): AsyncIterable<ToolEvent> {
  yield { type: "error", code: "TOOL_NOT_FOUND", message: `No such tool: ${name}` };
}

// =============================================================================
// Default rankers
// =============================================================================

export function legacySubstringSearch(query: string, tools: ToolDefinition[]): RankedTool[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const terms = q.split(/\s+/);

  const ranked: RankedTool[] = [];
  for (const tool of tools) {
    const haystack = [
      tool.name,
      tool.description,
      tool.category ?? "",
      ...(tool.tags ?? []),
      ...(tool.keywords ?? []),
    ]
      .join(" ")
      .toLowerCase();

    let score = 0;
    const reasons: string[] = [];

    for (const term of terms) {
      if (tool.name.toLowerCase() === term) {
        score += 10;
        reasons.push("exact-name");
      } else if (tool.name.toLowerCase().includes(term)) {
        score += 5;
        reasons.push("name");
      }
      if ((tool.tags ?? []).some((t) => t.toLowerCase() === term)) {
        score += 3;
        reasons.push("tag");
      }
      if ((tool.keywords ?? []).some((k) => k.toLowerCase().includes(term))) {
        score += 2;
        reasons.push("keyword");
      }
      if (haystack.includes(term)) {
        score += 1;
      }
    }

    if (score > 0) {
      ranked.push({ tool, score, reason: Array.from(new Set(reasons)).join(",") });
    }
  }
  ranked.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return ranked;
}

function defaultRecommend(
  ctx: RecommendationContext,
  tools: ToolDefinition[],
): RankedTool[] {
  const text = (ctx.recentText ?? []).join(" ").toLowerCase();
  if (!text.trim()) return [];
  const active = new Set(ctx.activeTools ?? []);

  const ranked: RankedTool[] = [];
  for (const tool of tools) {
    if (active.has(tool.name)) continue;
    let score = 0;
    for (const kw of tool.keywords ?? []) {
      if (text.includes(kw.toLowerCase())) score += 2;
    }
    for (const tag of tool.tags ?? []) {
      if (text.includes(tag.toLowerCase())) score += 1;
    }
    if (score > 0) ranked.push({ tool, score });
  }
  ranked.sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return ranked;
}
