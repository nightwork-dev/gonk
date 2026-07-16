import {
  isAuthenticatedPrincipal,
  type AuthContext,
  type AuthzResource,
} from "@gonk/auth";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  CompiledContextBlock,
  ContextBlockingReason,
  ContextCandidate,
  ContextCompilationReceipt,
  ContextCompileRequest,
  ContextCompileResult,
  ContextDiscoveryRequest,
  ContextReceiptDrop,
  ContextReceiptSelection,
  ContextResolutionRequest,
  ContextTokenCount,
  ResolvedContextCandidate,
} from "./types.ts";

export const contextCompileRequestSchema = schema<ContextCompileRequest>(
  "ContextCompileRequest",
  isContextCompileRequest
);

export const contextCandidateSchema = schema<ContextCandidate>(
  "ContextCandidate",
  isContextCandidate
);

export const resolvedContextCandidateSchema =
  schema<ResolvedContextCandidate>(
    "ResolvedContextCandidate",
    isResolvedContextCandidate
  );

export const contextDiscoveryRequestSchema = schema<ContextDiscoveryRequest>(
  "ContextDiscoveryRequest",
  isContextDiscoveryRequest
);

export const contextResolutionRequestSchema = schema<ContextResolutionRequest>(
  "ContextResolutionRequest",
  isContextResolutionRequest
);

export const contextTokenCountSchema = schema<ContextTokenCount>(
  "ContextTokenCount",
  isContextTokenCount
);

export const compiledContextBlockSchema = schema<CompiledContextBlock>(
  "CompiledContextBlock",
  isCompiledContextBlock
);

export const contextCompilationReceiptSchema =
  schema<ContextCompilationReceipt>(
    "ContextCompilationReceipt",
    isContextCompilationReceipt
  );

export const contextCompileResultSchema = schema<ContextCompileResult>(
  "ContextCompileResult",
  isContextCompileResult
);

function schema<T>(
  label: string,
  check: (value: unknown) => value is T
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "gonk",
      validate: (value) =>
        check(value)
          ? { value }
          : { issues: [{ message: `Invalid ${label}` }] },
    },
  };
}

