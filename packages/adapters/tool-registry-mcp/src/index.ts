import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
  type ServerNotification,
  type ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";

import {
  type AuthContext,
  type AuthorizationDecision,
} from "@gonk/auth";
import type { Orchestrator } from "@gonk/tool-orchestrator";
import {
  collectToolOutcome,
  makeBaseContext,
  resolveApproval,
  resolveInputJsonSchema,
  tierRank,
  toolAuthorizationResource,
  type Display,
  type DisplayBlock,
  type Logger,
  type ToolContext,
  type ToolDefinition,
  type ToolRegistry,
} from "@gonk/tool-registry";

export const GONK_AUTH_INFO_PRINCIPAL = "gonkPrincipal";

export type WriteToolPolicy = "warn" | "require-allowlist" | "permissive";

export type McpToolContext = Partial<
  Pick<ToolContext, "cwd" | "env" | "scope" | "host">
>;

export interface McpAdapterOptions {
  serverName: string;
  serverVersion: string;
  source: ToolRegistry | Orchestrator;
  /** Build the canonical request authorization context. Called for tools/list
   *  and tools/call. Raw credentials remain in MCP request extras. */
  makeAuthContext?(
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): AuthContext | Promise<AuthContext>;
  writeToolPolicy?: WriteToolPolicy;
  allowlist?: string[];
  log?: Logger;
  scope?: ToolContext["scope"];
  /** Invocation-only non-security host context. Authentication and
   *  authorization belong exclusively in `makeAuthContext` so discovery and
   *  invocation cannot resolve different policy. */
  makeContext?: (
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ) => McpToolContext | Promise<McpToolContext>;
}

export interface McpAdapter {
  server: Server;
  connect(transport: Transport): Promise<void>;
}

export function createMcpServer(options: McpAdapterOptions): McpAdapter {
  const log = options.log ?? noopLogger;
  const policy: WriteToolPolicy = options.writeToolPolicy ?? "warn";
  const allowlist = new Set(options.allowlist ?? []);

  const server = new Server(
    { name: options.serverName, version: options.serverVersion },
    { capabilities: { tools: {} } }
  );

  function activeTools(): ToolDefinition[] {
    const all = isOrchestrator(options.source)
      ? options.source.activeSet()
      : options.source.list();
    return all.filter((tool) => !tool.capabilities?.duplex);
  }

  function applyWritePolicy(tools: ToolDefinition[]): ToolDefinition[] {
    if (policy === "permissive") return tools;
    const allowed: ToolDefinition[] = [];
    for (const tool of tools) {
      const writes = isWriteTool(tool);
      if (!writes) {
        allowed.push(tool);
        continue;
      }
      if (policy === "require-allowlist") {
        if (allowlist.has(tool.name)) allowed.push(tool);
        else log.warn(`Skipping write-tool ${tool.name} (not in allowlist)`);
      } else {
        log.warn(
          `Advertising write-tool ${tool.name} (write capability or approval tier). ` +
            'Configure writeToolPolicy:"require-allowlist" to require explicit opt-in.'
        );
        allowed.push(tool);
      }
    }
    return allowed;
  }

  async function requestAuth(
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): Promise<AuthContext | undefined> {
    return options.makeAuthContext?.(extra);
  }

  async function requestContext(
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): Promise<McpToolContext | undefined> {
    const context = await options.makeContext?.(extra);
    if (
      context &&
      Object.prototype.hasOwnProperty.call(context as object, "auth")
    ) {
      throw new Error(
        "MCP makeContext must not return auth; use makeAuthContext so tools/list and tools/call share one policy"
      );
    }
    if (!context) return undefined;
    return {
      ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
      ...(context.env === undefined ? {} : { env: context.env }),
      ...(context.scope === undefined ? {} : { scope: context.scope }),
      ...(context.host === undefined ? {} : { host: context.host }),
    };
  }

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (
      _request,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ): Promise<ListToolsResult> => {
      await requestContext(extra);
      const auth = await requestAuth(extra);
      const candidates = applyWritePolicy(activeTools());
      const tools = auth
        ? await filterDiscoverable(candidates, auth)
        : candidates;
      return {
        tools: tools.map((tool) => {
          const annotations = mapAnnotations(tool.hints?.mcp?.annotations);
          return {
            name: tool.hints?.mcp?.mcpName ?? tool.name,
            description: tool.description,
            inputSchema: ensureObjectSchema(resolveInputJsonSchema(tool)),
            ...(annotations ? { annotations } : {}),
          };
        }),
      };
    }
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (
      request,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ): Promise<CallToolResult> => {
      const requestedName = request.params.name;
      const tool = activeTools().find(
        (candidate) =>
          (candidate.hints?.mcp?.mcpName ?? candidate.name) === requestedName
      );
      if (!tool) return unknownToolResult(requestedName);

      if (applyWritePolicy([tool]).length === 0) {
        return unknownToolResult(requestedName);
      }

      const toolInput = unwrapProjectedInput(
        tool,
        request.params.arguments ?? {}
      );
      const invocationContext = await requestContext(extra);
      const auth = await requestAuth(extra);
      const baseCtx = {
        ...makeBaseContext({
          signal: extra.signal,
          log: makeMcpLogger(server),
        }),
        ...(options.scope ? { scope: options.scope } : {}),
        ...invocationContext,
        ...(auth ? { auth } : {}),
      };
      const outcome = await collectToolOutcome(
        options.source.invoke(tool.name, toolInput, baseCtx)
      );
      if (!outcome.ok) {
        if (outcome.code === "TOOL_NOT_FOUND") {
          return unknownToolResult(requestedName);
        }
        return errorCallResult(outcome.code, outcome.message, outcome.details);
      }
      const content =
        outcome.display === undefined
          ? [{ type: "text" as const, text: stringifyValue(outcome.data) }]
          : renderDisplayToContent(outcome.display);
      return {
        content,
        ...(isRecord(outcome.data) ? { structuredContent: outcome.data } : {}),
      };
    }
  );

  return {
    server,
    async connect(transport) {
      await server.connect(transport);
    },
  };
}

