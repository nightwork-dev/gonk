import { isAuthenticatedPrincipal, type AuthContext } from "@gonk/auth";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type {
  NativeRetrievalCandidate,
  NativeRetrievalSearchRequest,
  ResolvedRetrievalContent,
  RetrievalCitationCreateRequest,
  RetrievalCitationCreateResult,
  RetrievalCitationHandle,
  RetrievalCitationResolution,
  RetrievalCitationResolveRequest,
  RetrievalDocument,
  RetrievalEvidenceBudget,
  RetrievalEvidenceContributorReceipt,
  RetrievalEvidenceDropReceipt,
  RetrievalEvidencePacket,
  RetrievalEvidenceRanking,
  RetrievalEvidenceReceipt,
  RetrievalEvidenceResult,
  RetrievalEvidenceSelectionReceipt,
  RetrievalEvidenceSourceRef,
  RetrievalFacet,
  RetrievalFragmentRef,
  RetrievalHit,
  RetrievalIndexReceipt,
  RetrievalIndexRequest,
  RetrievalIndexResult,
  RetrievalLexicalScore,
  RetrievalReceiptDrop,
  RetrievalReceiptHit,
  RetrievalReceiptSource,
  RetrievalResolveReceipt,
  RetrievalResolveRequest,
  RetrievalResolveResult,
  RetrievalResourceRef,
  RetrievalScanRequest,
  RetrievalScoreComponents,
  RetrievalSearchReceipt,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSourceDescription,
  RetrievalSourceFilter,
  RetrievalSourceListRequest,
  RetrievalSourceListResult,
  SourceResolutionResult,
} from "./types.ts";

export const retrievalFragmentRefSchema = schema<RetrievalFragmentRef>(
  "RetrievalFragmentRef",
  isRetrievalFragmentRef
);
export const retrievalResourceRefSchema = schema<RetrievalResourceRef>(
  "RetrievalResourceRef",
  isRetrievalResourceRef
);
export const retrievalSourceDescriptionSchema = schema<RetrievalSourceDescription>(
  "RetrievalSourceDescription",
  isRetrievalSourceDescription
);
export const retrievalDocumentSchema = schema<RetrievalDocument>(
  "RetrievalDocument",
  isRetrievalDocument
);
export const retrievalSourceFilterSchema = schema<RetrievalSourceFilter>(
  "RetrievalSourceFilter",
  isRetrievalSourceFilter
);
export const retrievalScanRequestSchema = schema<RetrievalScanRequest>(
  "RetrievalScanRequest",
  isRetrievalScanRequest
);
export const nativeRetrievalSearchRequestSchema =
  schema<NativeRetrievalSearchRequest>(
    "NativeRetrievalSearchRequest",
    isNativeRetrievalSearchRequest
  );
