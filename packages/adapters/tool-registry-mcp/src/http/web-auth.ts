import { timingSafeEqual } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/server";
import {
  isAuthenticatedPrincipal,
  securityContextKey,
  type AuthContext,
  type AuthenticatedPrincipal,
} from "@gonk/auth";
import { GONK_AUTH_INFO_PRINCIPAL, type McpAdapterOptions } from "../index.ts";
import type { WebMcpHandlerOptions } from "./web.ts";

const LOCAL_DEVELOPMENT_CLIENT_ID = "gonk-web-keyless-development";
export interface AuthenticatedRequest {
  authInfo: AuthInfo;
  principal: AuthenticatedPrincipal;
  securityContextKey: string;
}
export class UnauthorizedError extends Error {}

export function createRequestAuthenticator(options: WebMcpHandlerOptions) {
  return async function authenticate(
    request: Request
  ): Promise<AuthenticatedRequest> {
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
  };
}

export function createRequestAuthContext(
  options: WebMcpHandlerOptions
): McpAdapterOptions["makeAuthContext"] {
  return async (ctx) => {
    const principal = principalFromAuthInfo(ctx.http?.authInfo);
    if (
      !principal ||
      isExpired(ctx.http?.authInfo, principal) ||
      !hasStatefulDelegationBinding(principal)
    ) {
      throw new UnauthorizedError();
    }
    if (!options.makeAuthContext) {
      return allowAllAuthContext(principal);
    }
    const hostContext = await options.makeAuthContext(ctx);
    if (
      securityContextKey({ principal: hostContext.principal }) !==
      securityContextKey({ principal })
    ) {
      throw new Error(
        "Web MCP authentication and authorization resolved different principals"
      );
    }
    return hostContext;
  };
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

