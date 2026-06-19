/**
 * `toAgentTool` — converts a `@gonk/tool-registry` ToolDefinition into a
 * `pi-agent-core` AgentTool.
 *
 * Hoisted from the parallel implementations in `@gonk/pi-curator` and
 * `@gonk/pi-rlm`, which previously kept verbatim copies of the same
 * converter. The original copies sat alongside `PiAuxClient`, but the
 * conversion logic itself doesn't depend on PiAuxClient — it's a pure
 * mapping from substrate ToolDefinition shape to pi-agent-core AgentTool
 * shape. Centralizing here lets future Pi-extension AuxClients (curator,
 * rlm, anything that drives a `pi-agent-core.Agent` directly) share one
 * implementation, so a fix lands once.
 *
 * The converter is structured-only with respect to its callers — it knows
 * `ToolDefinition` (substrate type) and `AgentTool`/`AgentToolResult`
 * (pi-agent-core type), nothing about the wider AuxClient.
 */

import type { ToolDefinition } from "@gonk/tool-registry";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

export interface ToAgentToolOptions {
  /** Tag interpolated into the error thrown when a ToolDefinition handler
   *  attempts `ctx.invoke`. Lets callers (curator vs rlm vs anything else)
   *  produce a recognizable trace when a tool reaches for cross-tool
   *  invocation that isn't wired in their aux loop. Defaults to
   *  "pi-agent-core aux loop". */
  invokeContextLabel?: string;
}

/**
 * Translate a `@gonk/tool-registry` ToolDefinition into pi-agent-core's
 * `AgentTool`. The AgentTool's `execute` runs the substrate's typed handler
 * in-process and wraps the return value into pi-agent-core's
 * `AgentToolResult` shape (content + details).
 *
 * Notes:
 * - pi-agent-core requires `parameters` to be a typebox `TSchema`. The
 *   substrate's `inputJsonSchema` is plain JSON Schema; we hand it through
 *   (typebox values are valid JSON Schema, and pi-agent-core forwards the
 *   object to providers as-is). When `inputJsonSchema` is absent we fall
 *   back to a permissive any-object schema so the LLM still sees a tool
 *   rather than nothing — without this fallback an undeclared
 *   `parameters` would knock the tool out of the model's tool list.
 * - The handler may return either `Promise<ToolResult>` or
 *   `AsyncIterable<ToolEvent>`. We await the promise form directly and walk
 *   the async-iterable form picking up the last `result` event.
 * - The handler's payload is exposed both as `details` (round-tripped to
 *   the AuxClient transcript parser) and serialized as `content[0].text`
 *   (so providers that only inspect content still see the result).
 */
export function toAgentTool(
  tool: ToolDefinition,
  opts: ToAgentToolOptions = {},
): AgentTool<any, unknown> {
  const parameters = tool.inputJsonSchema
    ? (tool.inputJsonSchema as never)
    : Type.Object({}, { additionalProperties: true });

  const invokeLabel = opts.invokeContextLabel ?? "pi-agent-core aux loop";

  const resolvedDescription = resolveAdvertisedDescription(tool);

  return {
    name: tool.name,
    label: tool.name,
    description: appendCostLatencyHints(tool, resolvedDescription),
    parameters,
    async execute(_toolCallId, params, signal) {
      const ctx = makeMinimalCtx(
        signal ?? new AbortController().signal,
        invokeLabel,
      );
      const handlerResult = (
        tool as ToolDefinition<unknown, unknown>
      ).handler(params as unknown, ctx as never);
      const data = await unwrapHandlerReturn(handlerResult);
      const result: AgentToolResult<unknown> = {
        content: [{ type: "text", text: JSON.stringify(data) }],
        details: data,
      };
      return result;
    },
  };
}

/** Append "Cost: <class>. Latency: <class>." to a tool's description when
 *  either field is set on the substrate `ToolDefinition`. Lets the LLM read
 *  the cost/latency budget without extra plumbing — the description is the
 *  one channel every provider preserves. Tools that set neither field are
 *  passed through unchanged so existing fixtures stay byte-stable.
 *
 *  Exported so the index-side `toPiToolSpec` can re-use the same formatting,
 *  keeping the LLM-visible description identical regardless of which adapter
 *  (toAgentTool for `pi-agent-core` aux loops vs registerGonkTools for the
 *  main Pi extension surface) registered the tool. */
export function appendCostLatencyHints(
  tool: ToolDefinition,
  descriptionOverride?: string,
): string {
  const baseDescription = descriptionOverride ?? tool.description;
  const parts: string[] = [];
  if (tool.cost) parts.push(`Cost: ${tool.cost}`);
  if (tool.latency) parts.push(`Latency: ${tool.latency}`);
  if (parts.length === 0) return baseDescription;
  const base = baseDescription.trimEnd();
  const sep = base.endsWith(".") ? " " : ". ";
  return `${base}${sep}${parts.join(". ")}.`;
}

/** Resolve which description to advertise for `tool` given its (optional)
 *  `capabilityFor` predicate. When the predicate returns "degraded" AND a
 *  `degradedDescription` is set, that description wins; otherwise the
 *  default `description` is returned. A throwing predicate falls back to
 *  the full description and emits a warn on `log` so misconfigured hosts
 *  surface. Centralized so `toPiToolSpec` and `toAgentTool` stay in sync. */
export function resolveAdvertisedDescription(
  tool: ToolDefinition,
  log?: { warn(msg: string, meta?: unknown): void },
): string {
  if (tool.capabilityFor && tool.degradedDescription) {
    try {
      const state = tool.capabilityFor();
      if (state === "degraded") return tool.degradedDescription;
    } catch (err) {
      log?.warn(
        `capabilityFor threw for ${tool.name}, falling back to full description`,
        { err },
      );
    }
  }
  return tool.description;
}

/** Resolve a substrate handler's `Promise<ToolResult> | AsyncIterable<ToolEvent>`
 *  return shape down to a single payload. Promise form unwraps to `.data`;
 *  iterable form returns the last `result` event's `data`. */
async function unwrapHandlerReturn(
  ret: ReturnType<ToolDefinition<unknown, unknown>["handler"]>,
): Promise<unknown> {
  const isPromise =
    ret !== null &&
    typeof ret === "object" &&
    typeof (ret as { then?: unknown }).then === "function";
  if (isPromise) {
    const settled = (await ret) as { data: unknown };
    return settled.data;
  }
  let captured: unknown = undefined;
  for await (const ev of ret as AsyncIterable<{ type: string; data?: unknown }>) {
    if (ev.type === "result") captured = ev.data;
  }
  return captured;
}

/** Minimum `ToolContext` for handler execution. Substrate handlers driven
 *  through this converter do not get cross-tool invocation — pi-agent-core's
 *  AgentTool surface is a single-call execute, so `ctx.invoke` throws with
 *  an informative `invokeContextLabel` so the caller can locate which
 *  loop/extension hit the limitation. Every other field on `ToolContext`
 *  is populated so handlers don't fault on undefined accesses. */
function makeMinimalCtx(
  signal: AbortSignal,
  invokeContextLabel: string,
): Record<string, unknown> {
  return {
    signal,
    log: { debug() {}, info() {}, warn() {}, error() {} },
    cwd: process.cwd(),
    env: process.env as Readonly<Record<string, string | undefined>>,
    invoke: () => {
      throw new Error(
        `ctx.invoke is not available inside the ${invokeContextLabel}`,
      );
    },
    callStack: [] as readonly string[],
  };
}
