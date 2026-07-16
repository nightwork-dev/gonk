import {
  redactAuthzResource,
  type AuthAuditSink,
  type AuthenticatedPrincipal,
  type AuthzResource,
  type AuthzResourceKind,
  type RedactedAuthzResource,
} from "@gonk/auth";

import type { ResolvedApproval } from "./approval.ts";
import type { ToolDefinition } from "./types.ts";

export interface ToolAuthorizationResource {
  required: true;
  kind: AuthzResourceKind;
  requiredFields?: readonly ("target" | "tenantId" | "workspaceId")[];
}

export interface ToolResourceResolutionRequest {
  principal: AuthenticatedPrincipal;
  tool: ToolDefinition;
  input: unknown;
  callStack: readonly string[];
}

export interface ToolResourceResolver {
  resolve(
    request: ToolResourceResolutionRequest
  ): AuthzResource | null | Promise<AuthzResource | null>;
}

export interface ApprovalRequest {
  principal: AuthenticatedPrincipal;
  tool: ToolDefinition;
  input: unknown;
  resource: AuthzResource;
  relatedResources?: readonly AuthzResource[];
  approval: ResolvedApproval;
  inputDigest?: string;
}

export type ApprovalDecision =
  | {
      outcome: "approved";
      reason?: string;
      grantId?: string;
      grantScope?: "persistent" | "session";
      approvalRequestId?: string;
    }
  | {
      outcome: "denied";
      reason: string;
      approvalRequestId?: string;
    }
  | {
      outcome: "required";
      reason: string;
      approvalRequestId: string;
      expiresAt?: string;
    };

export interface ApprovalProvider {
  decide(
    request: ApprovalRequest
  ): ApprovalDecision | Promise<ApprovalDecision>;
}

export interface ApprovalRequiredDetails {
  requestId: string;
  approvalRequestId: string;
  toolName: string;
  approvalTier: string;
  reason: string;
  inputDigest?: string;
  resource?: RedactedAuthzResource;
  relatedResources?: readonly RedactedAuthzResource[];
  expiresAt?: string;
}

export type ApprovalGrantBinding =
  | {
      scope: "persistent";
      persistentGrantKey: string;
    }
  | {
      scope: "session";
      securityContextKey: string;
    };

export interface ToolApprovalGrant {
  id: string;
  binding: ApprovalGrantBinding;
  toolNames: readonly string[];
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
}

export interface ToolRegistrySecurityOptions {
  resourceResolver?: ToolResourceResolver;
  approvalProvider?: ApprovalProvider;
  auditSink?: AuthAuditSink;
  mandatoryAudit?: boolean;
  requestId?: () => string;
  now?: () => string;
}

export function toolAuthorizationResource(
  tool: ToolDefinition,
  approval?: ResolvedApproval
): AuthzResource {
  const metadata: {
    authorization?: ToolDefinition["authorization"];
    capabilities?: ToolDefinition["capabilities"];
    approvalTier?: ResolvedApproval["tier"];
  } = {};
  if (tool.authorization !== undefined) {
    metadata.authorization = tool.authorization;
  }
  if (tool.capabilities !== undefined) {
    metadata.capabilities = tool.capabilities;
  }
  if (approval !== undefined) {
    metadata.approvalTier = approval.tier;
  }
  return {
    kind: "tool",
    target: tool.name,
    ...(Object.keys(metadata).length === 0 ? {} : { metadata }),
  };
}

export function validateResolvedResource(
  declaration: ToolAuthorizationResource,
  resource: AuthzResource | null
): resource is AuthzResource {
  if (!resource || resource.kind !== declaration.kind) return false;
  const required = declaration.requiredFields ?? ["target"];
  return required.every((field) => {
    const value = resource[field];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export function redactAuthorizationResources(
  resources: readonly AuthzResource[] | undefined
): readonly RedactedAuthzResource[] | undefined {
  return resources?.map(redactAuthzResource);
}