function isContextCompileRequest(
  value: unknown
): value is ContextCompileRequest {
  if (
    !isExactRecord(value, [
      "requestId",
      "auth",
      "audience",
      "maxTokens",
      "model",
      "query",
      "requestedContributorIds",
      "excludedResourceKeys",
      "pinnedResourceKeys",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.requestId) &&
    isAuthContext(value.auth) &&
    isContextAudience(value.audience) &&
    isNonNegativeInteger(value.maxTokens) &&
    isOptionalNonEmptyString(value.model) &&
    (value.query === undefined || typeof value.query === "string") &&
    isOptionalStringArray(value.requestedContributorIds) &&
    isOptionalStringArray(value.excludedResourceKeys) &&
    isOptionalStringArray(value.pinnedResourceKeys)
  );
}

function isContextCandidate(value: unknown): value is ContextCandidate {
  if (
    !isExactRecord(value, [
      "candidateId",
      "contributorId",
      "resourceKey",
      "revisionHint",
      "necessity",
      "priority",
      "estimatedTokens",
      "estimateQuality",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    isNonEmptyString(value.contributorId) &&
    isNonEmptyString(value.resourceKey) &&
    isOptionalNonEmptyString(value.revisionHint) &&
    isContextNecessity(value.necessity) &&
    typeof value.priority === "number" &&
    Number.isFinite(value.priority) &&
    isNonNegativeInteger(value.estimatedTokens) &&
    isContextEstimateQuality(value.estimateQuality)
  );
}

function isResolvedContextCandidate(
  value: unknown
): value is ResolvedContextCandidate {
  if (
    !isExactRecord(value, [
      "candidateId",
      "contributorId",
      "resourceKey",
      "revision",
      "necessity",
      "priority",
      "audience",
      "content",
      "resource",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    isNonEmptyString(value.contributorId) &&
    isNonEmptyString(value.resourceKey) &&
    isNonEmptyString(value.revision) &&
    isContextNecessity(value.necessity) &&
    typeof value.priority === "number" &&
    Number.isFinite(value.priority) &&
    isContextAudience(value.audience) &&
    isNonEmptyString(value.content) &&
    isAuthzResource(value.resource)
  );
}

function isContextDiscoveryRequest(
  value: unknown
): value is ContextDiscoveryRequest {
  if (
    !isExactRecord(value, [
      "requestId",
      "audience",
      "principal",
      "query",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.requestId) &&
    isContextAudience(value.audience) &&
    isAuthenticatedPrincipal(value.principal) &&
    (value.query === undefined || typeof value.query === "string")
  );
}

function isContextResolutionRequest(
  value: unknown
): value is ContextResolutionRequest {
  if (
    !isExactRecord(value, [
      "requestId",
      "audience",
      "principal",
      "candidate",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.requestId) &&
    isContextAudience(value.audience) &&
    isAuthenticatedPrincipal(value.principal) &&
    isContextCandidate(value.candidate)
  );
}

function isContextTokenCount(value: unknown): value is ContextTokenCount {
  return (
    isExactRecord(value, ["tokens", "quality"]) &&
    isNonNegativeInteger(value.tokens) &&
    isContextEstimateQuality(value.quality)
  );
}

function isCompiledContextBlock(value: unknown): value is CompiledContextBlock {
  if (
    !isExactRecord(value, [
      "candidateId",
      "contributorId",
      "resourceKey",
      "revision",
      "necessity",
      "priority",
      "audience",
      "content",
      "contentTokens",
      "renderedTokens",
      "tokenQuality",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    isNonEmptyString(value.contributorId) &&
    isNonEmptyString(value.resourceKey) &&
    isNonEmptyString(value.revision) &&
    isContextNecessity(value.necessity) &&
    typeof value.priority === "number" &&
    Number.isFinite(value.priority) &&
    isContextAudience(value.audience) &&
    isNonEmptyString(value.content) &&
    isNonNegativeInteger(value.contentTokens) &&
    isNonNegativeInteger(value.renderedTokens) &&
    isContextEstimateQuality(value.tokenQuality)
  );
}

function isContextCompilationReceipt(
  value: unknown
): value is ContextCompilationReceipt {
  if (
    !isExactRecord(value, [
      "kind",
      "receiptVersion",
      "requestId",
      "timestamp",
      "compilerVersion",
      "configVersion",
      "status",
      "audience",
      "maxTokens",
      "totalTokens",
      "selected",
      "dropped",
      "blockers",
    ])
  ) {
    return false;
  }
  return (
    value.kind === "context-compilation" &&
    value.receiptVersion === 1 &&
    isNonEmptyString(value.requestId) &&
    isNonEmptyString(value.timestamp) &&
    isNonEmptyString(value.compilerVersion) &&
    isNonEmptyString(value.configVersion) &&
    (value.status === "ready" || value.status === "blocked") &&
    isContextAudience(value.audience) &&
    isNonNegativeInteger(value.maxTokens) &&
    isNonNegativeInteger(value.totalTokens) &&
    Array.isArray(value.selected) &&
    value.selected.every(isContextReceiptSelection) &&
    Array.isArray(value.dropped) &&
    value.dropped.every(isContextReceiptDrop) &&
    Array.isArray(value.blockers) &&
    value.blockers.every(isContextBlockingReason)
  );
}

function isContextCompileResult(value: unknown): value is ContextCompileResult {
  if (!isRecord(value)) return false;
  if (value.status === "ready") {
    return (
      isExactRecord(value, [
        "status",
        "blocks",
        "content",
        "totalTokens",
        "receipt",
      ]) &&
      Array.isArray(value.blocks) &&
      value.blocks.every(isCompiledContextBlock) &&
      typeof value.content === "string" &&
      isNonNegativeInteger(value.totalTokens) &&
      isContextCompilationReceipt(value.receipt) &&
      value.receipt.status === "ready" &&
      value.receipt.totalTokens === value.totalTokens
    );
  }
  if (value.status === "blocked") {
    return (
      isExactRecord(value, ["status", "blockers", "receipt"]) &&
      Array.isArray(value.blockers) &&
      value.blockers.every(isContextBlockingReason) &&
      isContextCompilationReceipt(value.receipt) &&
      value.receipt.status === "blocked"
    );
  }
  return false;
}

function isContextReceiptSelection(
  value: unknown
): value is ContextReceiptSelection {
  if (
    !isExactRecord(value, [
      "candidateId",
      "contributorId",
      "resourceKey",
      "revision",
      "necessity",
      "contentTokens",
      "renderedTokens",
      "tokenQuality",
    ])
  ) {
    return false;
  }
  return (
    isNonEmptyString(value.candidateId) &&
    isNonEmptyString(value.contributorId) &&
    isNonEmptyString(value.resourceKey) &&
    isNonEmptyString(value.revision) &&
    isContextNecessity(value.necessity) &&
    isNonNegativeInteger(value.contentTokens) &&
    isNonNegativeInteger(value.renderedTokens) &&
    isContextEstimateQuality(value.tokenQuality)
  );
}

function isContextReceiptDrop(value: unknown): value is ContextReceiptDrop {
  if (!isRecord(value)) return false;
  if (value.reason === "duplicate") {
    return (
      isExactRecord(value, [
        "reason",
        "candidateId",
        "contributorId",
        "resourceKey",
        "revision",
      ]) &&
      isCandidateIdentity(value) &&
      isNonEmptyString(value.revision)
    );
  }
  if (value.reason === "budget") {
    return (
      isExactRecord(value, [
        "reason",
        "candidateId",
        "contributorId",
        "resourceKey",
        "revision",
        "necessity",
        "contentTokens",
        "renderedTokens",
        "tokenQuality",
      ]) &&
      isCandidateIdentity(value) &&
      isNonEmptyString(value.revision) &&
      isContextNecessity(value.necessity) &&
      isNonNegativeInteger(value.contentTokens) &&
      isNonNegativeInteger(value.renderedTokens) &&
      isContextEstimateQuality(value.tokenQuality)
    );
  }
  if (value.reason === "resolution-failed" || value.reason === "use-denied") {
    return (
      isExactRecord(value, [
        "reason",
        "candidateId",
        "contributorId",
        "resourceKey",
        "necessity",
      ]) &&
      isCandidateIdentity(value) &&
      isContextNecessity(value.necessity)
    );
  }
  if (value.reason === "invalid") {
    const invalidValue: Record<string, unknown> = value;
    if (hasOnlyKeys(invalidValue, ["reason", "contributorId"])) {
      return isNonEmptyString(invalidValue.contributorId);
    }
    return (
      isExactRecord(invalidValue, [
        "reason",
        "contributorId",
        "candidateId",
        "resourceKey",
        "necessity",
      ]) &&
      isCandidateIdentity(invalidValue) &&
      isContextNecessity(invalidValue.necessity)
    );
  }
  if (value.reason === "contributor-failed") {
    return (
      isExactRecord(value, ["reason", "contributorId"]) &&
      isNonEmptyString(value.contributorId)
    );
  }
  return false;
}

function isContextBlockingReason(
  value: unknown
): value is ContextBlockingReason {
  if (!isRecord(value)) return false;
  if (value.reason === "discovery-denied") {
    if (value.pinned === true) {
      return (
        isExactRecord(value, [
          "reason",
          "necessity",
          "pinned",
          "resourceKey",
        ]) &&
        isContextNecessity(value.necessity) &&
        isNonEmptyString(value.resourceKey)
      );
    }
    return (
      isExactRecord(value, ["reason", "necessity", "pinned"]) &&
      value.necessity === "required" &&
      value.pinned === false
    );
  }
  return (
    (value.reason === "resolution-failed" ||
      value.reason === "use-denied" ||
      value.reason === "budget" ||
      value.reason === "invalid") &&
    isExactRecord(value, [
      "reason",
      "necessity",
      "pinned",
      "contributorId",
      "candidateId",
      "resourceKey",
    ]) &&
    isContextNecessity(value.necessity) &&
    typeof value.pinned === "boolean" &&
    isOptionalNonEmptyString(value.contributorId) &&
    isOptionalNonEmptyString(value.candidateId) &&
    isOptionalNonEmptyString(value.resourceKey)
  );
}

function isCandidateIdentity(value: Record<string, unknown>): boolean {
  return (
    isNonEmptyString(value.candidateId) &&
    isNonEmptyString(value.contributorId) &&
    isNonEmptyString(value.resourceKey)
  );
}

function isAuthContext(value: unknown): value is AuthContext {
  return (
    isExactRecord(value, ["principal", "authorize"]) &&
    isAuthenticatedPrincipal(value.principal) &&
    typeof value.authorize === "function"
  );
}

function isAuthzResource(value: unknown): value is AuthzResource {
  if (
    !isExactRecord(value, [
      "kind",
      "target",
      "scope",
      "tenantId",
      "workspaceId",
      "metadata",
    ])
  ) {
    return false;
  }
  return (
    isAuthzResourceKind(value.kind) &&
    isOptionalNonEmptyString(value.target) &&
    (value.scope === undefined ||
      [
        "global",
        "persona",
        "project",
        "directory",
        "session",
        "tenant",
        "workspace",
        "resource",
      ].includes(value.scope as string)) &&
    isOptionalNonEmptyString(value.tenantId) &&
    isOptionalNonEmptyString(value.workspaceId)
  );
}

function isAuthzResourceKind(value: unknown): boolean {
  return (
    typeof value === "string" &&
    ([
      "tool",
      "comms",
      "scope",
      "work-item",
      "connection",
      "context-candidate",
      "skill",
      "retrieval-source",
      "retrieval-resource",
    ].includes(value) ||
      (value.startsWith("application:") && value.length > "application:".length))
  );
}

function isContextAudience(value: unknown): value is "model" | "user" {
  return value === "model" || value === "user";
}

function isContextNecessity(value: unknown): value is "optional" | "required" {
  return value === "optional" || value === "required";
}

function isContextEstimateQuality(
  value: unknown
): value is "fallback" | "model-aware" | "exact" {
  return value === "fallback" || value === "model-aware" || value === "exact";
}

function isOptionalStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every(isNonEmptyString))
  );
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isExactRecord(
  value: unknown,
  allowedKeys: readonly string[]
): value is Record<string, unknown> {
  return isRecord(value) && hasOnlyKeys(value, allowedKeys);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[]
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