export const nativeRetrievalCandidateSchema = schema<NativeRetrievalCandidate>(
  "NativeRetrievalCandidate",
  isNativeRetrievalCandidate
);
export const sourceResolutionResultSchema = schema<SourceResolutionResult>(
  "SourceResolutionResult",
  isSourceResolutionResult
);
export const resolvedRetrievalContentSchema = schema<ResolvedRetrievalContent>(
  "ResolvedRetrievalContent",
  isResolvedContent
);
export const retrievalSourceListRequestSchema = schema<RetrievalSourceListRequest>(
  "RetrievalSourceListRequest",
  isRetrievalSourceListRequest
);
export const retrievalSourceListResultSchema = schema<RetrievalSourceListResult>(
  "RetrievalSourceListResult",
  isRetrievalSourceListResult
);
export const retrievalSearchRequestSchema = schema<RetrievalSearchRequest>(
  "RetrievalSearchRequest",
  isRetrievalSearchRequest
);
export const retrievalSearchResultSchema = schema<RetrievalSearchResult>(
  "RetrievalSearchResult",
  isRetrievalSearchResult
);
export const retrievalHitSchema = schema<RetrievalHit>(
  "RetrievalHit",
  isRetrievalHit
);
export const retrievalEvidencePacketSchema = schema<RetrievalEvidencePacket>(
  "RetrievalEvidencePacket",
  isRetrievalEvidencePacket
);
export const retrievalEvidenceReceiptSchema = schema<RetrievalEvidenceReceipt>(
  "RetrievalEvidenceReceipt",
  isRetrievalEvidenceReceipt
);
export const retrievalEvidenceResultSchema = schema<RetrievalEvidenceResult>(
  "RetrievalEvidenceResult",
  isRetrievalEvidenceResult
);
export const retrievalSearchReceiptSchema = schema<RetrievalSearchReceipt>(
  "RetrievalSearchReceipt",
  isRetrievalSearchReceipt
);
export const retrievalIndexRequestSchema = schema<RetrievalIndexRequest>(
  "RetrievalIndexRequest",
  isRetrievalIndexRequest
);
export const retrievalIndexResultSchema = schema<RetrievalIndexResult>(
  "RetrievalIndexResult",
  isRetrievalIndexResult
);
export const retrievalIndexReceiptSchema = schema<RetrievalIndexReceipt>(
  "RetrievalIndexReceipt",
  (value): value is RetrievalIndexReceipt => isIndexReceipt(value)
);
export const retrievalResolveRequestSchema = schema<RetrievalResolveRequest>(
  "RetrievalResolveRequest",
  isRetrievalResolveRequest
);
export const retrievalResolveResultSchema = schema<RetrievalResolveResult>(
  "RetrievalResolveResult",
  isRetrievalResolveResult
);
export const retrievalResolveReceiptSchema = schema<RetrievalResolveReceipt>(
  "RetrievalResolveReceipt",
  isResolveReceipt
);
export const retrievalCitationCreateRequestSchema =
  schema<RetrievalCitationCreateRequest>(
    "RetrievalCitationCreateRequest",
    isRetrievalCitationCreateRequest
  );
export const retrievalCitationCreateResultSchema =
  schema<RetrievalCitationCreateResult>(
    "RetrievalCitationCreateResult",
    isRetrievalCitationCreateResult
  );
export const retrievalCitationResolveRequestSchema =
  schema<RetrievalCitationResolveRequest>(
    "RetrievalCitationResolveRequest",
    isRetrievalCitationResolveRequest
  );
export const retrievalCitationResolutionSchema =
  schema<RetrievalCitationResolution>(
    "RetrievalCitationResolution",
    isRetrievalCitationResolution
  );
export const retrievalCitationHandleSchema = schema<RetrievalCitationHandle>(
  "RetrievalCitationHandle",
  isCitationHandle
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
        check(value) ? { value } : { issues: [{ message: `Invalid ${label}` }] },
    },
  };
}

function isRetrievalResourceRef(value: unknown): value is RetrievalResourceRef {
  return (
    isExactRecord(value, ["sourceId", "kind", "id", "revision", "fragment"]) &&
    isNonEmptyString(value.sourceId) &&
    isNonEmptyString(value.kind) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.revision) &&
    (value.fragment === undefined || isRetrievalFragmentRef(value.fragment))
  );
}

export { isRetrievalResourceRef as isRetrievalResourceRefValue };

function isRetrievalFragmentRef(value: unknown): value is RetrievalFragmentRef {
  if (!isRecord(value) || !isNonEmptyString(value.kind)) return false;
  if (value.kind === "range") {
    return (
      isExactRecord(value, ["kind", "id", "start", "end"]) &&
      isNonEmptyString(value.id) &&
      isNonNegativeInteger(value.start) &&
      isNonNegativeInteger(value.end) &&
      value.start <= value.end
    );
  }
  return (
    (value.kind === "section" || value.kind === "chunk" || value.kind === "record") &&
    isExactRecord(value, ["kind", "id"]) &&
    isNonEmptyString(value.id)
  );
}

