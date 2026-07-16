import { randomUUID, timingSafeEqual } from "node:crypto";

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

import {
  isAuthenticatedPrincipal,
  securityContextKey,
  type AuthAuditSink,
  type AuthContext,
  type AuthenticatedPrincipal,
} from "@gonk/auth";

import {
  GONK_AUTH_INFO_PRINCIPAL,
  createMcpServer,
  type McpAdapterOptions,
} from "../index.ts";

const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024;
const LOCAL_DEVELOPMENT_CLIENT_ID = "gonk-web-keyless-development";

export interface WebMcpHandlerOptions extends McpAdapterOptions {
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
}

export interface WebMcpHandler {
  handle(request: Request): Promise<Response>;
  close(): Promise<void>;
}

interface AuthenticatedRequest {
  authInfo: AuthInfo;
  principal: AuthenticatedPrincipal;
  securityContextKey: string;
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
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const hostMakeAuthContext = options.makeAuthContext;

  async function authenticate(request: Request): Promise<AuthenticatedRequest> {
    let authInfo: AuthInfo;
    if (options.authenticate) {
      const info = await options.authenticate(request);
      if (!info) throw new UnauthorizedError();
      authInfo = info;
    } else if (options.apiKey) {
      const token = bearerToken(request.headers.get("authorization"));
      if (!token || !constantTimeEqual(token, options.apiKey)) {
        throw new UnauthorizedError();
      }
      const principal = staticBearerPrincipal(
        options.staticBearerClientId ?? "static-bearer"
      );
      authInfo = {
        token,
        clientId: principal.identity.subject,
        scopes: [...principal.scopes],
        extra: { [GONK_AUTH_INFO_PRINCIPAL]: principal },
      };
    } else {
      const principal = localDevelopmentPrincipal();
      authInfo = {
        token: "",
        clientId: LOCAL_DEVELOPMENT_CLIENT_ID,
        scopes: [...principal.scopes],
        extra: { [GONK_AUTH_INFO_PRINCIPAL]: principal },
      };
    }
    const principal = principalFromAuthInfo(authInfo);
    if (
      !principal ||
      isExpired(authInfo, principal) ||
      !hasStatefulDelegationBinding(principal)
    ) {
      throw new UnauthorizedError();
    }
    return {
      authInfo,
      principal,
      securityContextKey: securityContextKey({ principal }),
    };
  }

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

    const sessionId = request.headers.get("mcp-session-id") ?? undefined;
    if (request.method === "POST") {
      const session = sessionId
        ? await boundSession(sessions, sessionId, authenticated, options)
        : undefined;
      if (sessionId && !session) {
        return jsonError(404, -32001, "unknown session");
      }

      let parsedBody: unknown;
      try {
        parsedBody = await boundedJson(request, maxBodyBytes);
      } catch (error) {
        if (error instanceof BodyTooLargeError)
          return jsonError(413, -32600, "request body too large");
        return jsonError(400, -32700, "parse error");
      }

      if (session) {
        return session.transport.handleRequest(request, {
          parsedBody,
          authInfo: authenticated.authInfo,
        });
      }

      if (!isInitializeRequest(parsedBody)) {
        return jsonError(
          400,
          -32600,
          "missing session id and not an initialize request"
        );
      }

      const transport: WebStandardStreamableHTTPServerTransport =
        new WebStandardStreamableHTTPServerTransport({
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
          ...(options.enableDnsRebindingProtection === undefined
            ? {}
            : {
                enableDnsRebindingProtection:
                  options.enableDnsRebindingProtection,
              }),
          ...(options.allowedHosts === undefined
            ? {}
            : { allowedHosts: options.allowedHosts }),
          ...(options.allowedOrigins === undefined
            ? {}
            : { allowedOrigins: options.allowedOrigins }),
        });
      const adapter = createMcpServer({
        ...options,
        writeToolPolicy: options.writeToolPolicy ?? "require-allowlist",
        makeAuthContext: async (extra) => {
          const principal = principalFromAuthInfo(extra.authInfo);
          if (
            !principal ||
            isExpired(extra.authInfo, principal) ||
            !hasStatefulDelegationBinding(principal)
          ) {
            throw new UnauthorizedError();
          }
          if (!hostMakeAuthContext) {
            return allowAllAuthContext(principal);
          }
          const hostContext = await hostMakeAuthContext(extra);
          if (
            securityContextKey({ principal: hostContext.principal }) !==
            securityContextKey({ principal })
          ) {
            throw new Error(
              "Web MCP authentication and authorization resolved different principals"
            );
          }
          return hostContext;
        },
      });
      await adapter.connect(transport as Transport);
      const previousOnClose = transport.onclose;
      transport.onclose = () => {
        previousOnClose?.();
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      return transport.handleRequest(request, {
        parsedBody,
        authInfo: authenticated.authInfo,
      });
    }

    if (request.method === "GET" || request.method === "DELETE") {
      if (!sessionId) return jsonError(400, -32600, "missing Mcp-Session-Id");
      const session = await boundSession(
        sessions,
        sessionId,
        authenticated,
        options
      );
      if (!session) return jsonError(404, -32001, "unknown session");
      return session.transport.handleRequest(request, {
        authInfo: authenticated.authInfo,
      });
    }

    return jsonError(405, -32600, `method ${request.method} not allowed`);
  }

  return {
    handle,
    async close() {
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

class BodyTooLargeError extends Error {}
class UnauthorizedError extends Error {}

async function boundedJson(
  request: Request,
  maxBytes: number
): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes)
    throw new BodyTooLargeError();
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

function principalFromAuthInfo(
  authInfo: AuthInfo | undefined
): AuthenticatedPrincipal | undefined {
  const principal = authInfo?.extra?.[GONK_AUTH_INFO_PRINCIPAL];
  return isAuthenticatedPrincipal(principal) ? principal : undefined;
}

function isExpired(
  authInfo: AuthInfo | undefined,
  principal: AuthenticatedPrincipal
): boolean {
  const now = Math.floor(Date.now() / 1000);
  return (
    (authInfo?.expiresAt !== undefined && authInfo.expiresAt <= now) ||
    (principal.expiresAt !== undefined && principal.expiresAt <= now)
  );
}

function hasStatefulDelegationBinding(
  principal: AuthenticatedPrincipal
): boolean {
  return (
    principal.delegation === undefined ||
    principal.delegation.actorSessionId !== undefined
  );
}

function staticBearerPrincipal(clientId: string): AuthenticatedPrincipal {
  return {
    id: `service:static-bearer:${clientId}`,
    kind: "service",
    identity: {
      issuer: "gonk:static-bearer",
      subject: clientId,
      method: "service-token",
    },
    roles: ["service"],
    scopes: [],
  };
}

function localDevelopmentPrincipal(): AuthenticatedPrincipal {
  return {
    id: `local:${LOCAL_DEVELOPMENT_CLIENT_ID}`,
    kind: "local",
    identity: {
      issuer: "gonk:web-keyless-development",
      subject: LOCAL_DEVELOPMENT_CLIENT_ID,
      method: "local",
    },
    roles: ["local-development"],
    scopes: [],
    attributes: { developmentOnly: true },
  };
}

function allowAllAuthContext(principal: AuthenticatedPrincipal): AuthContext {
  return {
    principal,
    authorize: () => ({
      outcome: "allow",
      reason: "Authenticated transport allowed by default",
    }),
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

function jsonError(
  status: number,
  code: number,
  message: string,
  headers?: Record<string, string>
): Response {
  return Response.json(
    { jsonrpc: "2.0", error: { code, message }, id: null },
    { status, ...(headers ? { headers } : {}) }
  );
}
