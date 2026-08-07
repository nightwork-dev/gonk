// =============================================================================
// Node-touching security machinery for @gonk/auth.
//
// Everything here uses node:crypto and/or node:os — request-boundary
// capture, principal hashing, and the single-owner constructor. NOT part of
// the client-safe surface (`./contracts.ts` never imports this file); a
// browser/UI consumer that only needs the SHAPE of a principal or a receipt
// wants `./types.ts` / `./envelope.ts` instead.
// =============================================================================

import { createHash } from "node:crypto";
import { hostname as osHostname, userInfo } from "node:os";

import {
  isAuthenticatedPrincipal,
  type AuthContext,
  type AuthenticatedIdentity,
  type AuthenticatedPrincipal,
  type AuthorizationDecision,
  type AuthorizationRequest,
  type PrincipalKeyInput,
} from "./types.ts";

/**
 * Capture the security-sensitive parts of an authorization context at a
 * request boundary. Principal claims are cloned and deeply frozen, while the
 * policy method is bound once so later replacement cannot change the policy
 * used within the request.
 */
export function captureAuthContext(auth: AuthContext): Readonly<AuthContext> {
  if (!isAuthenticatedPrincipal(auth.principal)) {
    throw new TypeError(
      "Authenticated principal must contain only valid plain claim data"
    );
  }
  if (typeof auth.authorize !== "function") {
    throw new TypeError("AuthContext authorize must be a function");
  }
  const principal = deepFreezePlainData(structuredClone(auth.principal));
  const authorize = auth.authorize.bind(auth);
  return Object.freeze({
    principal,
    authorize(request: AuthorizationRequest) {
      return authorize(request);
    },
  });
}

export interface OwnerPrincipalOptions {
  /** Stable subject override. Defaults to `env.USER`/`env.USERNAME`, then the
   *  OS user, then `"owner"`. */
  subject?: string;
  /** Stable issuer override. Defaults to `gonk:local:<host>`, where `<host>`
   *  is `env.HOSTNAME`/`env.COMPUTERNAME`, then the OS hostname, then
   *  `"local"`. */
  issuer?: string;
  /** Additional roles beyond the default `"owner"`. */
  roles?: readonly string[];
}

/**
 * The single-owner boundary constructor: a local `AuthenticatedPrincipal`
 * plus a permit-all-for-owner authorization policy. Bind it ONCE at host
 * startup (`registry.withPrincipal(ownerPrincipal(env))`, `@gonk/tool-registry`)
 * — never per call. It is for single-human hosts only: pi, a CLI invocation,
 * a plugin MCP server with no external callers.
 *
 * NOT for a host with more than one caller (reach ingress, a multi-tenant MCP
 * server). Those verify a real sender per turn and construct a distinct
 * `AuthContext` for it instead of reaching for this.
 *
 * Deterministic: the same `env` always derives the same principal id, so
 * security-context keys and receipts stay stable across restarts.
 */
export function ownerPrincipal(
  env: Readonly<Record<string, string | undefined>>,
  opts: OwnerPrincipalOptions = {}
): AuthContext {
  const subject =
    opts.subject ?? env.USER ?? env.USERNAME ?? safeOsUser() ?? "owner";
  const host =
    env.HOSTNAME ?? env.COMPUTERNAME ?? safeOsHostname() ?? "local";
  const issuer = opts.issuer ?? `gonk:local:${host}`;
  const roles = opts.roles
    ? [...new Set(["owner", ...opts.roles])]
    : ["owner"];

  const principal: AuthenticatedPrincipal = {
    id: `local:${issuer}:${subject}`,
    kind: "local",
    identity: { issuer, subject, method: "local" },
    roles,
    scopes: [],
  };

  return {
    principal,
    authorize(): AuthorizationDecision {
      return {
        outcome: "allow",
        reason: "owner principal — single-owner host",
      };
    },
  };
}

function safeOsUser(): string | undefined {
  try {
    return userInfo().username;
  } catch {
    return undefined;
  }
}

function safeOsHostname(): string | undefined {
  try {
    return osHostname();
  } catch {
    return undefined;
  }
}

export function securityContextKey(input: PrincipalKeyInput): string {
  return principalHash("gsk", input.principal, true);
}

export function persistentGrantKey(input: PrincipalKeyInput): string {
  return principalHash("gpg", input.principal, false);
}

function principalHash(
  prefix: "gsk" | "gpg",
  principal: AuthenticatedPrincipal,
  includeActorSession: boolean
): string {
  validatePrincipal(principal);
  const delegation = principal.delegation;
  const payload = JSON.stringify({
    version: 1,
    subject: {
      issuer: principal.identity.issuer,
      subject: principal.identity.subject,
      kind: principal.kind,
    },
    tenantId: principal.tenantId ?? null,
    workspaceId: principal.workspaceId ?? null,
    actor: delegation
      ? {
          issuer: delegation.actor.issuer,
          subject: delegation.actor.subject,
          kind: delegation.actorKind,
          id: delegation.actorId,
          ...(includeActorSession
            ? { sessionId: delegation.actorSessionId ?? null }
            : {}),
        }
      : null,
  });
  const digest = createHash("sha256")
    .update(`gonk-auth:${prefix}:v1\0`, "utf8")
    .update(payload, "utf8")
    .digest("base64url");
  return `${prefix}:v1:${digest}`;
}

function validatePrincipal(principal: AuthenticatedPrincipal): void {
  requireNonEmpty("principal.id", principal.id);
  requireIdentity("principal.identity", principal.identity);
  if (principal.delegation) {
    requireIdentity("principal.delegation.actor", principal.delegation.actor);
    requireNonEmpty(
      "principal.delegation.actorId",
      principal.delegation.actorId
    );
    if (principal.delegation.actorSessionId !== undefined) {
      requireNonEmpty(
        "principal.delegation.actorSessionId",
        principal.delegation.actorSessionId
      );
    }
  }
}

function requireIdentity(label: string, identity: AuthenticatedIdentity): void {
  requireNonEmpty(`${label}.issuer`, identity.issuer);
  requireNonEmpty(`${label}.subject`, identity.subject);
  requireNonEmpty(`${label}.method`, identity.method);
}

function requireNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}

function deepFreezePlainData<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value) &&
    prototype !== Object.prototype &&
    prototype !== null
  ) {
    throw new TypeError(
      "Authenticated principal claims must contain only plain data"
    );
  }
  for (const child of Object.values(value)) {
    deepFreezePlainData(child);
  }
  return Object.freeze(value);
}