function isRetrievalSourceDescription(
  value: unknown
): value is RetrievalSourceDescription {
  if (!isRecord(value)) return false;
  const allowedKeys = [
    "id",
    "label",
    "mode",
    "revisionResolution",
    "resourceKinds",
    "filter",
    "priority",
    ...(value.mode === "native-index" ? ["rankingContract"] : []),
  ];
  return (
    isExactRecord(value, allowedKeys) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    (value.mode === "native-index" || value.mode === "coordinated-index") &&
    (value.mode !== "native-index" ||
      value.rankingContract === "source-enforced-authorized-corpus") &&
    (value.revisionResolution === "current-only" ||
      value.revisionResolution === "historical") &&
    isUniqueNonEmptyStringArray(value.resourceKinds) &&
    isFilterDefinition(value.filter) &&
    isFiniteNumber(value.priority)
  );
}

function isFilterDefinition(value: unknown): boolean {
  return (
    isExactRecord(value, ["schemaId", "schemaVersion"]) &&
    isNonEmptyString(value.schemaId) &&
    isPositiveInteger(value.schemaVersion)
  );
}

function isRetrievalSourceFilter(value: unknown): value is RetrievalSourceFilter {
  return (
    isExactRecord(value, ["sourceId", "schemaId", "schemaVersion", "value"]) &&
    isNonEmptyString(value.sourceId) &&
    isNonEmptyString(value.schemaId) &&
    isPositiveInteger(value.schemaVersion) &&
    Object.prototype.hasOwnProperty.call(value, "value")
  );
}

function isRetrievalScanRequest(value: unknown): value is RetrievalScanRequest {
  return (
    isExactRecord(value, [
      "requestId",
      "principal",
      "sourceId",
      "tenantId",
      "workspaceId",
    ]) &&
    isNonEmptyString(value.requestId) &&
    isAuthenticatedPrincipal(value.principal) &&
    isNonEmptyString(value.sourceId) &&
    isOptionalNonEmptyString(value.tenantId) &&
    isOptionalNonEmptyString(value.workspaceId)
  );
}

function isNativeRetrievalSearchRequest(
  value: unknown
): value is NativeRetrievalSearchRequest {
  return (
    isExactRecord(value, [
      "requestId",
      "principal",
      "text",
      "filter",
      "limit",
      "purpose",
    ]) &&
    isNonEmptyString(value.requestId) &&
    isAuthenticatedPrincipal(value.principal) &&
    isNonEmptyString(value.text) &&
    isPositiveInteger(value.limit) &&
    isPurpose(value.purpose)
  );
}

function isNativeRetrievalCandidate(
  value: unknown
): value is NativeRetrievalCandidate {
  return (
    isExactRecord(value, [
      "resource",
      "audience",
      "tenantId",
      "workspaceId",
      "lexicalScore",
    ]) &&
    isRetrievalResourceRef(value.resource) &&
    isAudience(value.audience) &&
    isOptionalNonEmptyString(value.tenantId) &&
    isOptionalNonEmptyString(value.workspaceId) &&
    isFiniteNumber(value.lexicalScore) &&
    value.lexicalScore >= 0
  );
}

function isSourceResolutionResult(value: unknown): value is SourceResolutionResult {
  if (!isRecord(value)) return false;
  if (value.status === "resolved") {
    return (
      isExactRecord(value, ["status", "value"]) &&
      isResolvedContent(value.value)
    );
  }
  if (value.status === "changed") {
    return (
      isExactRecord(value, ["status", "requested", "current"]) &&
      isRetrievalResourceRef(value.requested) &&
      isRetrievalResourceRef(value.current)
    );
  }
  return (
    (value.status === "revision-unavailable" || value.status === "deleted") &&
    isExactRecord(value, ["status", "resource"]) &&
    isRetrievalResourceRef(value.resource)
  );
}