async function filterDiscoverable(
  tools: ToolDefinition[],
  auth: AuthContext
): Promise<ToolDefinition[]> {
  const decisions = await Promise.all(
    tools.map(async (tool) => {
      const decision = await authorizeSafely(auth, {
        action: "tool.discover",
        resource: toolAuthorizationResource(tool),
      });
      return decision.outcome === "allow";
    })
  );
  return tools.filter((_tool, index) => decisions[index] === true);
}

async function authorizeSafely(
  auth: AuthContext,
  request: Parameters<AuthContext["authorize"]>[0]
): Promise<AuthorizationDecision> {
  try {
    const decision = await auth.authorize(request);
    if (
      decision &&
      (decision.outcome === "allow" || decision.outcome === "deny") &&
      typeof decision.reason === "string"
    ) {
      return decision;
    }
    return {
      outcome: "deny",
      reason: "MCP authorization policy returned an invalid decision",
    };
  } catch {
    return {
      outcome: "deny",
      reason: "MCP authorization policy failed",
    };
  }
}

function isWriteTool(tool: ToolDefinition): boolean {
  if (tool.capabilities?.writesFs || tool.capabilities?.network) return true;
  if (typeof tool.approval === "function") return true;
  const approval = resolveApproval(tool.approval, undefined);
  return approval !== undefined && tierRank(approval.tier) >= tierRank("write");
}

function unknownToolResult(name: string): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Unknown tool: ${name}` }],
  };
}

function errorCallResult(
  code: string,
  message: string,
  details?: unknown
): CallToolResult {
  return {
    isError: true,
    structuredContent: {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    content: [
      { type: "text", text: `Error [${code}]: ${message}` },
      ...(details === undefined
        ? []
        : [{ type: "text" as const, text: stringifyValue(details, true) }]),
    ],
  };
}

function renderDisplayToContent(display: Display): CallToolResult["content"] {
  if (typeof display === "string") {
    return [{ type: "text", text: display }];
  }
  return display.map(renderBlockToContent);
}

function renderBlockToContent(
  block: DisplayBlock
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
      return { type: "text", text: stringifyValue(block.value, true) };
    case "image":
      return {
        type: "image",
        data: block.data,
        mimeType: block.mimeType,
      };
    case "link":
      return {
        type: "text",
        text: block.title ? `${block.title}: ${block.url}` : block.url,
      };
  }
}

function isOrchestrator(
  source: ToolRegistry | Orchestrator
): source is Orchestrator {
  return typeof (source as Orchestrator).activeSet === "function";
}

function mapAnnotations(
  annotations:
    | {
        readOnly?: boolean;
        destructive?: boolean;
        idempotent?: boolean;
        openWorld?: boolean;
      }
    | undefined
):
  | {
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    }
  | undefined {
  if (!annotations) return undefined;
  const result: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } = {};
  if (annotations.readOnly !== undefined) {
    result.readOnlyHint = annotations.readOnly;
  }
  if (annotations.destructive !== undefined) {
    result.destructiveHint = annotations.destructive;
  }
  if (annotations.idempotent !== undefined) {
    result.idempotentHint = annotations.idempotent;
  }
  if (annotations.openWorld !== undefined) {
    result.openWorldHint = annotations.openWorld;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function ensureObjectSchema(schema: Record<string, unknown>): {
  [key: string]: unknown;
  type: "object";
} {
  if (Object.keys(schema).length === 0) {
    return {
      type: "object",
      properties: {},
      additionalProperties: true,
    };
  }
  if (schema.type === "object") {
    return schema as { [key: string]: unknown; type: "object" };
  }
  return {
    type: "object",
    properties: { value: schema },
    required: ["value"],
    additionalProperties: false,
  };
}

function unwrapProjectedInput(tool: ToolDefinition, input: unknown): unknown {
  const schema = resolveInputJsonSchema(tool);
  if (Object.keys(schema).length === 0 || schema.type === "object") {
    return input;
  }
  if (isRecord(input) && Object.keys(input).length === 1 && "value" in input) {
    return input.value;
  }
  return input;
}

function stringifyValue(value: unknown, pretty = false): string {
  const serialized = JSON.stringify(value, null, pretty ? 2 : undefined);
  return serialized ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeMcpLogger(server: Server): Logger {
  const send = (
    level: "debug" | "info" | "warning" | "error",
    message: string,
    meta?: unknown
  ) => {
    server
      .sendLoggingMessage({
        level,
        data: {
          message,
          ...(meta === undefined ? {} : { meta }),
        },
      })
      .catch(() => {
        // Server may not be connected in tests.
      });
  };
  return {
    debug: (message, meta) => send("debug", message, meta),
    info: (message, meta) => send("info", message, meta),
    warn: (message, meta) => send("warning", message, meta),
    error: (message, meta) => send("error", message, meta),
  };
}
