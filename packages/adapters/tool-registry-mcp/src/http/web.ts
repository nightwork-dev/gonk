import { randomUUID } from "node:crypto";
import {
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isInitializeRequest,
  isLegacyRequest,
} from "@modelcontextprotocol/server";
import type { AuthInfo, Transport } from "@modelcontextprotocol/server";
import type { AuthAuditSink } from "@gonk/auth";

import {
  createMcpServer,
  type McpAdapterOptions,
} from "../index.ts";

import { createJsonToolHandler, matchesJsonPath } from "./json.ts";
import {
  boundedJson, BodyTooLargeError, jsonError, protectRequest,
} from "./web-request.ts";
import {
  createRequestAuthenticator,
  createRequestAuthContext,
  UnauthorizedError,
  type AuthenticatedRequest,
} from "./web-auth.ts";

export interface WebMcpHandlerOptions
  extends Omit<McpAdapterOptions, "makeAuthContext"> {
  /** Host-owned per-request authorization policy. Optional HERE (unlike the
   *  stdio `McpAdapterOptions.makeAuthContext`, which is required)
   *  because this handler has its own explicit, guarded escape hatch:
   *  construction throws below unless either this is set or
   *  `allowUnrestrictedTools` is `true`. The internal `makeAuthContext`
   *  passed to `createMcpServer` further down always resolves a concrete
   *  `AuthContext` — core never receives an ambient one. */
  makeAuthContext?: McpAdapterOptions["makeAuthContext"];
  /** Simple bearer credential for app-owned endpoints. For richer identity,
   *  provide authenticate and return SDK AuthInfo with host data in extra. */
  apiKey?: string;
  /** Stable client identity used for the synthetic static-bearer principal. */
  staticBearerClientId?: string;
  authenticate?: (
    request: Request
  ) => AuthInfo | null | Promise<AuthInfo | null>;
  /** Optional redacted sink for rejected cross-principal session reuse. */
  sessionAuditSink?: AuthAuditSink;
  /** Explicitly allow a credential-free mounted route. The mountable handler
   *  cannot infer loopback safety from a framework-owned listener. */
  allowInsecure?: boolean;
  /** Explicit trusted-service mode: authentication establishes the principal
   *  and every registry action is authorized. Prefer makeAuthContext. */
  allowUnrestrictedTools?: boolean;
  maxBodyBytes?: number;
  enableJsonResponse?: boolean;
  enableDnsRebindingProtection?: boolean;
  allowedHosts?: string[];
  allowedOrigins?: string[];
  /** Opt in to GET discovery and POST /:name raw JSON invocation at this path. */
  jsonPath?: string;
}

