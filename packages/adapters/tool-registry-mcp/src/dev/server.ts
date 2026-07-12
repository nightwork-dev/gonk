import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import { currentDevMcpEnvironment, type DevMcpEnvironment } from "./config.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export interface DevMcpRouterOptions {
  /** Manifest read before every new MCP initialization. */
  configPath?: string;
  host?: string;
  port?: number;
  path?: string;
  /** Required for non-loopback binds unless `allowInsecure` is explicit. */
  apiKey?: string;
  /** Explicitly allow a keyless network-visible dev router. */
  allowInsecure?: boolean;
}

export interface DevMcpRouter {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly port: number;
}

interface SessionTarget {
  environment: DevMcpEnvironment;
  /** The upstream's session id is never exposed as the router's public id. */
  upstreamSessionId: string;
  readOnlyTools: Set<string>;
}

interface JsonRpcRequest {
  method?: string;
  params?: { name?: string };
}

/**
 * A stable streamable-HTTP MCP address that proxies to the selected development
 * environment. An MCP session is pinned to the target chosen at initialize;
 * `gonk-mcp-dev use` only affects new sessions, so reconnecting is intentional
 * and never silently changes a live session underneath a caller.
 */
export function createDevMcpRouter(options: DevMcpRouterOptions = {}): DevMcpRouter {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 8810;
  const path = options.path ?? "/mcp";
  if (!isLoopbackHost(host) && !options.apiKey && options.allowInsecure !== true) {
    throw new Error(`Refusing to bind ${host} with no apiKey: a dev MCP router can proxy write-capable tools. Set apiKey, bind loopback, or pass allowInsecure:true deliberately.`);
  }

  const sessions = new Map<string, SessionTarget>();
  let boundPort = requestedPort;
  const server: HttpServer = createServer((req, res) => {
    void handle(req, res).catch((error) => {
      if (!res.headersSent) sendJsonError(res, 502, error instanceof Error ? error.message : "dev MCP proxy error");
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if ((req.url ?? "").split("?")[0] !== path) return sendJsonError(res, 404, `no dev MCP endpoint at ${path}`);
    if (!hasValidBearer(req.headers.authorization, options.apiKey)) return sendJsonError(res, 401, "unauthorized");

    const sessionId = header(req.headers, "mcp-session-id");
    const body = await readBody(req);
    const rpc = parseJsonRpc(body);
    const isInitialize = rpc?.method === "initialize" && !sessionId;

    let session: SessionTarget | undefined;
    if (sessionId) {
      session = sessions.get(sessionId);
      if (!session) return sendJsonError(res, 404, "unknown session; reconnect to select the active environment");
    } else if (isInitialize) {
      session = { environment: await currentDevMcpEnvironment(options.configPath), upstreamSessionId: "", readOnlyTools: new Set() };
    } else {
      return sendJsonError(res, 400, "missing Mcp-Session-Id and not an initialize request");
    }

    const upstream = await proxy(req, body, session.environment, sessionId ? session.upstreamSessionId : undefined);
    const upstreamSessionId = upstream.headers.get("mcp-session-id");
    let clientSessionId = sessionId;
    if (isInitialize && upstreamSessionId) {
      session.upstreamSessionId = upstreamSessionId;
      clientSessionId = randomUUID();
      sessions.set(clientSessionId, session);
    }

    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set("X-Gonk-Dev-Environment", session.environment.id);
    responseHeaders.set("X-Gonk-Dev-Repository", session.environment.repo);
    responseHeaders.set("X-Gonk-Dev-Branch", session.environment.branch);
    if (session.environment.database) responseHeaders.set("X-Gonk-Dev-Database", session.environment.database);
    if (clientSessionId) responseHeaders.set("Mcp-Session-Id", clientSessionId);

    const contentType = responseHeaders.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = await upstream.text();
      const transformed = annotateJsonResponse(payload, rpc, session);
      writeHeaders(res, upstream.status, responseHeaders);
      res.end(transformed);
    } else {
      writeHeaders(res, upstream.status, responseHeaders);
      if (upstream.body) Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
      else res.end();
    }

    if (req.method === "DELETE" && sessionId) sessions.delete(sessionId);
  }

  return {
    start() {
      return new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(requestedPort, host, () => {
          server.removeListener("error", reject);
          const address = server.address();
          if (address && typeof address === "object") boundPort = address.port;
          resolve();
        });
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
    get port() {
      return boundPort;
    },
  };
}

async function proxy(req: IncomingMessage, body: Buffer, environment: DevMcpEnvironment, upstreamSessionId?: string): Promise<Response> {
  const target = new URL(environment.endpoint);
  // The public router path need not equal the app's MCP path. Preserve only the
  // caller's query string; the configured target owns the destination pathname.
  const incoming = new URL(req.url ?? "", "http://gonk-dev-router.invalid");
  target.search = incoming.search;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    // Router credentials authenticate the front door only. Never leak that
    // bearer token into an app environment; endpoint credentials live in the
    // selected manifest's static headers instead.
    if (name === "host" || name === "content-length" || name === "mcp-session-id" || name === "authorization" || value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  for (const [name, value] of Object.entries(environment.headers ?? {})) headers.set(name, value);
  if (upstreamSessionId) headers.set("Mcp-Session-Id", upstreamSessionId);
  return fetch(target, {
    ...(req.method ? { method: req.method } : {}),
    headers,
    ...(body.length ? { body } : {}),
  });
}

function annotateJsonResponse(payload: string, rpc: JsonRpcRequest | undefined, session: SessionTarget): string {
  let response: Record<string, unknown>;
  try {
    response = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return payload;
  }
  if (rpc?.method === "tools/list") annotateToolList(response, session);
  if (rpc?.method === "tools/call" && !session.readOnlyTools.has(rpc.params?.name ?? "")) annotatePossibleWrite(response, session.environment);
  return JSON.stringify(response);
}

function annotateToolList(response: Record<string, unknown>, session: SessionTarget): void {
  const tools = resultRecord(response)?.tools;
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== "string") continue;
    const readOnly = isRecord(tool.annotations) && tool.annotations.readOnlyHint === true;
    if (readOnly) {
      session.readOnlyTools.add(tool.name);
      continue;
    }
    const description = typeof tool.description === "string" ? tool.description : "";
    tool.description = `${description}${description ? "\n\n" : ""}${targetNotice(session.environment)} Possible write: this call is routed to the environment shown here.`;
  }
}

function annotatePossibleWrite(response: Record<string, unknown>, environment: DevMcpEnvironment): void {
  const result = resultRecord(response);
  if (!result) return;
  const content = result.content;
  if (!Array.isArray(content)) return;
  content.push({ type: "text", text: `${targetNotice(environment)} This call was routed here because it is not declared read-only.` });
}

function targetNotice(environment: DevMcpEnvironment): string {
  return `[DEV TARGET: ${environment.id}; repo: ${environment.repo}; branch: ${environment.branch}; database: ${environment.database ?? "unspecified"}]`;
}

function resultRecord(response: Record<string, unknown>): Record<string, unknown> | undefined {
  return isRecord(response.result) ? response.result : undefined;
}

function parseJsonRpc(body: Buffer): JsonRpcRequest | undefined {
  if (!body.length) return undefined;
  try {
    const value = JSON.parse(body.toString("utf8"));
    return isRecord(value) ? value as JsonRpcRequest : undefined;
  } catch {
    return undefined;
  }
}

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function writeHeaders(res: ServerResponse, status: number, headers: Headers): void {
  for (const [name, value] of headers) {
    if (name === "transfer-encoding" || name === "content-length") continue;
    res.setHeader(name, value);
  }
  res.statusCode = status;
}

function sendJsonError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }));
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
}

function hasValidBearer(value: string | undefined, apiKey: string | undefined): boolean {
  return !apiKey || value === `Bearer ${apiKey}`;
}

function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "::1" || host === "[::1]" || /^127\./.test(host);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
