import type { ServerContext } from "@modelcontextprotocol/server";
import type { AuthContext, AuthorizationDecision } from "@gonk/auth";
import type { Orchestrator } from "@gonk/tool-orchestrator";
import {
  collectToolOutcome, formatToolDescription, makeBaseContext, resolveApproval,
  resolveInputJsonSchema, tierRank, toolAuthorizationResource,
  type Logger, type ToolDefinition, type ToolRegistry, type ToolOutcome,
} from "@gonk/tool-registry";
import type { McpAdapterOptions, McpToolContext, WriteToolPolicy } from "./index.ts";

/** One discovery and dispatch path for the MCP and JSON HTTP projections. */
export function createToolAccess(
  options: McpAdapterOptions,
  logger = options.log ?? noopLogger
) {
  const log = options.log ?? noopLogger;
  const policy: WriteToolPolicy = options.writeToolPolicy ?? "warn";
  const allowlist = new Set(options.allowlist ?? []);
  function activeTools(): ToolDefinition[] {
    const all = isOrchestrator(options.source)
      ? options.source.activeSet()
      : options.source.list();
    return all.filter((tool) => !tool.capabilities?.duplex);
  }

  function findActiveTool(name: string): ToolDefinition | undefined {
    return activeTools().find(tool => (tool.hints?.mcp?.mcpName ?? tool.name) === name);
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

  async function requestAuth(extra: ServerContext): Promise<AuthContext> {
    return options.makeAuthContext(extra);
  }

  async function requestContext(
    extra: ServerContext
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

  return {
    async list(extra: ServerContext) {
      await requestContext(extra);
      const auth = await requestAuth(extra);
      return filterDiscoverable(applyWritePolicy(activeTools()), auth);
    },
    async invoke(
      name: string,
      input: unknown,
      extra: ServerContext,
      projectedInput = true,
      expectedTool?: ToolDefinition
    ): Promise<ToolOutcome> {
      const tool = findActiveTool(name);
      if (!tool || (expectedTool && tool !== expectedTool) ||
          applyWritePolicy([tool]).length === 0) {
        return { ok: false, code: "TOOL_NOT_FOUND", message: `Unknown tool: ${name}` };
      }
      const invocationContext = await requestContext(extra);
      const auth = await requestAuth(extra);
      if (expectedTool && findActiveTool(name) !== expectedTool) {
        return { ok: false, code: "TOOL_NOT_FOUND", message: `Unknown tool: ${name}` };
      }
      const context = {
        ...makeBaseContext({ signal: extra.mcpReq.signal, log: logger, auth }),
        ...(options.scope ? { scope: options.scope } : {}),
        ...invocationContext,
      };
      return collectToolOutcome(options.source.invoke(
        tool.name, projectedInput ? unwrapProjectedInput(tool, input) : input, context
      ));
    },
  };
}

export function describeTool(tool: ToolDefinition) {
  const annotations = mapAnnotations(tool.hints?.mcp?.annotations);
  return {
    name: tool.hints?.mcp?.mcpName ?? tool.name,
    description: formatToolDescription(tool),
    inputSchema: resolveInputJsonSchema(tool),
    ...(annotations ? { annotations } : {}),
  };
}

export function describeMcpTool(tool: ToolDefinition) {
  const definition = describeTool(tool);
  return { ...definition, inputSchema: ensureObjectSchema(definition.inputSchema) };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
const noopLogger: Logger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
};
