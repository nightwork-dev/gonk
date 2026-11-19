import { McpServer } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  Server,
  ServerContext,
  Transport,
} from "@modelcontextprotocol/server";
import type { AuthContext } from "@gonk/auth";
import type { Orchestrator } from "@gonk/tool-orchestrator";
import {
  type Display,
  type DisplayBlock,
  type Logger,
  type ToolContext,
  type ToolRegistry,
} from "@gonk/tool-registry";

import type { McpBundledSkills } from "./bundled-skills.ts";
export { loadMcpBundledSkills, type McpBundledSkillOptions, type McpBundledSkills } from "./bundled-skills.ts";

import { createToolAccess, describeMcpTool } from "./tool-access.ts";

export const GONK_AUTH_INFO_PRINCIPAL = "gonkPrincipal";

export type WriteToolPolicy = "warn" | "require-allowlist" | "permissive";

export type McpToolContext = Partial<
  Pick<ToolContext, "cwd" | "env" | "scope" | "host">
>;

export interface McpAdapterOptions {
  serverName: string;
  serverVersion: string;
  /** Public, application-authored usage guidance shared by every caller. */
  instructions?: string;
  /** One application bundle, also registered as portable skill tools. */
  bundledSkills?: McpBundledSkills;
  source: ToolRegistry | Orchestrator;
  /** Build the canonical request authorization context. Called for tools/list
   *  and tools/call. Raw credentials remain in MCP request extras.
   *
   *  REQUIRED (GR-83): `ToolContext.auth` has no ambient fallback, and MCP
   *  is exactly the "per-turn principal" host the story names — a real
   *  transport-authenticated caller arrives per request, so this binds a
   *  fresh `AuthContext` from `extra` on every call rather than a single
   *  bound-at-startup owner. A single-caller MCP server (a local plugin
   *  server with no external callers) still implements this — typically
   *  `() => ownerPrincipal(process.env)` (`@gonk/auth`) — since there is no
   *  default. */
  makeAuthContext(extra: ServerContext): AuthContext | Promise<AuthContext>;
  writeToolPolicy?: WriteToolPolicy;
  allowlist?: string[];
  log?: Logger;
  scope?: ToolContext["scope"];
  /** Invocation-only non-security host context. Authentication and
   *  authorization belong exclusively in `makeAuthContext` so discovery and
   *  invocation cannot resolve different policy. */
  makeContext?: (
    extra: ServerContext
  ) => McpToolContext | Promise<McpToolContext>;
}

export interface McpAdapter {
  server: Server;
  connect(transport: Transport): Promise<void>;
}

export function createMcpServer(options: McpAdapterOptions): McpAdapter {
  const instructions = options.instructions ?? options.source.instructions;
  const mcp = new McpServer(
    { name: options.serverName, version: options.serverVersion },
    {
      capabilities: { tools: {} },
      ...(instructions === undefined ? {} : { instructions }),
    }
  );
  const server = mcp.server;
  const access = createToolAccess(options, makeMcpLogger(server));
  options.bundledSkills?.attach(mcp, (tool, input, ctx) =>
    access.invoke(tool.hints?.mcp?.mcpName ?? tool.name, input, ctx, false, tool)
  );

  server.setRequestHandler("tools/list", async (_request, ctx) => ({
    tools: (await access.list(ctx)).map(describeMcpTool),
  }));

  server.setRequestHandler(
    "tools/call",
    async (request, ctx: ServerContext): Promise<CallToolResult> => {
      const requestedName = request.params.name;
      const outcome = await access.invoke(
        requestedName, request.params.arguments ?? {}, ctx
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
      const modern = ctx.mcpReq.envelope !== undefined;
      const result: CallToolResult = {
        content,
        ...(isRecord(outcome.data) || (modern && outcome.data !== undefined)
          ? { structuredContent: outcome.data }
          : {}),
        ...(outcome.metadata === undefined && outcome.receipt === undefined
          ? {}
          : {
              _meta: {
                "gonk/tool-result-metadata": outcome.metadata,
                ...(outcome.receipt === undefined
                  ? {}
                  : { "gonk/tool-result-receipt": outcome.receipt }),
              },
            }),
      };
      return modern ? server.projectCallToolResult(result, undefined) : result;
    }
  );

  return {
    server,
    async connect(transport) {
      await server.connect(transport);
    },
  };
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

function stringifyValue(value: unknown, pretty = false): string {
  const serialized = JSON.stringify(value, null, pretty ? 2 : undefined);
  return serialized ?? String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
