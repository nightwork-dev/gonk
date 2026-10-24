// =============================================================================
// Pure contract types + validators for @gonk/auth.
//
// This file is the client-safe foundation (GR-84): no Node built-ins, no
// runtime environment assumptions — plain data shapes and pure functions
// over them. `./contracts.ts` re-exports from here (and from `./envelope.ts`)
// so a browser/UI consumer can depend on the SHAPE of a principal, an
// authorization decision, or a security receipt without pulling in the
// hashing/OS-touching machinery in `./security.ts`.
// =============================================================================

export type AuthenticationMethod =
  | "session"
  | "oauth"
  | "service-token"
  | "api-key"
  | "mtls"
  | "tailnet"
  | "transport-account"
  | "local"
  | `custom:${string}`;

export interface AuthenticatedIdentity {
  issuer: string;
  subject: string;
  method: AuthenticationMethod;
}

export interface DelegationContext {
  actorKind: "agent" | "service";
  actor: AuthenticatedIdentity;
  actorId: string;
  actorSessionId?: string;
}

export type AuthClaimValue =
  | null
  | string
  | number
  | boolean
  | readonly AuthClaimValue[]
  | AuthClaimRecord;

export interface AuthClaimRecord {
  readonly [key: string]: AuthClaimValue;
}

export interface AuthenticatedPrincipal {
  id: string;
  kind: "human" | "agent" | "service" | "local";
  identity: AuthenticatedIdentity;
  linkedIdentities?: readonly AuthenticatedIdentity[];
  tenantId?: string;
  workspaceId?: string;
  delegation?: DelegationContext;
  roles: readonly string[];
  scopes: readonly string[];
  expiresAt?: number;
  attributes?: AuthClaimRecord;
}

export function isAuthenticatedPrincipal(
  value: unknown
): value is AuthenticatedPrincipal {
  if (!isRecord(value)) return false;
  if (
    typeof value.id !== "string" ||
    !isPrincipalKind(value.kind) ||
    !isAuthenticatedIdentity(value.identity) ||
    !Array.isArray(value.roles) ||
    !value.roles.every((role) => typeof role === "string") ||
    !Array.isArray(value.scopes) ||
    !value.scopes.every((scope) => typeof scope === "string")
  ) {
    return false;
  }
  if (
    value.linkedIdentities !== undefined &&
    (!Array.isArray(value.linkedIdentities) ||
      !value.linkedIdentities.every(isAuthenticatedIdentity))
  ) {
    return false;
  }
  if (value.tenantId !== undefined && typeof value.tenantId !== "string") {
    return false;
  }
  if (
    value.workspaceId !== undefined &&
    typeof value.workspaceId !== "string"
  ) {
    return false;
  }
  if (
    value.expiresAt !== undefined &&
    (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt))
  ) {
    return false;
  }
  if (
    value.attributes !== undefined &&
    (!isRecord(value.attributes) || !isPlainClaimData(value.attributes))
  ) {
    return false;
  }
  return (
    value.delegation === undefined || isDelegationContext(value.delegation)
  );
}

export type AuthzAction =
  | "tool.discover"
  | "tool.invoke"
  | "comms.ingress"
  | "comms.read"
  | "scope.write"
  | "connection.use"
  | "context.discover"
  | "context.use"
  | "skill.discover"
  | "skill.read"
  | "skill.manage"
  | "skill.activate"
  | "retrieval.source.discover"
  | "retrieval.hit.read"
  | "retrieval.content.resolve"
  | "retrieval.index.manage"
  | `application:${string}`;

export type AuthzResourceKind =
  | "tool"
  | "comms"
  | "scope"
  | "work-item"
  | "connection"
  | "context-candidate"
  | "skill"
  | "retrieval-source"
  | "retrieval-resource"
  | `application:${string}`;

export type AuthzScope =
  | "global"
  | "persona"
  | "project"
  | "directory"
  | "session"
  | "tenant"
  | "workspace"
  | "resource";

export interface AuthzResource<Metadata = unknown> {
  kind: AuthzResourceKind;
  target?: string;
  scope?: AuthzScope;
  tenantId?: string;
  workspaceId?: string;
  metadata?: Readonly<Metadata>;
}

export interface RedactedAuthzResource {
  kind: AuthzResourceKind;
  target?: string;
  tenantId?: string;
  workspaceId?: string;
}

