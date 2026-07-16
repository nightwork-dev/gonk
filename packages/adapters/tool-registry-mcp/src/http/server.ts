import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";

import type { HttpMcpServer, HttpMcpServerOptions } from "./types.ts";
import {
  createWebMcpHandler,
  type WebMcpHandler,
  type WebMcpHandlerOptions,
} from "./web.ts";

const JSONRPC = "2.0";

function sendJsonError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string
): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ jsonrpc: JSONRPC, error: { code, message }, id: null })
  );
}

/** Serve the framework-neutral Web handler on a standalone node:http listener.
 *  Applications should mount createWebMcpHandler directly in their own router. */
export function createHttpMcpServer(
  options: HttpMcpServerOptions
): HttpMcpServer {
  const host = options.host ?? "127.0.0.1";
  const requestedPort = options.port ?? 0;
  const path = options.path ?? "/mcp";

  if (
    !isLoopbackHost(host) &&
    !options.apiKey &&
    !options.authenticate &&
    options.allowInsecure !== true
  ) {
    throw new Error(
      `Refusing to bind ${host} with no apiKey or authenticate callback: this exposes unauthenticated tool execution to the network. ` +
        `Set apiKey, provide authenticate, bind a loopback host (127.0.0.1), or pass allowInsecure:true to deliberately accept the exposure.`
    );
  }
  if (!options.makeAuthContext && options.allowUnrestrictedTools !== true) {
    throw new Error(
      "HTTP MCP requires makeAuthContext or explicit allowUnrestrictedTools:true"
    );
  }

  const dnsProtection =
    options.enableDnsRebindingProtection ??
    (isLoopbackHost(host) ||
      options.allowedHosts !== undefined ||
      options.allowInsecure !== true);
  if (dnsProtection && !isLoopbackHost(host) && !options.allowedHosts?.length) {
    throw new Error(
      `Refusing to bind ${host} with DNS-rebinding protection on and no allowedHosts: ` +
        `a non-loopback bind can't be auto-allowlisted. Set allowedHosts, pass allowInsecure:true, ` +
        `or set enableDnsRebindingProtection:false explicitly.`
    );
  }

  let boundPort = requestedPort;
  let webHandler: WebMcpHandler | undefined;
  const httpServer: HttpServer = createServer((req, res) => {
    void handle(req, res).catch(() =>
      sendJsonError(res, 500, -32603, "internal error")
    );
  });

  async function handle(
    req: IncomingMessage,
    res: ServerResponse
  ): Promise<void> {
    const requestPath = (req.url ?? "").split("?")[0];
    if (requestPath !== path)
      return sendJsonError(
        res,
        404,
        -32601,
        `no MCP endpoint at ${requestPath}`
      );
    if (!webHandler)
      return sendJsonError(res, 503, -32000, "MCP server is starting");

    const request = toWebRequest(req, host, boundPort);
    const response = await webHandler.handle(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) {
      res.end();
      return;
    }
    Readable.fromWeb(
      response.body as import("node:stream/web").ReadableStream
    ).pipe(res);
  }

  return {
    start() {
      return new Promise<void>((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(requestedPort, host, () => {
          httpServer.removeListener("error", reject);
          const address = httpServer.address();
          if (address && typeof address === "object") boundPort = address.port;
          webHandler = createWebMcpHandler(
            toWebOptions(options, dnsProtection, host, boundPort)
          );
          resolve();
        });
      });
    },
    async stop() {
      await webHandler?.close();
      webHandler = undefined;
      await new Promise<void>((resolve, reject) =>
        httpServer.close((error) => (error ? reject(error) : resolve()))
      );
    },
    get port() {
      return boundPort;
    },
  };
}

function toWebOptions(
  options: HttpMcpServerOptions,
  dnsProtection: boolean,
  host: string,
  port: number
): WebMcpHandlerOptions {
  const { host: _host, port: _port, path: _path, ...adapter } = options;
  return {
    ...adapter,
    ...(isLoopbackHost(host) || options.allowInsecure === true
      ? { allowInsecure: true }
      : {}),
    writeToolPolicy: options.writeToolPolicy ?? "require-allowlist",
    enableDnsRebindingProtection: dnsProtection,
    ...(dnsProtection
      ? {
          allowedHosts: options.allowedHosts ?? defaultAllowedHosts(host, port),
        }
      : {}),
  };
}

function toWebRequest(
  req: IncomingMessage,
  host: string,
  port: number
): Request {
  const headers = new Headers();
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    const name = req.rawHeaders[index];
    const value = req.rawHeaders[index + 1];
    if (name && value) headers.append(name, value);
  }
  const method = req.method ?? "GET";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = Readable.toWeb(req) as unknown as NonNullable<
      RequestInit["body"]
    >;
    init.duplex = "half";
  }
  return new Request(
    new URL(
      req.url ?? "/",
      `http://${headers.get("host") ?? `${host}:${port}`}`
    ),
    init
  );
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    /^127\./.test(host)
  );
}

function defaultAllowedHosts(host: string, port: number): string[] {
  const hosts = new Set<string>([`${host}:${port}`]);
  if (isLoopbackHost(host)) {
    hosts.add(`127.0.0.1:${port}`);
    hosts.add(`localhost:${port}`);
    hosts.add(`[::1]:${port}`);
  }
  return [...hosts];
}