function isRetrievalDocument(value: unknown): value is RetrievalDocument {
  return (
    isExactRecord(value, [
      "resource",
      "searchText",
      "contentHash",
      "audience",
      "tenantId",
      "workspaceId",
      "facets",
    ]) &&
    isRetrievalResourceRef(value.resource) &&
    typeof value.searchText === "string" &&
    isNonEmptyString(value.contentHash) &&
    isAudience(value.audience) &&
    isOptionalNonEmptyString(value.tenantId) &&
    isOptionalNonEmptyString(value.workspaceId) &&
    (value.facets === undefined ||
      (Array.isArray(value.facets) && value.facets.every(isRetrievalFacet)))
  );
}

export { isRetrievalDocument as isRetrievalDocumentValue };

function isRetrievalFacet(value: unknown): value is RetrievalFacet {
  return (
    isExactRecord(value, ["name", "value"]) &&
    isNonEmptyString(value.name) &&
    (typeof value.value === "string" ||
      typeof value.value === "boolean" ||
      isFiniteNumber(value.value))
  );
}

function isRetrievalSourceListRequest(
  value: unknown
): value is RetrievalSourceListRequest {
  return (
    isExactRecord(value, ["requestId", "auth"]) &&
    isNonEmptyString(value.requestId) &&
    isAuthContext(value.auth)
  );
}

function isRetrievalSourceListResult(
  value: unknown
): value is RetrievalSourceListResult {
  return (
    isExactRecord(value, ["sources"]) &&
    Array.isArray(value.sources) &&
    value.sources.every(isRetrievalSourceDescription)
  );
}

function isRetrievalSearchRequest(value: unknown): value is RetrievalSearchRequest {
  return (
    isExactRecord(value, [
      "requestId",
      "auth",
      "text",
      "sourceIds",
      "filters",
      "mode",
      "limit",
      "purpose",
    ]) &&
    isNonEmptyString(value.requestId) &&
    isAuthContext(value.auth) &&
    isNonEmptyString(value.text) &&
    (value.sourceIds === undefined || isUniqueNonEmptyStringArray(value.sourceIds)) &&
    (value.filters === undefined ||
      (Array.isArray(value.filters) &&
        value.filters.every(isRetrievalSourceFilter) &&
        uniqueBy(value.filters, (filter) => filter.sourceId))) &&
    value.mode === "lexical" &&
    isPositiveInteger(value.limit) &&
    value.limit <= 100 &&
    isPurpose(value.purpose)
  );
}

function isRetrievalSearchResult(value: unknown): value is RetrievalSearchResult {
  return (
    isExactRecord(value, ["hits", "receipt"]) &&
    Array.isArray(value.hits) &&
    value.hits.every(isRetrievalHit) &&
    isRetrievalSearchReceipt(value.receipt)
  );
}

function isRetrievalHit(value: unknown): value is RetrievalHit {
  return (
    isExactRecord(value, [
      "resource",
      "audience",
      "generationId",
      "scores",
      "matchedTerms",
    ]) &&
    isRetrievalResourceRef(value.resource) &&
    isAudience(value.audience) &&
    isOptionalNonEmptyString(value.generationId) &&
    isScoreComponents(value.scores) &&
    isUniqueStringArray(value.matchedTerms)
  );
}

function isRetrievalEvidenceResult(
  value: unknown
): value is RetrievalEvidenceResult {
  return (
    isExactRecord(value, ["packets", "receipt"]) &&
    Array.isArray(value.packets) &&
    value.packets.every(isRetrievalEvidencePacket) &&
    isRetrievalEvidenceReceipt(value.receipt)
  );
}

function isRetrievalEvidencePacket(
  value: unknown
): value is RetrievalEvidencePacket {
  return (
    isExactRecord(value, [
      "packetId",
      "resourceKey",
      "resource",
      "audience",
      "source",
      "ranking",
      "budget",
    ]) &&
    isNonEmptyString(value.packetId) &&
    isNonEmptyString(value.resourceKey) &&
    isRetrievalResourceRef(value.resource) &&
    isAudience(value.audience) &&
    isRetrievalEvidenceSourceRef(value.source) &&
    isRetrievalEvidenceRanking(value.ranking) &&
    isRetrievalEvidenceBudget(value.budget)
  );
}

