import {
  makeBaseContext,
  type Display,
  type DisplayBlock,
  type Logger,
  type ToolDefinition,
  type ToolEvent,
  type ToolRegistry,
} from "@gonk/tool-registry";
import type { ScopeStore } from "@gonk/scope";
import type { Orchestrator } from "@gonk/tool-orchestrator";

export {
  toAgentTool,
  appendCostLatencyHints,
  resolveAdvertisedDescription,
  type ToAgentToolOptions,
} from "./to-agent-tool.ts";
import { appendCostLatencyHints, resolveAdvertisedDescription } from "./to-agent-tool.ts";
export {
  clearGonkExtensions,
  clearGonkTools,
  findGonkExtension,
  findGonkTool,
  listGonkExtensions,
  listGonkTools,
  probeReadiness,
  recordGonkExtension,
  recordGonkTool,
  type CapabilityReport,
  type GonkExtensionRecord,
} from "./process-registry.ts";
import { recordGonkTool } from "./process-registry.ts";

// =============================================================================
// Pi structural types — declared here to avoid a hard dep on @earendil-works/pi-*.
// At call time, the user's real ExtensionAPI matches structurally.
// =============================================================================

export interface PiExtensionAPI {
  registerTool(spec: PiToolSpec): unknown;
}

export interface PiToolSpec {
  name: string;
  /** Display label. We always populate this (`tool.name` by default), so the
   *  type is required to match Pi's actual `ToolDefinition.label`. */
  label: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: Record<string, unknown>;
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal,
    onUpdate: ((update: PiToolUpdate) => void) | undefined,
    ctx: unknown,
  ): Promise<PiToolResult>;
}

export type PiContent =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string };

export interface PiToolResult {
  content: PiContent[];
  details?: unknown;
  isError?: boolean;
}

/** Partial `AgentToolResult` shape pi-agent-core feeds back to its UI via the
 *  `onUpdate` callback during a tool's execution. **Pi requires this shape**
 *  — its renderer reads `.content` and `.details` directly; sending tagged
 *  event objects (`{type: "progress", message}`) crashes the UI when it tries
 *  to filter the missing content array. Each emit is a snapshot of "what the
 *  result looks like so far"; we put a text representation of the milestone
 *  into `content` and structured progress info into `details`. */
export interface PiToolUpdate {
  content: PiContent[];
  details?: unknown;
}

// =============================================================================
// Adapter
// =============================================================================

export interface RegisterGonkToolsOptions {
  /** The Pi runtime's `ExtensionAPI` instance. Used for the default
   *  `pi.registerTool(...)` call. Ignored — and may be omitted — when
   *  `register` is provided. */
  pi?: PiExtensionAPI;
  /** Tools to register. With an Orchestrator, the active set is registered;
   *  with a raw Registry, the full list is. */
  source: ToolRegistry | Orchestrator;
  /** Scope binding for `ctx.scope` when tools execute. Optional but strongly
   *  recommended — without it persona/scope-aware tools degrade. */
  scope?: ScopeStore;
  /** Override which tools are registered. Default skips duplex-only tools
   *  (Pi's `execute` is request/response). */
  filter?: (tool: ToolDefinition) => boolean;
  /** Optional adapter-side logger. Tool-handler logs go through ctx.log. */
  log?: Logger;
  /** Custom register function. When provided, takes precedence over
   *  `pi.registerTool`. Use this with pi-ext-kit's `ext.tool` so contributions
   *  are recorded against the extension's manifest and respect enable/disable
   *  state from `pi config`. */
  register?: (spec: PiToolSpec) => unknown;
}

export interface RegistrationResult {
  /** Names of tools that were registered. */
  registered: string[];
  /** Names that were skipped, with reason. */
  skipped: { name: string; reason: string }[];
}

/** Register every tool from `source` with the Pi extension API as a native
 *  agent-callable tool. Returns the names registered + skipped for diagnostics. */
export function registerGonkTools(
  options: RegisterGonkToolsOptions,
): RegistrationResult {
  const log = options.log ?? noopLogger;
  const tools = listTools(options.source);
  const registered: string[] = [];
  const skipped: { name: string; reason: string }[] = [];

  for (const tool of tools) {
    if (tool.capabilities?.duplex) {
      skipped.push({ name: tool.name, reason: "duplex (not supported by Pi registerTool)" });
      continue;
    }
    if (options.filter && !options.filter(tool)) {
      skipped.push({ name: tool.name, reason: "filtered by caller" });
      continue;
    }

    const spec = toPiToolSpec(tool, options, log);
    if (options.register) {
      options.register(spec);
    } else if (options.pi) {
      options.pi.registerTool(spec);
    } else {
      throw new Error("registerGonkTools requires either `pi` or `register` option");
    }
    // Mirror the underlying ToolDefinition into the process-wide gonk
    // registry so introspection tools (e.g. tool_explain) can find it.
    // Mirror only succeeds for tools that successfully reached Pi (or the
    // caller's `register` callback) — duplex/filtered tools above already
    // `continue`d past this point.
    recordGonkTool(tool);
    registered.push(tool.name);
  }

  return { registered, skipped };
}

