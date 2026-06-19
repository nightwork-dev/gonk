import { shape, type ToolDefinition, type ToolResult } from "@gonk/tool-registry";

import { explainTool, type ExplainResult } from "./explain.ts";
import type { Orchestrator } from "./types.ts";

export { explainTool } from "./explain.ts";
export type { ExplainResult, ToolExplainRecord } from "./explain.ts";

// =============================================================================
// Schemas — built with `shape()` from @gonk/tool-registry/shape so we
// don't have to depend on a schema library for these six meta-tools.
// =============================================================================

const isOptionalString = (v: unknown): v is string | undefined =>
  v === undefined || typeof v === "string";

// =============================================================================
// Schemas
// =============================================================================

interface ListInput {
  category?: string;
  tag?: string;
  visibility?: "always" | "on-demand";
}

const listInputSchema = shape<ListInput>(
  (v): v is ListInput => {
    if (!v || typeof v !== "object") return v === undefined;
    const o = v as Record<string, unknown>;
    return (
      isOptionalString(o.category) &&
      isOptionalString(o.tag) &&
      (o.visibility === undefined || o.visibility === "always" || o.visibility === "on-demand")
    );
  },
  "expected { category?, tag?, visibility? }",
);

interface FindInput {
  query: string;
  limit?: number;
}

const findInputSchema = shape<FindInput>(
  (v): v is FindInput => {
    if (!v || typeof v !== "object") return false;
    const o = v as Record<string, unknown>;
    return typeof o.query === "string" && (o.limit === undefined || typeof o.limit === "number");
  },
  "expected { query: string, limit?: number }",
);

interface NameOnlyInput {
  name: string;
}

const nameOnlySchema = shape<NameOnlyInput>(
  (v): v is NameOnlyInput =>
    !!v && typeof v === "object" && typeof (v as { name?: unknown }).name === "string",
  "expected { name: string }",
);

// =============================================================================
// Meta-tool factory
// =============================================================================

export function metaTools(orch: Orchestrator): ToolDefinition[] {
  const list: ToolDefinition<ListInput, { tools: ToolSummary[] }> = {
    name: "list_tools",
    description:
      "List all tools known to the orchestrator. Optionally filter by category, tag, or visibility.",
    visibility: "always",
    category: "meta",
    tags: ["meta", "discovery"],
    input: listInputSchema,
    hints: {
      pi: { piName: "list_tools" },
      mcp: { annotations: { readOnly: true, idempotent: true } },
    },
    handler: async (input) => {
      const all = orch.allTools();
      const filtered = all.filter((t) => {
        if (input.category && t.category !== input.category) return false;
        if (input.tag && !(t.tags ?? []).includes(input.tag)) return false;
        if (input.visibility) {
          if (orch.visibilityOf(t.name) !== input.visibility) return false;
        }
        return true;
      });
      const tools = filtered.map(summarize);
      return { data: { tools }, display: renderList(tools) } satisfies ToolResult;
    },
  };

  const find: ToolDefinition<FindInput, { results: RankedSummary[] }> = {
    name: "find_tools",
    description: "Search tools by keyword, tag, or name. Uses BM25 ranking weighted by name (3×), category (2×), and description/tags/keywords (1×). Returns ranked matches.",
    visibility: "always",
    category: "meta",
    tags: ["meta", "discovery", "search"],
    input: findInputSchema,
    hints: {
      pi: { piName: "find_tools" },
      mcp: { annotations: { readOnly: true, idempotent: true } },
    },
    handler: async (input) => {
      const ranked = orch.search(input.query, input.limit !== undefined ? { limit: input.limit } : {});
      const results: RankedSummary[] = ranked.map((r) => ({
        ...summarize(r.tool),
        score: r.score,
        reason: r.reason ?? "",
      }));
      return { data: { results }, display: renderRanked(results) } satisfies ToolResult;
    },
  };

  const get: ToolDefinition<NameOnlyInput, { tool: ToolDetail | null }> = {
    name: "get_tool",
    description: "Get full schema and metadata for a single tool by name.",
    visibility: "always",
    category: "meta",
    tags: ["meta", "discovery"],
    input: nameOnlySchema,
    hints: {
      pi: { piName: "get_tool" },
      mcp: { annotations: { readOnly: true, idempotent: true } },
    },
    handler: async (input) => {
      const all = orch.allTools().find((t) => t.name === input.name);
      if (!all) return { data: { tool: null }, display: `No such tool: ${input.name}` };
      const detail = detailize(all, orch.visibilityOf(all.name));
      return {
        data: { tool: detail },
        display: [{ type: "json", value: detail, caption: input.name }],
      } satisfies ToolResult;
    },
  };

  const load: ToolDefinition<NameOnlyInput, { queued: string }> = {
    name: "load_tool",
    description:
      "Pin a tool so it becomes available in the active set. Takes effect at the next turn boundary or compaction.",
    visibility: "always",
    category: "meta",
    tags: ["meta", "pin"],
    input: nameOnlySchema,
    hints: {
      pi: { piName: "load_tool" },
      mcp: { annotations: { readOnly: false, idempotent: true } },
    },
    handler: async (input) => {
      if (!orch.allTools().some((t) => t.name === input.name)) {
        return { data: { queued: "" }, display: `No such tool: ${input.name}` };
      }
      orch.pin(input.name);
      return {
        data: { queued: input.name },
        display: `Queued ${input.name} for activation. Active after next commit.`,
      } satisfies ToolResult;
    },
  };

  const unload: ToolDefinition<NameOnlyInput, { queued: string }> = {
    name: "unload_tool",
    description: "Unpin a previously pinned tool. Takes effect at the next commit.",
    visibility: "always",
    category: "meta",
    tags: ["meta", "pin"],
    input: nameOnlySchema,
    hints: {
      pi: { piName: "unload_tool" },
      mcp: { annotations: { readOnly: false, idempotent: true } },
    },
    handler: async (input) => {
      orch.unpin(input.name);
      return {
        data: { queued: input.name },
        display: `Queued unpin of ${input.name}.`,
      } satisfies ToolResult;
    },
  };

  // ---- tool_explain -------------------------------------------------------
  //
  // Structured introspection for a single tool by name. Surfaces every
  // ToolDefinition field an agent might care about — description, category,
  // visibility, cost, latency, capabilities, hints, inputJsonSchema — so
  // agents can answer "what is this tool?" without grepping descriptions.
  //
  // Distinct from `get_tool` (which returns a curated subset for human
  // listings); `tool_explain` returns the full machine-friendly record
  // including `cost`/`latency`/`hints`/`inputJsonSchema`.

  const explain: ToolDefinition<NameOnlyInput, ExplainResult> = {
    name: "tool_explain",
    description:
      "Return a structured record about an installed tool by name: description, category, visibility, cost class, latency class, capabilities, hints, and inputJsonSchema. Use to answer 'what does this tool do, what does it cost, and what's its input shape?' without reading source.",
    visibility: "on-demand",
    category: "meta",
    cost: "low",
    latency: "instant",
    tags: ["meta", "discovery", "introspection"],
    keywords: ["explain", "describe", "introspect", "schema"],
    input: nameOnlySchema,
    inputJsonSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, description: "Tool name to explain." },
      },
      required: ["name"],
      additionalProperties: false,
    },
    handler: async (input) => {
      const t = orch.allTools().find((x) => x.name === input.name);
      if (!t) {
        return {
          data: { error: "TOOL_NOT_FOUND" } as ExplainResult,
          display: `No such tool: ${input.name}`,
        } satisfies ToolResult;
      }
      const record = explainTool(t, orch.visibilityOf(t.name));
      return {
        data: record,
        display: [{ type: "json", value: record, caption: t.name }],
      } satisfies ToolResult;
    },
  };

  return [list, find, get, load, unload, explain] as ToolDefinition[];
}