function isRetrievalEvidenceSourceRef(
  value: unknown
): value is RetrievalEvidenceSourceRef {
  return (
    isExactRecord(value, ["sourceId", "mode", "generationId"]) &&
    isNonEmptyString(value.sourceId) &&
    (value.mode === "native-index" || value.mode === "coordinated-index") &&
    isOptionalNonEmptyString(value.generationId)
  );
}

function isRetrievalEvidenceRanking(
  value: unknown
): value is RetrievalEvidenceRanking {
  return (
    isExactRecord(value, ["lexical", "sourcePriority", "final", "matchedTerms"]) &&
    isLexicalScore(value.lexical) &&
    isFiniteNumber(value.sourcePriority) &&
    isFiniteNumber(value.final) &&
    isUniqueStringArray(value.matchedTerms)
  );
}

function isRetrievalEvidenceBudget(
  value: unknown
): value is RetrievalEvidenceBudget {
  return (
    isExactRecord(value, ["estimatedTokens", "estimateQuality"]) &&
    isNonNegativeInteger(value.estimatedTokens) &&
    (value.estimateQuality === "fallback" ||
      value.estimateQuality === "model-aware" ||
      value.estimateQuality === "exact")
  );
}

function isScoreComponents(value: unknown): value is RetrievalScoreComponents {
  return (
    isExactRecord(value, ["lexical", "sourcePriority", "final"]) &&
    isLexicalScore(value.lexical) &&
    isFiniteNumber(value.sourcePriority) &&
    isFiniteNumber(value.final)
  );
}

function isLexicalScore(value: unknown): value is RetrievalLexicalScore {
  return (
    isExactRecord(value, ["algorithm", "sourceId", "value"]) &&
    (value.algorithm === "bm25" || value.algorithm === "native") &&
    isNonEmptyString(value.sourceId) &&
    isFiniteNumber(value.value) &&
    value.value >= 0
  );
}

function isRetrievalSearchReceipt(value: unknown): value is RetrievalSearchReceipt {
  return (
    isExactRecord(value, [
      "kind",
      "receiptVersion",
      "requestId",
      "timestamp",
      "mode",
      "purpose",
      "outcome",
      "sources",
      "visibleHits",
      "drops",
    ]) &&
    value.kind === "retrieval-search" &&
    value.receiptVersion === 1 &&
    isNonEmptyString(value.requestId) &&
    isIsoInstant(value.timestamp) &&
    value.mode === "lexical" &&
    isPurpose(value.purpose) &&
    value.outcome === "success" &&
    Array.isArray(value.sources) &&
    value.sources.every(isReceiptSource) &&
    Array.isArray(value.visibleHits) &&
    value.visibleHits.every(isReceiptHit) &&
    Array.isArray(value.drops) &&
    value.drops.every(isReceiptDrop)
  );
}

function isRetrievalEvidenceReceipt(
  value: unknown
): value is RetrievalEvidenceReceipt {
  return (
    isExactRecord(value, [
      "kind",
      "receiptVersion",
      "requestId",
      "timestamp",
      "purpose",
      "maxPackets",
      "maxTokens",
      "candidateCount",
      "totalTokens",
      "contributors",
      "selected",
      "dropped",
      "search",
    ]) &&
    value.kind === "retrieval-evidence" &&
    value.receiptVersion === 1 &&
    isNonEmptyString(value.requestId) &&
    isIsoInstant(value.timestamp) &&
    isPurpose(value.purpose) &&
    isPositiveInteger(value.maxPackets) &&
    (value.maxTokens === undefined || isPositiveInteger(value.maxTokens)) &&
    isNonNegativeInteger(value.candidateCount) &&
    isNonNegativeInteger(value.totalTokens) &&
    Array.isArray(value.contributors) &&
    value.contributors.every(isRetrievalEvidenceContributorReceipt) &&
    Array.isArray(value.selected) &&
    value.selected.every(isRetrievalEvidenceSelectionReceipt) &&
    Array.isArray(value.dropped) &&
    value.dropped.every(isRetrievalEvidenceDropReceipt) &&
    isRetrievalSearchReceipt(value.search)
  );
}

