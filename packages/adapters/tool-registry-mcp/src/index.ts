import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";

import {
  makeBaseContext,
  type Display,
  type DisplayBlock,
  type Logger,
  type ToolContext,
  type ToolDefinition,
  type ToolEvent,
  type ToolRegistry,
} from "@gonk/tool-registry";
import type { Orchestrator } from "@gonk/tool-orchestrator";

export type WriteToolPolicy = "warn" | "require-allowlist" | "permissive";

export type McpToolContext = Partial<Pick<ToolContext, "cwd" | "env" | "scope" | "host">>;

export interface McpAdapterOptions {
  serverName: string;
  serverVersion: string;
  source: ToolRegistry | Orchestrator;
  /** Behavior for tools with capabilities.writesFs or capabilities.network.
   *    "warn"             — log a warning at startup; advertise anyway. (default)
   *    "require-allowlist"— refuse to advertise unless name is in `allowlist`.
   *    "permissive"       — silent passthrough. */
  writeToolPolicy?: WriteToolPolicy;
  allowlist?: string[];
  /** Optional logger for adapter-level events (write-policy warnings, etc).
   *  Tool-handler logs are routed via ToolContext.log. */
  log?: Logger;
  /** Scope store injected into every tool invocation's `ctx.scope`. Without it,
   *  scope-dependent tools (persona switch/current, the self-model, anything
   *  that reads/writes tiered config) cannot function over MCP. Mirrors how the
   *  Pi adapter forwards scope. Optional: servers that expose only
   *  scope-free tools may omit it. */
  scope?: ToolContext["scope"];
  /** Add trusted request-scoped context after the transport has authenticated
   *  the caller. This is the MCP equivalent of the WS adapter's makeContext
   *  seam: identity comes from the host, never from tool input. */
  makeContext?: (
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => McpToolContext | Promise<McpToolContext>;
}

export interface McpAdapter {
  /** The underlying MCP Server. Connect a transport via `.connect(transport)`
   *  or use the convenience `.run()` for stdio. */
  server: Server;
  connect(transport: Transport): Promise<void>;
}

export function createMcpServer(options: McpAdapterOptions): McpAdapter {
  const log = options.log ?? noopLogger;
  const policy: WriteToolPolicy = options.writeToolPolicy ?? "warn";
  const allowlist = new Set(options.allowlist ?? []);

  const server = new Server(
    { name: options.serverName, version: options.serverVersion },
    { capabilities: { tools: {} } },
  );

  function visibleTools(): ToolDefinition[] {
    const all = isOrchestrator(options.source)
      ? options.source.activeSet()
      : options.source.list();
    // MCP is request/response — duplex tools cannot be advertised here.
    return all.filter((t) => !t.capabilities?.duplex);
  }

  function applyWritePolicy(tools: ToolDefinition[]): ToolDefinition[] {
    if (policy === "permissive") return tools;
    const out: ToolDefinition[] = [];
    for (const t of tools) {
      const isWriter = !!(t.capabilities?.writesFs || t.capabilities?.network);
      if (!isWriter) {
        out.push(t);
        continue;
      }
      if (policy === "require-allowlist") {
        if (allowlist.has(t.name)) out.push(t);
        else log.warn(`Skipping write-tool ${t.name} (not in allowlist)`);
      } else {
        // "warn"
        log.warn(
          `Advertising write-tool ${t.name} (writesFs/network=true). ` +
            `Configure writeToolPolicy:"require-allowlist" to require explicit opt-in.`,
        );
        out.push(t);
      }
    }
    return out;
  }

  server.setRequestHandler(ListToolsRequestSchema, async (): Promise<ListToolsResult> => {
    const tools = applyWritePolicy(visibleTools());
    return {
      tools: tools.map((t) => {
        const ann = mapAnnotations(t.hints?.mcp?.annotations);
        return {
          name: t.hints?.mcp?.mcpName ?? t.name,
          description: t.description,
          inputSchema: ensureObjectSchema(t.inputJsonSchema),
          ...(ann ? { annotations: ann } : {}),
        };
      }),
    };
  });

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request, extra: RequestHandlerExtra<ServerRequest, ServerNotification>): Promise<CallToolResult> => {
      const requestedName = request.params.name;
      const tool = visibleTools().find(
        (t) => (t.hints?.mcp?.mcpName ?? t.name) === requestedName,
      );
      if (!tool) {
        return {
          isError: true,
          content: [{ type: "text", text: `Unknown tool: ${requestedName}` }],
        };
      }

      // Write-policy enforcement at call time as well.
      const policed = applyWritePolicy([tool]);
      if (policed.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Tool ${requestedName} is gated by writeToolPolicy=require-allowlist`,
            },
          ],
        };
      }

      const requestContext = await options.makeContext?.(extra);
      const baseCtx = {
        ...makeBaseContext({
          signal: extra.signal,
          log: makeMcpLogger(server),
        }),
        ...(options.scope ? { scope: options.scope } : {}),
        ...requestContext,
      };
      const stream = isOrchestrator(options.source)
        ? options.source.invoke(tool.name, request.params.arguments ?? {}, baseCtx)
        : options.source.invoke(tool.name, request.params.arguments ?? {}, baseCtx);

      return collectToCallResult(stream);
    },
  );

  return {
    server,
    async connect(transport) {
      await server.connect(transport);
    },
  };
}

// =============================================================================
// Stream → CallToolResult
// =============================================================================

async function collectToCallResult(
  stream: AsyncIterable<ToolEvent>,
): Promise<CallToolResult> {
  const content: CallToolResult["content"] = [];
  let resultEvent: { data: unknown; display?: Display } | undefined;
  let errorEvent: { code: string; message: string; details?: unknown } | undefined;

  for await (const event of stream) {
    switch (event.type) {
      case "log":
        // Logs surface through server.notifications; nothing to add to content.
        break;
      case "progress":
        // MCP has its own progress mechanism via notifications; for the call's
        // returned content we ignore in-stream progress.
        break;
      case "data":
        // Intermediate chunks are dropped from the final CallToolResult.
        // (A future iteration can stream them via notifications.)
        break;
      case "result":
        resultEvent = { data: event.data, ...(event.display !== undefined ? { display: event.display } : {}) };
        break;
      case "error":
        errorEvent = {
          code: event.code,
          message: event.message,
          ...(event.details !== undefined ? { details: event.details } : {}),
        };
        break;
    }
  }

  if (errorEvent) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Error [${errorEvent.code}]: ${errorEvent.message}`,
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

  if (resultEvent) {
    if (resultEvent.display !== undefined) {
      content.push(...renderDisplayToContent(resultEvent.display));
    } else {
      content.push({ type: "text", text: JSON.stringify(resultEvent.data) });
    }
    return { content, structuredContent: resultEvent.data as Record<string, unknown> };
  }

  return {
    isError: true,
    content: [{ type: "text", text: "Tool produced no result event" }],
  };
}

function renderDisplayToContent(display: Display): CallToolResult["content"] {
  if (typeof display === "string") return [{ type: "text", text: display }];
  return display.map(renderBlockToContent);
}

function renderBlockToContent(
  block: DisplayBlock,
): CallToolResult["content"][number] {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "markdown":
      return { type: "text", text: block.markdown };
    case "code":
      return {
        type: "text",
        text: `\`\`\`${block.language}\n${block.code}\n\`\`\``,
      };
    case "json":
      return { type: "text", text: JSON.stringify(block.value, null, 2) };
    case "image":
      return { type: "image", data: block.data, mimeType: block.mimeType };
    case "link":
      return {
        type: "text",
        text: block.title ? `${block.title}: ${block.url}` : block.url,
      };
  }
}

// =============================================================================
// Helpers
// =============================================================================

function isOrchestrator(s: ToolRegistry | Orchestrator): s is Orchestrator {
  return typeof (s as Orchestrator).activeSet === "function";
}

function mapAnnotations(
  ann:
    | { readOnly?: boolean; destructive?: boolean; idempotent?: boolean; openWorld?: boolean }
    | undefined,
):
  | {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    }
  | undefined {
  if (!ann) return undefined;
  const out: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } = {};
  if (ann.readOnly !== undefined) out.readOnlyHint = ann.readOnly;
  if (ann.destructive !== undefined) out.destructiveHint = ann.destructive;
  if (ann.idempotent !== undefined) out.idempotentHint = ann.idempotent;
  if (ann.openWorld !== undefined) out.openWorldHint = ann.openWorld;
  return Object.keys(out).length > 0 ? out : undefined;
}

function ensureObjectSchema(
  schema: Record<string, unknown> | undefined,
): { [x: string]: unknown; type: "object" } {
  if (!schema) {
    return { type: "object", properties: {}, additionalProperties: true };
  }
  if (schema.type === "object") {
    return schema as { [x: string]: unknown; type: "object" };
  }
  // Wrap a non-object schema (e.g. a primitive) under a single `value` key.
  return { type: "object", properties: { value: schema }, additionalProperties: false };
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeMcpLogger(server: Server): Logger {
  // MCP's server can send logging/log notifications. Best-effort:
  const send = (level: "debug" | "info" | "warning" | "error", message: string, meta?: unknown) => {
    server
      .sendLoggingMessage({ level, data: { message, ...(meta !== undefined ? { meta } : {}) } })
      .catch(() => {
        // Server may not be connected in tests; swallow.
      });
  };
  return {
    debug: (m, meta) => send("debug", m, meta),
    info: (m, meta) => send("info", m, meta),
    warn: (m, meta) => send("warning", m, meta),
    error: (m, meta) => send("error", m, meta),
  };
}
