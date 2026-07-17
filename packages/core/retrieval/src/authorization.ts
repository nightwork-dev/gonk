import type {
  AuthContext,
  AuthenticatedPrincipal,
  AuthzAction,
  AuthzResource,
} from "@gonk/auth";

import { canonicalResourceKey } from "./identity.ts";
import type {
  ResolvedRetrievalContent,
  RetrievalAudience,
  RetrievalDocument,
  RetrievalResourceRef,
  RetrievalSourceDescription,
} from "./types.ts";

export async function authorizeRetrieval(
  auth: AuthContext,
  action: AuthzAction,
  resource: AuthzResource
): Promise<boolean> {
  const decision = await auth.authorize({ action, resource });
  return decision.outcome === "allow";
}

export function sourceAuthzResource(
  description: RetrievalSourceDescription,
  principal: AuthenticatedPrincipal
): AuthzResource {
  return {
    kind: "retrieval-source",
    target: description.id,
    scope: principal.workspaceId ? "workspace" : principal.tenantId ? "tenant" : "resource",
    ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
    ...(principal.workspaceId === undefined
      ? {}
      : { workspaceId: principal.workspaceId }),
  };
}

export function retrievalAuthzResource(input: {
  resource: RetrievalResourceRef;
  audience: RetrievalAudience;
  tenantId?: string;
  workspaceId?: string;
}): AuthzResource {
  return {
    kind: "retrieval-resource",
    target: canonicalResourceKey(input.resource),
    scope: "resource",
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    metadata: {
      sourceId: input.resource.sourceId,
      resourceKind: input.resource.kind,
      revision: input.resource.revision,
      audience: input.audience,
    },
  };
}

export function authorityMatches(
  principal: AuthenticatedPrincipal,
  value: Pick<RetrievalDocument, "audience" | "tenantId" | "workspaceId">
): boolean {
  if (value.tenantId !== undefined && value.tenantId !== principal.tenantId) return false;
  if (value.workspaceId !== undefined && value.workspaceId !== principal.workspaceId) {
    return false;
  }
  if (value.audience === "tenant") {
    return value.tenantId !== undefined && value.tenantId === principal.tenantId;
  }
  if (value.audience === "workspace") {
    return (
      value.workspaceId !== undefined && value.workspaceId === principal.workspaceId
    );
  }
  return true;
}

export function resolvedAuthorityMatches(
  principal: AuthenticatedPrincipal,
  value: ResolvedRetrievalContent
): boolean {
  return authorityMatches(principal, value);
}

export function resourceBelongsToSource(
  resource: RetrievalResourceRef,
  description: RetrievalSourceDescription
): boolean {
  return (
    resource.sourceId === description.id &&
    description.resourceKinds.includes(resource.kind)
  );
}