function isRetrievalEvidenceContributorReceipt(
  value: unknown
): value is RetrievalEvidenceContributorReceipt {
  return (
    isExactRecord(value, [
      "sourceId",
      "mode",
      "generationId",
      "candidateCount",
      "selectedCount",
      "droppedCount",
    ]) &&
    isNonEmptyString(value.sourceId) &&
    (value.mode === "native-index" || value.mode === "coordinated-index") &&
    isOptionalNonEmptyString(value.generationId) &&
    isNonNegativeInteger(value.candidateCount) &&
    isNonNegativeInteger(value.selectedCount) &&
    isNonNegativeInteger(value.droppedCount)
  );
}

function isRetrievalEvidenceSelectionReceipt(
  value: unknown
): value is RetrievalEvidenceSelectionReceipt {
  return (
    isExactRecord(value, [
      "packetId",
      "resourceKey",
      "sourceId",
      "estimatedTokens",
    ]) &&
    isNonEmptyString(value.packetId) &&
    isNonEmptyString(value.resourceKey) &&
    isNonEmptyString(value.sourceId) &&
    isNonNegativeInteger(value.estimatedTokens)
  );
}

function isRetrievalEvidenceDropReceipt(
  value: unknown
): value is RetrievalEvidenceDropReceipt {
  return (
    isExactRecord(value, [
      "reason",
      "packetId",
      "resourceKey",
      "sourceId",
      "estimatedTokens",
    ]) &&
    (value.reason === "duplicate" || value.reason === "budget") &&
    isNonEmptyString(value.packetId) &&
    isNonEmptyString(value.resourceKey) &&
    isNonEmptyString(value.sourceId) &&
    isNonNegativeInteger(value.estimatedTokens)
  );
}

function isReceiptSource(value: unknown): value is RetrievalReceiptSource {
  return (
    isExactRecord(value, ["sourceId", "mode", "generationId"]) &&
    isNonEmptyString(value.sourceId) &&
    (value.mode === "native-index" || value.mode === "coordinated-index") &&
    isOptionalNonEmptyString(value.generationId)
  );
}

function isReceiptHit(value: unknown): value is RetrievalReceiptHit {
  return (
    isExactRecord(value, ["resourceKey", "sourceId", "scores"]) &&
    isNonEmptyString(value.resourceKey) &&
    isNonEmptyString(value.sourceId) &&
    isScoreComponents(value.scores)
  );
}

function isReceiptDrop(value: unknown): value is RetrievalReceiptDrop {
  return (
    isExactRecord(value, ["reason", "count"]) &&
    value.reason === "source-failed" &&
    isPositiveInteger(value.count)
  );
}

function isRetrievalIndexRequest(value: unknown): value is RetrievalIndexRequest {
  return (
    isExactRecord(value, ["requestId", "auth", "sourceId"]) &&
    isNonEmptyString(value.requestId) &&
    isAuthContext(value.auth) &&
    isNonEmptyString(value.sourceId)
  );
}

function isRetrievalIndexResult(value: unknown): value is RetrievalIndexResult {
  if (!isRecord(value) || (value.status !== "published" && value.status !== "failed")) {
    return false;
  }
  if (value.status === "published") {
    return (
      isExactRecord(value, ["status", "sourceId", "generationId", "receipt"]) &&
      isNonEmptyString(value.sourceId) &&
      isNonEmptyString(value.generationId) &&
      isIndexReceipt(value.receipt, "published")
    );
  }
  return (
    isExactRecord(value, ["status", "sourceId", "receipt"]) &&
    isNonEmptyString(value.sourceId) &&
    isIndexReceipt(value.receipt)
  );
}

