/**
 * Tool-explain projection: pure function that maps a `ToolDefinition` (plus a
 * resolved effective visibility) into the structured record exposed by the
 * `tool_explain` agent tool.
 *
 * Lifted out of `meta-tools.ts` so non-orchestrator hosts (Pi extensions,
 * MCP wrappers) can produce the same shape without instantiating an
 * Orchestrator. The Orchestrator-side meta-tool calls this after looking up
 * the ToolDefinition via its multi-registry search; the Pi-side
 * `tool_explain` agent tool calls it after looking up the ToolDefinition via
 * the process-wide gonk tool registry exposed by `@gonk/tool-registry-pi`.
 *
 * Visibility is passed in (not derived) because effective visibility depends
 * on per-adapter hints + scope, which the caller resolves with whatever
 * mechanism it has (orchestrator.visibilityOf, raw-hint inspection, etc.).
 */

import type { ToolDefinition, ToolVisibility } from "@gonk/tool-registry";

/** Full structured record returned by `tool_explain`. Mirrors the
 *  ToolDefinition shape an agent might care about — every introspectable
 *  field of the registered tool. */
export interface ToolExplainRecord {
  name: string;
  description: string;
  visibility: string;
  category?: string;
  cost?: ToolDefinition["cost"];
  latency?: ToolDefinition["latency"];
  tags?: string[];
  keywords?: string[];
  relatedTo?: string[];
  capabilities?: ToolDefinition["capabilities"];
  hints?: ToolDefinition["hints"];
  inputJsonSchema?: Record<string, unknown>;
}

/** Result wire shape for `tool_explain`: success record or canonical error. */
export type ExplainResult = ToolExplainRecord | { error: "TOOL_NOT_FOUND" };

/** Project a ToolDefinition (plus its resolved effective visibility) into the
 *  ToolExplainRecord shape. Pure — performs no lookup, no validation.
 *
 *  Optional fields are omitted when absent on the source definition rather
 *  than emitted as `undefined`, so JSON serialization round-trips deal with
 *  meaningfully-missing fields. */
export function explainTool(
  tool: ToolDefinition,
  effectiveVisibility: ToolVisibility,
): ToolExplainRecord {
  const record: ToolExplainRecord = {
    name: tool.name,
    description: tool.description,
    visibility: effectiveVisibility,
  };
  if (tool.category !== undefined) record.category = tool.category;
  if (tool.cost !== undefined) record.cost = tool.cost;
  if (tool.latency !== undefined) record.latency = tool.latency;
  if (tool.tags !== undefined) record.tags = tool.tags;
  if (tool.keywords !== undefined) record.keywords = tool.keywords;
  if (tool.relatedTo !== undefined) record.relatedTo = tool.relatedTo;
  if (tool.capabilities !== undefined) record.capabilities = tool.capabilities;
  if (tool.hints !== undefined) record.hints = tool.hints;
  if (tool.inputJsonSchema !== undefined) record.inputJsonSchema = tool.inputJsonSchema;
  return record;
}