export interface AuthorizationRequest {
  action: AuthzAction;
  resource: AuthzResource;
  relatedResources?: readonly AuthzResource[];
  input?: unknown;
  callStack?: readonly string[];
}

export type AuthorizationOutcome = "allow" | "deny";

export interface AuthorizationDecision {
  outcome: AuthorizationOutcome;
  reason: string;
  policyId?: string;
  resource?: AuthzResource;
}

export interface AuthContext {
  principal: AuthenticatedPrincipal;
  authorize(
    request: AuthorizationRequest
  ): AuthorizationDecision | Promise<AuthorizationDecision>;
}

export interface Authenticator<RequestLike> {
  authenticate(
    request: RequestLike
  ): AuthenticatedPrincipal | null | Promise<AuthenticatedPrincipal | null>;
}

export interface PrincipalKeyInput {
  principal: AuthenticatedPrincipal;
}

export interface SecurityReceiptBase {
  requestId: string;
  transportSessionId?: string;
  principalId: string;
  securityContextKey: string;
  subjectIssuer?: string;
  subjectId?: string;
  actorIssuer?: string;
  actorSubject?: string;
  actorId?: string;
  actorSessionId?: string;
  tenantId?: string;
  workspaceId?: string;
  timestamp: string;
}

export interface AuthorizationReceipt extends SecurityReceiptBase {
  kind: "authorization";
  action: AuthzAction;
  resource: RedactedAuthzResource;
  relatedResources?: readonly RedactedAuthzResource[];
  toolName?: string;
  outcome: AuthorizationOutcome;
  reason: string;
  policyId?: string;
}

export interface ApprovalReceipt extends SecurityReceiptBase {
  kind: "approval";
  approvalRequestId?: string;
  toolName: string;
  approvalTier: string;
  outcome: "approved" | "denied" | "required";
  reason: string;
  grantId?: string;
  grantScope?: "persistent" | "session";
}

export interface SessionBindingReceipt extends SecurityReceiptBase {
  kind: "session-binding";
  transport: "mcp";
  outcome: "mismatch";
  reason: string;
}

export type AuthSecurityReceipt =
  | AuthorizationReceipt
  | ApprovalReceipt
  | SessionBindingReceipt;

export interface AuthAuditSink {
  write(receipt: AuthSecurityReceipt): void | Promise<void>;
}

export function redactAuthzResource(
  resource: AuthzResource
): RedactedAuthzResource {
  return {
    kind: resource.kind,
    ...(resource.target === undefined ? {} : { target: resource.target }),
    ...(resource.tenantId === undefined ? {} : { tenantId: resource.tenantId }),
    ...(resource.workspaceId === undefined
      ? {}
      : { workspaceId: resource.workspaceId }),
  };
}

export function isAuthenticatedIdentity(
  value: unknown
): value is AuthenticatedIdentity {
  return (
    isRecord(value) &&
    typeof value.issuer === "string" &&
    value.issuer.trim().length > 0 &&
    typeof value.subject === "string" &&
    value.subject.trim().length > 0 &&
    isAuthenticationMethod(value.method)
  );
}

export function isAuthenticationMethod(
  value: unknown
): value is AuthenticationMethod {
  return (
    value === "session" ||
    value === "oauth" ||
    value === "service-token" ||
    value === "api-key" ||
    value === "mtls" ||
    value === "tailnet" ||
    value === "transport-account" ||
    value === "local" ||
    (typeof value === "string" &&
      value.startsWith("custom:") &&
      value.length > "custom:".length)
  );
}

export function isDelegationContext(
  value: unknown
): value is DelegationContext {
  return (
    isRecord(value) &&
    (value.actorKind === "agent" || value.actorKind === "service") &&
    isAuthenticatedIdentity(value.actor) &&
    typeof value.actorId === "string" &&
    value.actorId.trim().length > 0 &&
    (value.actorSessionId === undefined ||
      (typeof value.actorSessionId === "string" &&
        value.actorSessionId.trim().length > 0))
  );
}

export function isPrincipalKind(
  value: unknown
): value is AuthenticatedPrincipal["kind"] {
  return (
    value === "human" ||
    value === "agent" ||
    value === "service" ||
    value === "local"
  );
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isPlainClaimData(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "string" ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isPlainClaimData);
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (
    (prototype === Object.prototype || prototype === null) &&
    Object.values(value).every(isPlainClaimData)
  );
}