function isIndexReceipt(value: unknown, outcome?: "published"): boolean {
  return (
    isExactRecord(value, [
      "kind",
      "receiptVersion",
      "requestId",
      "timestamp",
      "sourceId",
      "outcome",
      "generationId",
      "documentCount",
      "tombstoneCount",
      "failure",
    ]) &&
    value.kind === "retrieval-index" &&
    value.receiptVersion === 1 &&
    isNonEmptyString(value.requestId) &&
    isIsoInstant(value.timestamp) &&
    isNonEmptyString(value.sourceId) &&
    (value.outcome === "published" || value.outcome === "failed" || value.outcome === "denied") &&
    (outcome === undefined || value.outcome === outcome) &&
    isOptionalNonEmptyString(value.generationId) &&
    isNonNegativeInteger(value.documentCount) &&
    isNonNegativeInteger(value.tombstoneCount) &&
    (value.failure === undefined ||
      value.failure === "authorization" ||
      value.failure === "source" ||
      value.failure === "publication" ||
      value.failure === "invalid-document")
  );
}

function isRetrievalResolveRequest(value: unknown): value is RetrievalResolveRequest {
  return (
    isExactRecord(value, ["requestId", "auth", "resource"]) &&
    isNonEmptyString(value.requestId) &&
    isAuthContext(value.auth) &&
    isRetrievalResourceRef(value.resource)
  );
}

function isRetrievalResolveResult(value: unknown): value is RetrievalResolveResult {
  if (!isRecord(value)) return false;
  if (value.status === "resolved") {
    return (
      isExactRecord(value, ["status", "value", "receipt"]) &&
      isResolvedContent(value.value) &&
      isResolveReceipt(value.receipt, "resolved")
    );
  }
  if (value.status === "changed") {
    return (
      isExactRecord(value, ["status", "requested", "current", "receipt"]) &&
      isRetrievalResourceRef(value.requested) &&
      isRetrievalResourceRef(value.current) &&
      isResolveReceipt(value.receipt, "changed")
    );
  }
  if (
    value.status === "revision-unavailable" ||
    value.status === "deleted" ||
    value.status === "unauthorized"
  ) {
    return (
      isExactRecord(value, ["status", "resource", "receipt"]) &&
      isRetrievalResourceRef(value.resource) &&
      isResolveReceipt(value.receipt, value.status)
    );
  }
  return false;
}

function isResolvedContent(value: unknown): value is ResolvedRetrievalContent {
  return (
    isExactRecord(value, [
      "resource",
      "label",
      "content",
      "audience",
      "tenantId",
      "workspaceId",
    ]) &&
    isRetrievalResourceRef(value.resource) &&
    isNonEmptyString(value.label) &&
    typeof value.content === "string" &&
    isAudience(value.audience) &&
    isOptionalNonEmptyString(value.tenantId) &&
    isOptionalNonEmptyString(value.workspaceId)
  );
}

function isResolveReceipt(
  value: unknown,
  outcome?: RetrievalResolveReceipt["outcome"]
): value is RetrievalResolveReceipt {
  return (
    isExactRecord(value, [
      "kind",
      "receiptVersion",
      "requestId",
      "timestamp",
      "resourceKey",
      "outcome",
    ]) &&
    value.kind === "retrieval-resolve" &&
    value.receiptVersion === 1 &&
    isNonEmptyString(value.requestId) &&
    isIsoInstant(value.timestamp) &&
    isNonEmptyString(value.resourceKey) &&
    (value.outcome === "resolved" ||
      value.outcome === "changed" ||
      value.outcome === "revision-unavailable" ||
      value.outcome === "deleted" ||
      value.outcome === "unauthorized") &&
    (outcome === undefined || value.outcome === outcome)
  );
}