// =============================================================================
// Internals
// =============================================================================

function isOrchestrator(s: ToolRegistry | Orchestrator): s is Orchestrator {
  return typeof (s as Orchestrator).activeSet === "function";
}

function listTools(source: ToolRegistry | Orchestrator): ToolDefinition[] {
  return isOrchestrator(source) ? source.activeSet() : source.list();
}

function toPiToolSpec(
  tool: ToolDefinition,
  options: RegisterGonkToolsOptions,
  log: Logger,
): PiToolSpec {
  const piName = tool.hints?.pi?.piName ?? tool.name;
  const resolvedDescription = resolveAdvertisedDescription(tool, log);

  return {
    name: piName,
    label: tool.name,
    description: appendCostLatencyHints(tool, resolvedDescription),
    parameters: tool.inputJsonSchema ?? { type: "object", properties: {}, additionalProperties: true },
    async execute(_toolCallId, params, signal, onUpdate, piCtx) {
      const baseCtx = makeBaseContext({ signal, log });
      const ctx = {
        ...baseCtx,
        ...(options.scope ? { scope: options.scope } : {}),
        // Forward Pi's per-call context as opaque host. Tools that need
        // host-specific surfaces (e.g. modelRegistry for Codex auth) cast
        // ctx.host to the appropriate Pi type.
        host: piCtx,
        // Progress channel — Promise-form handlers call `ctx.notify(event)`
        // to push milestone updates to Pi's UI mid-await without restructuring
        // as an async generator. Async-iterable handlers yield `progress`/`log`
        // events through the registry stream below and reach `onUpdate` the
        // same way; both paths converge here.
        ...(onUpdate
          ? {
              notify: (event: ToolEvent) => {
                if (event.type === "progress") {
                  onUpdate(toProgressUpdate(event.message, event.percent));
                } else if (event.type === "log") {
                  log[event.level](event.message, event.meta);
                }
              },
            }
          : {}),
      };

      let resultData: unknown;
      let resultDisplay: Display | undefined;
      let errorEvent: { code: string; message: string; details?: unknown } | undefined;

      const stream = options.source.invoke(tool.name, params, ctx);

      for await (const ev of stream) {
        switch (ev.type) {
          case "progress":
            onUpdate?.(toProgressUpdate(ev.message, ev.percent));
            break;
          case "data":
            onUpdate?.({
              content: [{ type: "text", text: stringifyChunk(ev.chunk) }],
              details: { progress: true, chunk: ev.chunk },
            });
            break;
          case "log":
            // Pi has its own logging; we just emit through the adapter logger.
            log[ev.level](ev.message, ev.meta);
            break;
          case "result":
            resultData = ev.data;
            if (ev.display !== undefined) resultDisplay = ev.display;
            break;
          case "error":
            errorEvent = {
              code: ev.code,
              message: ev.message,
              ...(ev.details !== undefined ? { details: ev.details } : {}),
            };
            break;
        }
      }

      if (errorEvent) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `[${errorEvent.code}] ${errorEvent.message}`,
            },
            ...(errorEvent.details !== undefined
              ? [
                  {
                    type: "text" as const,
                    text: JSON.stringify(errorEvent.details, null, 2),
                  },
                ]
              : []),
          ],
        };
      }

      return {
        content: renderDisplay(resultDisplay, resultData),
        details: resultData,
      };
    },
  };
}

function renderDisplay(display: Display | undefined, data: unknown): PiContent[] {
  if (display === undefined) {
    return [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data) }];
  }
  if (typeof display === "string") return [{ type: "text", text: display }];
  return display.map(renderBlock);
}

function renderBlock(block: DisplayBlock): PiContent {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "markdown":
      return { type: "text", text: block.markdown };
    case "code":
      return { type: "text", text: `\`\`\`${block.language}\n${block.code}\n\`\`\`` };
    case "json":
      return { type: "text", text: JSON.stringify(block.value, null, 2) };
    case "link":
      return { type: "text", text: block.title ? `${block.title}: ${block.url}` : block.url };
    case "image":
      return { type: "image", mimeType: block.mimeType, data: block.data };
  }
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Build the `AgentToolResult`-shaped partial pi-agent-core's `onUpdate`
 *  expects for a progress milestone. `content` is what Pi shows; `details`
 *  carries structured progress info for any UI that wants to discriminate
 *  partial-vs-final results. */
function toProgressUpdate(
  message: string | undefined,
  percent: number | undefined,
): PiToolUpdate {
  const text = message ?? (percent !== undefined ? `${percent}%` : "…");
  return {
    content: [{ type: "text", text }],
    details: {
      progress: true,
      ...(message !== undefined ? { message } : {}),
      ...(percent !== undefined ? { percent } : {}),
    },
  };
}

function stringifyChunk(chunk: unknown): string {
  if (typeof chunk === "string") return chunk;
  try {
    return JSON.stringify(chunk);
  } catch {
    return String(chunk);
  }
}
