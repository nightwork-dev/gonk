import { randomUUID } from "node:crypto";
import type { AuthInfo, ServerContext } from "@modelcontextprotocol/server";
import type { McpAdapterOptions } from "../index.ts";
import { createToolAccess, describeTool } from "../tool-access.ts";
import { boundedJson, BodyTooLargeError, jsonError } from "./web-request.ts";

export function matchesJsonPath(path: string, jsonPath: string): boolean {
  return path === jsonPath || path.startsWith(`${jsonPath}/`);
}

export function assertJsonPath(path: string): void {
  if (!path.startsWith("/") || path === "/" || path.endsWith("/")) {
    throw new Error("jsonPath must be an absolute path without a trailing slash");
  }
}

export function createJsonToolHandler(options: McpAdapterOptions & {
  jsonPath?: string;
  maxBodyBytes?: number;
}) {
  const path = options.jsonPath!;
  assertJsonPath(path);
  const access = createToolAccess(options);
  const shutdown = new AbortController();
  return {
    close() { shutdown.abort(); },
    async handle(request: Request, authInfo: AuthInfo): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      const context = requestContext(request, authInfo,
        AbortSignal.any([request.signal, shutdown.signal]));
      if (pathname === path) {
        if (request.method !== "GET") return jsonError(405, -32600, "use GET for tool discovery");
        const instructions = options.instructions ?? options.source.instructions;
        return Response.json({
          ...(instructions === undefined ? {} : { instructions }),
          tools: (await access.list(context)).map(describeTool),
        });
      }
      if (request.method !== "POST") return jsonError(405, -32600, "use POST for tool invocation");
      if (request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
        return jsonError(415, -32600, "tool invocation requires application/json");
      }
      let name: string;
      try {
        name = decodeURIComponent(pathname.slice(path.length + 1));
      } catch {
        return jsonError(400, -32600, "invalid tool name");
      }
      let input: unknown;
      try {
        input = await boundedJson(request, options.maxBodyBytes ?? 4 * 1024 * 1024);
        if (input === undefined) throw new SyntaxError("empty JSON input");
      } catch (error) {
        if (error instanceof BodyTooLargeError) return jsonError(413, -32600, "request body too large");
        return jsonError(400, -32700, "parse error");
      }
      const outcome = await access.invoke(name, input, context, false);
      return Response.json(outcome, {
        status: !outcome.ok && outcome.code === "TOOL_NOT_FOUND" ? 404 : 200,
      });
    },
  };
}

/** Supply the existing host context seam without inventing an MCP session.
 * Protocol-specific callbacks fail explicitly on the request/response route. */
function requestContext(request: Request, authInfo: AuthInfo, signal: AbortSignal): ServerContext {
  const unsupported = async (): Promise<never> => {
    throw new Error("MCP client interaction is unavailable on JSON HTTP routes");
  };
  return {
    http: { req: request, authInfo },
    mcpReq: {
      id: randomUUID(),
      method: request.method === "GET" ? "tools/list" : "tools/call",
      signal,
      requestState: () => undefined,
      send: unsupported,
      notify: unsupported,
      log: unsupported,
      elicitInput: unsupported,
      requestSampling: unsupported,
    },
  };
}