// =============================================================================
// Display helpers
// =============================================================================

interface ToolSummary {
  name: string;
  description: string;
  category?: string;
  visibility: string;
  tags?: string[];
}

interface RankedSummary extends ToolSummary {
  score: number;
  reason: string;
}

interface ToolDetail extends ToolSummary {
  capabilities?: ToolDefinition["capabilities"];
  keywords?: string[];
  relatedTo?: string[];
}

function summarize(t: ToolDefinition): ToolSummary {
  const out: ToolSummary = {
    name: t.name,
    description: t.description,
    visibility: t.visibility ?? "on-demand",
  };
  if (t.category !== undefined) out.category = t.category;
  if (t.tags !== undefined) out.tags = t.tags;
  return out;
}

function detailize(t: ToolDefinition, effectiveVisibility: string): ToolDetail {
  const out: ToolDetail = {
    name: t.name,
    description: t.description,
    visibility: effectiveVisibility,
  };
  if (t.category !== undefined) out.category = t.category;
  if (t.tags !== undefined) out.tags = t.tags;
  if (t.keywords !== undefined) out.keywords = t.keywords;
  if (t.relatedTo !== undefined) out.relatedTo = t.relatedTo;
  if (t.capabilities !== undefined) out.capabilities = t.capabilities;
  return out;
}

function renderList(tools: ToolSummary[]): string {
  if (!tools.length) return "_(no tools matched)_";
  const byCategory = new Map<string, ToolSummary[]>();
  for (const t of tools) {
    const cat = t.category ?? "(uncategorized)";
    const bucket = byCategory.get(cat) ?? [];
    bucket.push(t);
    byCategory.set(cat, bucket);
  }
  const lines: string[] = [];
  for (const [cat, bucket] of byCategory) {
    lines.push(`### ${cat}`);
    for (const t of bucket) {
      lines.push(`- **${t.name}** _(${t.visibility})_ — ${t.description}`);
    }
  }
  return lines.join("\n");
}

function renderRanked(results: RankedSummary[]): string {
  if (!results.length) return "_(no matches)_";
  return results
    .map((r) => `- **${r.name}** _(score ${r.score})_ — ${r.description}`)
    .join("\n");
}
