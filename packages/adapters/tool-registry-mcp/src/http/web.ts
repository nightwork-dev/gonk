import { randomUUID, timingSafeEqual } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createMcpServer, type McpAdapterOptions } from "../index.ts";

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface WebMcpHandlerOptions extends McpAdapterOptions {
  /** Simple bearer credential for app-owned endpoints. For richer identity,
   *  provide authenticate and return SDK AuthInfo with host data in extra. */
  apiKey?: string;
  authenticate?: (request: Request) => AuthInfo | null | Promise<AuthInfo | null>;
  maxBodyBytes?: number;
  enableJsonResponse?: boolean;
  enableDnsRebindingProtection?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
}

export interface WebMcpHandler {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

/** Mount a Gonk registry inside any framework that exposes Web Request/Response
 *  route handlers (TanStack Start, Hono, Workers, Bun, Deno). */
export function createWebMcpHandler(options: WebMcpHandlerOptions): WebMcpHandler {
  if (options.apiKey && options.authenticate) {
    throw new Error("configure apiKey or authenticate, not both");
  }
  const transports = new Map<string, WebStandardStreamableHTTPServerTransport>();
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;

  async function authenticate(request: Request): Promise<AuthInfo | undefined> {
    if (options.authenticate) {
      const info = await options.authenticate(request);
      if (!info) throw new UnauthorizedError();
      return info;
    }
    if (!options.apiKey) return undefined;
    const token = bearerToken(request.headers.get("authorization"));
    if (!token || !constantTimeEqual(token, options.apiKey)) throw new UnauthorizedError();
    return { token, clientId: "bearer", scopes: [] };
  }

  async function handle(request: Request): Promise<Response> {
    let authInfo: AuthInfo | undefined;
    try {
      authInfo = await authenticate(request);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return jsonError(401, -32001, "unauthorized", { "www-authenticate": "Bearer" });
      }
      throw error;
    }

    const sessionId = request.headers.get("mcp-session-id") ?? undefined;
    if (request.method === "POST") {
      let parsedBody: unknown;
      try {
        parsedBody = await boundedJson(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError) return jsonError(413, -32600, "request body too large");
        return jsonError(400, -32700, "parse error");
      }

      if (sessionId) {
        const transport = transports.get(sessionId);
        if (!transport) return jsonError(404, -32001, "unknown session");
        return transport.handleRequest(request, { parsedBody, ...(authInfo ? { authInfo } : {}) });
      }

      if (!isInitializeRequest(parsedBody)) {
        return jsonError(400, -32600, "missing session id and not an initialize request");
      }

      const transport: WebStandardStreamableHTTPServerTransport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id): void => { transports.set(id, transport); },
        onsessionclosed: (id): void => { transports.delete(id); },
        ...(options.enableJsonResponse === undefined ? {} : { enableJsonResponse: options.enableJsonResponse }),
        ...(options.enableDnsRebindingProtection === undefined ? {} : { enableDnsRebindingProtection: options.enableDnsRebindingProtection }),
        ...(options.allowedHosts === undefined ? {} : { allowedHosts: options.allowedHosts }),
        ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
      });
      const adapter = createMcpServer({
        ...options,
        writeToolPolicy: options.writeToolPolicy ?? "require-allowlist",
      });
      await adapter.connect(transport as Transport);
      const previousOnClose = transport.onclose;
      transport.onclose = () => {
        previousOnClose?.();
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      return transport.handleRequest(request, { parsedBody, ...(authInfo ? { authInfo } : {}) });
    }

    if (request.method === "GET" || request.method === "DELETE") {
      if (!sessionId) return jsonError(400, -32600, "missing Mcp-Session-Id");
      const transport = transports.get(sessionId);
      if (!transport) return jsonError(404, -32001, "unknown session");
      return transport.handleRequest(request, authInfo ? { authInfo } : undefined);
    }

    return jsonError(405, -32600, `method ${request.method} not allowed`);
  }

  return {
    handle,
    async close() {
      const active = [...transports.values()];
      transports.clear();
      await Promise.all(active.map((transport) => transport.close().catch(() => {})));
    },
  };
}

class BodyTooLargeError extends Error {}
class UnauthorizedError extends Error {}

async function boundedJson(request: Request, maxBytes: number): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) throw new BodyTooLargeError();
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > maxBytes) throw new BodyTooLargeError();
  const text = new TextDecoder().decode(bytes);
  return text ? JSON.parse(text) : undefined;
}

function bearerToken(header: string | null): string | undefined {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1];
}

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function jsonError(status: number, code: number, message: string, headers?: Record<string, string>): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, ...(headers ? { headers } : {}) },
  );
}