export interface WebMcpHandler {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

interface AuthenticatedSession {
  transport: WebStandardStreamableHTTPServerTransport;
  securityContextKey: string;
}

/** Mount a Gonk registry inside a Node-compatible framework that exposes Web
 *  Request/Response route handlers (for example TanStack Start or Hono). */
export function createWebMcpHandler(
  options: WebMcpHandlerOptions
): WebMcpHandler {
  if (options.apiKey && options.authenticate) {
    throw new Error("configure apiKey or authenticate, not both");
  }
  if (
    !options.apiKey &&
    !options.authenticate &&
    options.allowInsecure !== true
  ) {
    throw new Error(
      "createWebMcpHandler requires apiKey, authenticate, or explicit allowInsecure:true"
    );
  }
  if (!options.makeAuthContext && options.allowUnrestrictedTools !== true) {
    throw new Error(
      "createWebMcpHandler requires makeAuthContext or explicit allowUnrestrictedTools:true"
    );
  }
  const sessions = new Map<string, AuthenticatedSession>();
  const maxBodyBytes = options.maxBodyBytes ?? 4 * 1024 * 1024;

  const authenticate = createRequestAuthenticator(options);
  const makeAuthContext = createRequestAuthContext(options);
  const adapterOptions: McpAdapterOptions = {
    ...options,
    makeAuthContext,
    writeToolPolicy: options.writeToolPolicy ?? "require-allowlist",
  };
  const modern = createMcpHandler(() => createMcpServer(adapterOptions).server, {
    legacy: "reject",
    ...(options.enableJsonResponse === undefined
      ? {}
      : { responseMode: options.enableJsonResponse ? "json" : "sse" }),
  });
  const json = options.jsonPath === undefined
    ? undefined
    : createJsonToolHandler({
        ...adapterOptions,
        maxBodyBytes,
      });

  async function handle(request: Request): Promise<Response> {
    let authenticated: AuthenticatedRequest;
    try {
      authenticated = await authenticate(request);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return jsonError(401, -32001, "unauthorized", {
          "www-authenticate": "Bearer",
        });
      }
      throw error;
    }

    const protectionError = protectRequest(request, options);
    if (protectionError) return protectionError;
    if (json && matchesJsonPath(new URL(request.url).pathname, options.jsonPath!)) {
      return json.handle(request, authenticated.authInfo);
    }

    const method = request.method;
    if (method !== "POST" && method !== "GET" && method !== "DELETE") {
      return jsonError(405, -32600, `method ${method} not allowed`);
    }

    const sessionId = request.headers.get("mcp-session-id");
    const session = sessionId
      ? await boundSession(sessions, sessionId, authenticated, options)
      : undefined;
    if (sessionId && !session) {
      return jsonError(404, -32001, "unknown session");
    }

    let parsedBody: unknown;
    if (method === "POST") {
      try {
        parsedBody = await boundedJson(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError) {
          return jsonError(413, -32600, "request body too large");
        }
        return jsonError(400, -32700, "parse error");
      }
      if (parsedBody === undefined) return jsonError(400, -32700, "parse error");
    }

    const requestOptions = { parsedBody, authInfo: authenticated.authInfo };
    if (!(await isLegacyRequest(request, parsedBody))) {
      return modern.fetch(request, requestOptions);
    }
    if (session) {
      return session.transport.handleRequest(request, requestOptions);
    }
    if (method !== "POST") {
      return jsonError(400, -32600, "missing Mcp-Session-Id");
    }
    if (!isInitializeRequest(parsedBody)) {
      return jsonError(
        400,
        -32600,
        "missing session id and not an initialize request"
      );
    }

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id): void => {
        sessions.set(id, {
          transport,
          securityContextKey: authenticated.securityContextKey,
        });
      },
      onsessionclosed: (id): void => {
        sessions.delete(id);
      },
      ...(options.enableJsonResponse === undefined
        ? {}
        : { enableJsonResponse: options.enableJsonResponse }),
    });
    const adapter = createMcpServer(adapterOptions);
    await adapter.connect(transport as Transport);
    const previousOnClose = transport.onclose;
    transport.onclose = () => {
      previousOnClose?.();
      if (transport.sessionId) sessions.delete(transport.sessionId);
    };
    return transport.handleRequest(request, requestOptions);
  }

  return {
    handle,
    async close() {
      json?.close();
      await modern.close();
      const active = new Set(
        [...sessions.values()].map((session) => session.transport)
      );
      sessions.clear();
      await Promise.all(
        [...active].map((transport) =>
          transport.close().catch((error) => {
            options.log?.warn("MCP transport close failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          })
        )
      );
    },
  };
}

async function boundSession(
  sessions: ReadonlyMap<string, AuthenticatedSession>,
  sessionId: string,
  authenticated: AuthenticatedRequest,
  options: Pick<WebMcpHandlerOptions, "log" | "sessionAuditSink">
): Promise<AuthenticatedSession | undefined> {
  const session = sessions.get(sessionId);
  if (!session) return undefined;
  if (session.securityContextKey !== authenticated.securityContextKey) {
    options.log?.warn(
      "Rejected MCP session reuse under a different security context",
      { principalId: authenticated.principal.id }
    );
    if (options.sessionAuditSink) {
      try {
        await options.sessionAuditSink.write({
          kind: "session-binding",
          requestId: randomUUID(),
          principalId: authenticated.principal.id,
          securityContextKey: authenticated.securityContextKey,
          subjectIssuer: authenticated.principal.identity.issuer,
          subjectId: authenticated.principal.identity.subject,
          ...(authenticated.principal.delegation === undefined
            ? {}
            : {
                actorIssuer: authenticated.principal.delegation.actor.issuer,
                actorSubject: authenticated.principal.delegation.actor.subject,
                actorId: authenticated.principal.delegation.actorId,
                ...(authenticated.principal.delegation.actorSessionId ===
                undefined
                  ? {}
                  : {
                      actorSessionId:
                        authenticated.principal.delegation.actorSessionId,
                    }),
              }),
          ...(authenticated.principal.tenantId === undefined
            ? {}
            : { tenantId: authenticated.principal.tenantId }),
          ...(authenticated.principal.workspaceId === undefined
            ? {}
            : { workspaceId: authenticated.principal.workspaceId }),
          timestamp: new Date().toISOString(),
          transport: "mcp",
          outcome: "mismatch",
          reason:
            "MCP session was presented under a different security context",
        });
      } catch {
        options.log?.error("MCP session mismatch audit failed");
      }
    }
    return undefined;
  }
  return session;
}