function isRetrievalCitationCreateRequest(
  value: unknown
): value is RetrievalCitationCreateRequest {
  return (
    isExactRecord(value, ["requestId", "auth", "resource", "excerpt"]) &&
    isNonEmptyString(value.requestId) &&
    isAuthContext(value.auth) &&
    isRetrievalResourceRef(value.resource) &&
    (value.excerpt === undefined || typeof value.excerpt === "string")
  );
}

function isCitationHandle(value: unknown): value is RetrievalCitationHandle {
  return (
    isExactRecord(value, ["id", "resource"]) &&
    isNonEmptyString(value.id) &&
    isRetrievalResourceRef(value.resource)
  );
}

function isRetrievalCitationCreateResult(
  value: unknown
): value is RetrievalCitationCreateResult {
  return (
    isExactRecord(value, ["status", "citation", "resolution"]) &&
    (value.status === "created" || value.status === "unavailable") &&
    (value.citation === undefined || isCitationHandle(value.citation)) &&
    (value.status === "created") === (value.citation !== undefined) &&
    isRetrievalResolveResult(value.resolution)
  );
}

function isRetrievalCitationResolveRequest(
  value: unknown
): value is RetrievalCitationResolveRequest {
  return (
    isExactRecord(value, ["requestId", "auth", "citationId"]) &&
    isNonEmptyString(value.requestId) &&
    isAuthContext(value.auth) &&
    isNonEmptyString(value.citationId)
  );
}

function isRetrievalCitationResolution(
  value: unknown
): value is RetrievalCitationResolution {
  if (!isRecord(value)) return false;
  if (value.status === "not-found") {
    return isExactRecord(value, ["status", "citationId"]) && isNonEmptyString(value.citationId);
  }
  if (value.status === "resolved") {
    return (
      isExactRecord(value, [
        "status",
        "citation",
        "label",
        "sourceLabel",
        "excerpt",
        "excerptHash",
        "resolvedAt",
      ]) &&
      isCitationHandle(value.citation) &&
      isNonEmptyString(value.label) &&
      isNonEmptyString(value.sourceLabel) &&
      (value.excerpt === undefined || typeof value.excerpt === "string") &&
      isOptionalNonEmptyString(value.excerptHash) &&
      isIsoInstant(value.resolvedAt)
    );
  }
  return (
    (value.status === "changed" ||
      value.status === "revision-unavailable" ||
      value.status === "deleted" ||
      value.status === "unauthorized") &&
    isExactRecord(value, ["status", "citation"]) &&
    isCitationHandle(value.citation)
  );
}

function isAuthContext(value: unknown): value is AuthContext {
  return (
    isExactRecord(value, ["principal", "authorize"]) &&
    isAuthenticatedPrincipal(value.principal) &&
    typeof value.authorize === "function"
  );
}

function isAudience(value: unknown): boolean {
  return (
    value === "public" ||
    value === "tenant" ||
    value === "workspace" ||
    value === "restricted"
  );
}

function isPurpose(value: unknown): boolean {
  return (
    value === "user-search" ||
    value === "agent-recall" ||
    value === "context-preview"
  );
}

function isIsoInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (!match) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , offsetHourText, offsetMinuteText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const offsetHour = offsetHourText === undefined ? 0 : Number(offsetHourText);
  const offsetMinute = offsetMinuteText === undefined ? 0 : Number(offsetMinuteText);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    month - 1
  ] ?? 0;
  return (
    month >= 1 &&
    month <= 12 &&
    day >= 1 &&
    day <= daysInMonth &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isExactRecord(
  value: unknown,
  allowedKeys: readonly string[]
): value is Record<string, unknown> {
  return isRecord(value) && Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isUniqueNonEmptyStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isNonEmptyString) &&
    new Set(value).size === value.length
  );
}

function isUniqueStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string") &&
    new Set(value).size === value.length
  );
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}
