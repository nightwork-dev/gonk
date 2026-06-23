import { randomUUID } from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import { createMcpServer, type McpAdapterOptions } from "../index.ts";

import { checkBearer } from "./auth.ts";
import type { HttpMcpServer, HttpMcpServerOptions } from "./types.ts";

const MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MB — bound the request body
const JSONRPC = "2.0";

class BodyTooLargeError extends Error {}

function sendJsonError(res: ServerResponse, status: number, code: number, message: string): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: JSONRPC, error: { code, message }, id: null }));
}

function headerStr(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let rejected = false;
    req.on("data", (c: Buffer) => {
      if (rejected) return;
      total += c.length;
      if (total > MAX_BODY_BYTES) {
        rejected = true;
        reject(new BodyTooLargeError("request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (!rejected) resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", reject);
  });
}

/** Strip the HTTP-only fields, leaving the McpAdapterOptions passed straight to
 *  `createMcpServer`. The tool→MCP mapping is reused wholesale — never forked. */
function toMcpOptions(o: HttpMcpServerOptions): McpAdapterOptions {
  const {
    host: _h,
    port: _p,
    apiKey: _k,
    path: _path,
    enableDnsRebindingProtection: _d,
    allowedHosts: _ah,
    ...mcp
  } = o;
  // Network endpoint: gate write-capable tools by default (the stdio adapter
  // defaults to "warn"; crossing a network trust boundary warrants the stricter
  // default — an operator opts into "warn"/"permissive" explicitly).
  return { ...mcp, writeToolPolicy: o.writeToolPolicy ?? "require-allowlist" };
}

/**
 * Serve a gonk tool registry over **streamable-HTTP MCP**. Reuses
 * `@gonk/tool-registry-mcp`'s `createMcpServer` (the tool→MCP mapping) wholesale
 * and binds the SDK's `StreamableHTTPServerTransport` on a `node:http` server,
 * with the MCP session lifecycle (`Mcp-Session-Id`) and optional bearer auth.
 * A fresh MCP server is created per session (cheap — it only wires handlers).
 */
export function createHttpMcpServer(options: HttpMcpServerOptions): HttpMcpServer {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const path = options.path ?? "/mcp";
  const apiKey = options.apiKey;

  // Security posture guard. A server reachable beyond loopback with no bearer
  // key is an unauthenticated tool-execution endpoint — anyone who can reach
  // the port can call tools. Refuse to stand one up unless the caller has
  // deliberately acknowledged the exposure via `allowInsecure`. This checks the
  // bind address the code actually uses, instead of trusting that "it's only on
  // my private network" (which the code can't verify).
  if (!isLoopbackHost(host) && !apiKey && options.allowInsecure !== true) {
    throw new Error(
      `Refusing to bind ${host} with no apiKey: this exposes unauthenticated tool ` +
        `execution to the network. Set apiKey, bind a loopback host (127.0.0.1), or ` +
        `pass allowInsecure:true to deliberately accept the exposure.`,
    );
  }

  // DNS-rebinding protection (see types.ts). It stops a malicious web page from
  // rebinding its domain onto this host and POSTing to it. The default is on —
  // BUT the auto-allowlist (the bound host:port) is only sound for a loopback
  // bind, where the client's Host header is exactly that. For a non-loopback
  // bind the bound address can't be auto-allowlisted: a wildcard like 0.0.0.0
  // is never a client's Host, and even a concrete external bind may be reached
  // via a different name/IP. So for a non-loopback bind with no explicit
  // allowedHosts, default OFF only when the caller has accepted the network as
  // the boundary (allowInsecure — the keyless trusted-tailnet mode); otherwise
  // default on, which the guard below then rejects unless allowedHosts is set.
  const dnsProtection =
    options.enableDnsRebindingProtection ??
    (isLoopbackHost(host) || options.allowedHosts !== undefined || options.allowInsecure !== true);

  // Silent-dead-server guard. Protection on + a non-loopback bind + no
  // allowedHosts means the only allowlist we could synthesize is the bound
  // address — which no real client ever sends as Host (especially a wildcard),
  // so every request would be rejected on the Host check while the port sits
  // open: a server that looks up and is uniformly dead. Fail loud at
  // construction instead, matching the exposure guard's deliberate-choice
  // posture. (Catches both the default-on and an explicit
  // enableDnsRebindingProtection:true path.)
  if (dnsProtection && !isLoopbackHost(host) && !options.allowedHosts?.length) {
    throw new Error(
      `Refusing to bind ${host} with DNS-rebinding protection on and no allowedHosts: ` +
        `a non-loopback bind can't be auto-allowlisted (a wildcard like 0.0.0.0 is never a ` +
        `client's Host header), so every request would be rejected on the Host check while ` +
        `the port sits open. Set allowedHosts to the host(s) clients will dial, pass ` +
        `allowInsecure:true to rely on the network perimeter (protection off), or set ` +
        `enableDnsRebindingProtection:false explicitly.`,
    );
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();
  let boundPort = requestedPort;

  const httpServer: HttpServer = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) sendJsonError(res, 500, -32603, "internal error");
      else res.end();
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const reqPath = (req.url ?? "").split("?")[0];
    if (reqPath !== path) return sendJsonError(res, 404, -32601, `no MCP endpoint at ${reqPath}`);

    if (!checkBearer(req.headers.authorization, apiKey)) {
      return sendJsonError(res, 401, -32001, "unauthorized");
    }

    const sessionId = headerStr(req.headers["mcp-session-id"]);
    const method = req.method ?? "GET";

    if (method === "POST") {
      let parsed: unknown;
      try {
        const raw = await readBody(req);
        parsed = raw ? JSON.parse(raw) : undefined;
      } catch (err) {
        if (err instanceof BodyTooLargeError) return sendJsonError(res, 413, -32600, "request body too large");
        return sendJsonError(res, 400, -32700, "parse error");
      }

      if (sessionId) {
        const transport = transports.get(sessionId);
        if (!transport) return sendJsonError(res, 404, -32001, "unknown session");
        return transport.handleRequest(req, res, parsed);
      }

      if (isInitializeRequest(parsed)) {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sid) => {
            transports.set(sid, transport);
          },
          onsessionclosed: (sid) => {
            transports.delete(sid);
          },
          enableDnsRebindingProtection: dnsProtection,
          // When protection is on, the Host header must match an allow-listed
          // value. Default to the bound host:port plus loopback aliases so a
          // legitimate client (which sends Host: <bound>) passes while a
          // rebound foreign Host is rejected. boundPort is known here — the
          // transport is built per-session, after start() resolved the port.
          ...(dnsProtection
            ? { allowedHosts: options.allowedHosts ?? defaultAllowedHosts(host, boundPort) }
            : {}),
        });
        const adapter = createMcpServer(toMcpOptions(options));
        // Cast bridges a cross-package exactOptionalPropertyTypes mismatch: the
        // SDK isn't built with exactOptional, so its `onclose?` reads as
        // `(() => void) | undefined`; the transport is structurally a Transport.
        await adapter.connect(transport as Transport);
        // Belt-and-suspenders cleanup: a client that drops without a DELETE never
        // fires onsessionclosed, but the transport's onclose does. Chain after
        // connect (which sets its own onclose) so neither cleanup is lost.
        const prevOnClose = transport.onclose;
        transport.onclose = () => {
          prevOnClose?.();
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        return transport.handleRequest(req, res, parsed);
      }

      return sendJsonError(res, 400, -32600, "missing session id and not an initialize request");
    }

    if (method === "GET" || method === "DELETE") {
      if (!sessionId) return sendJsonError(res, 400, -32600, "missing Mcp-Session-Id");
      const transport = transports.get(sessionId);
      if (!transport) return sendJsonError(res, 404, -32001, "unknown session");
      return transport.handleRequest(req, res);
    }

    return sendJsonError(res, 405, -32600, `method ${method} not allowed`);
  }

  return {
    start() {
      return new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(requestedPort, host, () => {
          httpServer.removeListener("error", reject);
          const addr = httpServer.address();
          if (addr && typeof addr === "object") boundPort = addr.port;
          resolve();
        });
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        for (const t of transports.values()) {
          try {
            void t.close();
          } catch {
            // best-effort
          }
        }
        transports.clear();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      });
    },
    get port() {
      return boundPort;
    },
  };
}

/** A loopback bind is reachable only from the same host, so keyless is
 *  acceptable there; any other bind is potentially network-reachable. */
function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    // 127.0.0.0/8 is entirely loopback.
    /^127\./.test(host)
  );
}

/** Host-header values to allow when DNS-rebinding protection is on: the bound
 *  address, plus loopback aliases a local client might use. */
function defaultAllowedHosts(host: string, port: number): string[] {
  const hosts = new Set<string>([`${host}:${port}`]);
  if (isLoopbackHost(host)) {
    hosts.add(`127.0.0.1:${port}`);
    hosts.add(`localhost:${port}`);
    hosts.add(`[::1]:${port}`);
  }
  return [...hosts];
}
