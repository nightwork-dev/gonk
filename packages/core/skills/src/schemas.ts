import type { StandardSchemaV1 } from "@standard-schema/spec";

import { isManagedSkillId, isManagedSkillPath } from "./identifiers.ts";
import { isIsoDateOrTimestamp, isIsoTimestamp } from "./validation.ts";
import type {
  ManagedSkillDetail,
  ManagedSkillSummary,
  SkillActivateResult,
  SkillArchiveResult,
  SkillMutationResult,
  SkillFreshnessResult,
  SkillGetRequest,
  SkillGetResult,
  SkillListRequest,
  SkillListResult,
  SkillOrigin,
  SkillProvenance,
  SkillProvenanceAnchor,
  SkillReadRequest,
  SkillReadResult,
  SkillRequirement,
  SkillResolveRequest,
  SkillResolveResult,
  SkillRestoreResult,
  SkillToolProjection,
  SkillTreeEntry,
} from "./types.ts";

export const skillOriginSchema = schema<SkillOrigin>("SkillOrigin", isSkillOrigin);
export const skillRequirementSchema = schema<SkillRequirement>(
  "SkillRequirement",
  isSkillRequirement
);
export const skillProvenanceAnchorSchema = schema<SkillProvenanceAnchor>(
  "SkillProvenanceAnchor",
  isSkillProvenanceAnchor
);
export const skillProvenanceSchema = schema<SkillProvenance>(
  "SkillProvenance",
  isSkillProvenance
);
export const skillFreshnessResultSchema = schema<SkillFreshnessResult>(
  "SkillFreshnessResult",
  isSkillFreshnessResult
);
export const skillTreeEntrySchema = schema<SkillTreeEntry>(
  "SkillTreeEntry",
  isSkillTreeEntry
);
export const managedSkillSummarySchema = schema<ManagedSkillSummary>(
  "ManagedSkillSummary",
  isManagedSkillSummary
);
export const managedSkillDetailSchema = schema<ManagedSkillDetail>(
  "ManagedSkillDetail",
  isManagedSkillDetail
);
export const skillListRequestSchema = schema<SkillListRequest>(
  "SkillListRequest",
  isSkillListRequest
);
export const skillGetRequestSchema = schema<SkillGetRequest>(
  "SkillGetRequest",
  isSkillGetRequest
);
export const skillReadRequestSchema = schema<SkillReadRequest>(
  "SkillReadRequest",
  isSkillReadRequest
);
export const skillResolveRequestSchema = schema<SkillResolveRequest>(
  "SkillResolveRequest",
  isSkillResolveRequest
);
export const skillListResultSchema = schema<SkillListResult>(
  "SkillListResult",
  isSkillListResult
);
export const skillGetResultSchema = schema<SkillGetResult>(
  "SkillGetResult",
  isSkillGetResult
);
export const skillResolveResultSchema = schema<SkillResolveResult>(
  "SkillResolveResult",
  isSkillResolveResult
);
export const skillReadResultSchema = schema<SkillReadResult>(
  "SkillReadResult",
  isSkillReadResult
);
export const skillMutationResultSchema = schema<SkillMutationResult>(
  "SkillMutationResult",
  isSkillMutationResult
);
export const skillArchiveResultSchema = schema<SkillArchiveResult>(
  "SkillArchiveResult",
  isSkillArchiveResult
);
export const skillRestoreResultSchema = schema<SkillRestoreResult>(
  "SkillRestoreResult",
  isSkillRestoreResult
);
export const skillActivateResultSchema = schema<SkillActivateResult>(
  "SkillActivateResult",
  isSkillActivateResult
);
export const skillToolProjectionSchema = schema<SkillToolProjection>(
  "SkillToolProjection",
  isSkillToolProjection
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

function isSkillOrigin(value: unknown): value is SkillOrigin {
  return (
    isExactRecord(value, ["kind", "adapterId", "packageId"]) &&
    isOneOf(value.kind, [
      "gonk-managed",
      "host-installed",
      "package",
      "workspace",
    ]) &&
    isOptionalNonEmptyString(value.adapterId) &&
    isOptionalNonEmptyString(value.packageId)
  );
}

function isSkillRequirement(value: unknown): value is SkillRequirement {
  return (
    isExactRecord(value, ["tools", "hosts", "platforms"]) &&
    isOptionalNonEmptyStringArray(value.tools) &&
    isOptionalNonEmptyStringArray(value.hosts) &&
    isOptionalNonEmptyStringArray(value.platforms)
  );
}

function isSkillProvenanceAnchor(value: unknown): value is SkillProvenanceAnchor {
  return (
    isExactRecord(value, ["kind", "value"]) &&
    isOneOf(value.kind, ["file", "symbol"]) &&
    isNonEmptyString(value.value)
  );
}

function isSkillProvenance(value: unknown): value is SkillProvenance {
  return (
    isExactRecord(value, [
      "repositoryId",
      "packageId",
      "version",
      "pinnedAt",
      "anchors",
    ]) &&
    isOptionalNonEmptyString(value.repositoryId) &&
    isOptionalNonEmptyString(value.packageId) &&
    isOptionalNonEmptyString(value.version) &&
    isOptionalIsoDateOrTimestamp(value.pinnedAt) &&
    Array.isArray(value.anchors) &&
    value.anchors.length > 0 &&
    value.anchors.every(isSkillProvenanceAnchor)
  );
}

function isSkillFreshnessResult(value: unknown): value is SkillFreshnessResult {
  return (
    isExactRecord(value, ["status", "summary", "checkedAt"]) &&
    isOneOf(value.status, [
      "fresh",
      "stale",
      "dead",
      "unprobeable",
      "unknown",
    ]) &&
    isOptionalNonEmptyString(value.summary) &&
    isOptionalIsoTimestamp(value.checkedAt)
  );
}

function isSkillTreeEntry(value: unknown): value is SkillTreeEntry {
  if (
    isExactRecord(value, ["kind", "name", "path", "size", "contentHash"]) &&
    value.kind === "file"
  ) {
    return (
      isTreeName(value.name) &&
      isManagedSkillPath(value.path) &&
      isNonNegativeInteger(value.size) &&
      isHash(value.contentHash)
    );
  }
  if (
    isExactRecord(value, ["kind", "name", "path", "children"]) &&
    value.kind === "directory"
  ) {
    return (
      isTreeName(value.name) &&
      isManagedSkillPath(value.path) &&
      Array.isArray(value.children) &&
      value.children.every(isSkillTreeEntry)
    );
  }
  return false;
}

function isManagedSkillSummary(value: unknown): value is ManagedSkillSummary {
  return (
    isExactRecord(value, [
      "id",
      "name",
      "description",
      "version",
      "author",
      "origin",
      "scope",
      "lifecycle",
      "capabilities",
      "revision",
      "contentHash",
      "pinned",
      "agentCreated",
      "useCount",
      "lastUsedAt",
      "updatedAt",
      "requirements",
      "freshness",
    ]) &&
    isManagedSkillId(value.id) &&
    isOptionalNonEmptyString(value.name) &&
    isNonEmptyString(value.description) &&
    isOptionalNonEmptyString(value.version) &&
    isOptionalNonEmptyString(value.author) &&
    isSkillOrigin(value.origin) &&
    isScope(value.scope) &&
    value.lifecycle === "active" &&
    Array.isArray(value.capabilities) &&
    value.capabilities.length > 0 &&
    value.capabilities.every(isCapability) &&
    isHash(value.revision) &&
    isHash(value.contentHash) &&
    isOptionalBoolean(value.pinned) &&
    isOptionalBoolean(value.agentCreated) &&
    (value.useCount === undefined || isNonNegativeInteger(value.useCount)) &&
    isOptionalIsoTimestamp(value.lastUsedAt) &&
    isOptionalIsoTimestamp(value.updatedAt) &&
    (value.requirements === undefined || isSkillRequirement(value.requirements)) &&
    (value.freshness === undefined || isSkillFreshnessResult(value.freshness))
  );
}

function isManagedSkillDetail(value: unknown): value is ManagedSkillDetail {
  if (
    !isExactRecord(value, [
      "id",
      "name",
      "description",
      "version",
      "author",
      "origin",
      "scope",
      "lifecycle",
      "capabilities",
      "revision",
      "contentHash",
      "pinned",
      "agentCreated",
      "useCount",
      "lastUsedAt",
      "updatedAt",
      "requirements",
      "freshness",
      "body",
      "supportingFiles",
      "provenance",
      "otherDefinitions",
    ])
  ) {
    return false;
  }
  const summary = pickSummary(value);
  return (
    isManagedSkillSummary(summary) &&
    typeof value.body === "string" &&
    Array.isArray(value.supportingFiles) &&
    value.supportingFiles.every(isSkillTreeEntry) &&
    (value.provenance === undefined || isSkillProvenance(value.provenance)) &&
    Array.isArray(value.otherDefinitions) &&
    value.otherDefinitions.every(isManagedSkillSummary)
  );
}

function isSkillListRequest(value: unknown): value is SkillListRequest {
  return (
    isExactRecord(value, ["scope", "includeFreshness"]) &&
    (value.scope === undefined || isScope(value.scope)) &&
    isOptionalBoolean(value.includeFreshness)
  );
}

function isSkillGetRequest(value: unknown): value is SkillGetRequest {
  return (
    isExactRecord(value, ["id", "scope", "includeFreshness"]) &&
    isManagedSkillId(value.id) &&
    (value.scope === undefined || isScope(value.scope)) &&
    isOptionalBoolean(value.includeFreshness)
  );
}

function isSkillReadRequest(value: unknown): value is SkillReadRequest {
  return (
    isExactRecord(value, ["id", "path", "scope"]) &&
    isManagedSkillId(value.id) &&
    (value.path === undefined || isManagedSkillPath(value.path)) &&
    (value.scope === undefined || isScope(value.scope))
  );
}

function isSkillResolveRequest(value: unknown): value is SkillResolveRequest {
  return (
    isExactRecord(value, ["id", "includeFreshness"]) &&
    isManagedSkillId(value.id) &&
    isOptionalBoolean(value.includeFreshness)
  );
}

function isSkillListResult(value: unknown): value is SkillListResult {
  return (
    isExactRecord(value, ["status", "skills"]) &&
    value.status === "ok" &&
    Array.isArray(value.skills) &&
    value.skills.every(isManagedSkillSummary)
  );
}

function isSkillGetResult(value: unknown): value is SkillGetResult {
  if (isExactRecord(value, ["status", "skill"]) && value.status === "found") {
    return isManagedSkillDetail(value.skill);
  }
  return (
    isExactRecord(value, ["status", "id"]) &&
    value.status === "not-found" &&
    isManagedSkillId(value.id)
  );
}

function isSkillResolveResult(value: unknown): value is SkillResolveResult {
  if (
    isExactRecord(value, ["status", "id", "active", "definitions"]) &&
    value.status === "found"
  ) {
    return (
      isManagedSkillId(value.id) &&
      isManagedSkillDetail(value.active) &&
      value.active.id === value.id &&
      Array.isArray(value.definitions) &&
      value.definitions.length > 0 &&
      isManagedSkillSummary(value.definitions[0]) &&
      value.definitions[0].scope === value.active.scope &&
      value.definitions[0].revision === value.active.revision &&
      value.definitions.every(
        (entry) => isManagedSkillSummary(entry) && entry.id === value.id
      )
    );
  }
  return (
    isExactRecord(value, ["status", "id"]) &&
    value.status === "not-found" &&
    isManagedSkillId(value.id)
  );
}

function isSkillReadResult(value: unknown): value is SkillReadResult {
  if (
    isExactRecord(value, [
      "status",
      "id",
      "scope",
      "path",
      "content",
      "contentHash",
      "skillRevision",
      "mediaType",
    ]) &&
    value.status === "found"
  ) {
    return (
      isManagedSkillId(value.id) &&
      isScope(value.scope) &&
      isManagedSkillPath(value.path) &&
      typeof value.content === "string" &&
      isHash(value.contentHash) &&
      isHash(value.skillRevision) &&
      isOneOf(value.mediaType, ["text/markdown", "text/plain"])
    );
  }
  return (
    isExactRecord(value, ["status", "id", "path", "reason"]) &&
    value.status === "not-found" &&
    isManagedSkillId(value.id) &&
    isManagedSkillPath(value.path) &&
    isOneOf(value.reason, ["skill-not-found", "file-not-found"])
  );
}

function isSkillMutationResult(value: unknown): value is SkillMutationResult {
  if (
    isExactRecord(value, ["status", "id", "scope", "lifecycle", "revision"]) &&
    value.status === "ok"
  ) {
    return (
      isManagedSkillId(value.id) &&
      isScope(value.scope) &&
      isOneOf(value.lifecycle, ["active", "staged", "archived"]) &&
      isHash(value.revision)
    );
  }
  return isSkillFailure(value);
}

function isSkillArchiveResult(value: unknown): value is SkillArchiveResult {
  if (
    isExactRecord(value, ["status", "id", "scope", "archiveId", "archivedAt"]) &&
    value.status === "ok"
  ) {
    return (
      isManagedSkillId(value.id) &&
      isScope(value.scope) &&
      isNonEmptyString(value.archiveId) &&
      isIsoTimestamp(value.archivedAt)
    );
  }
  return isSkillFailure(value);
}

function isSkillRestoreResult(value: unknown): value is SkillRestoreResult {
  if (
    isExactRecord(value, ["status", "id", "scope", "archiveId", "revision"]) &&
    value.status === "ok"
  ) {
    return (
      isManagedSkillId(value.id) &&
      isScope(value.scope) &&
      isNonEmptyString(value.archiveId) &&
      isHash(value.revision)
    );
  }
  return isSkillFailure(value);
}

function isSkillActivateResult(value: unknown): value is SkillActivateResult {
  if (isExactRecord(value, ["status", "receipt", "candidate"]) && value.status === "ready") {
    const receipt = value.receipt;
    const candidate = value.candidate;
    return (
      isExactRecord(receipt, [
        "kind",
        "receiptVersion",
        "activationId",
        "timestamp",
        "id",
        "scope",
        "revision",
        "resourceKey",
        "principal",
      ]) &&
      receipt.kind === "skill-activation" &&
      receipt.receiptVersion === 1 &&
      isNonEmptyString(receipt.activationId) &&
      isIsoTimestamp(receipt.timestamp) &&
      isManagedSkillId(receipt.id) &&
      isScope(receipt.scope) &&
      isHash(receipt.revision) &&
      isNonEmptyString(receipt.resourceKey) &&
      isExactRecord(receipt.principal, ["id", "kind"]) &&
      isNonEmptyString(receipt.principal.id) &&
      isOneOf(receipt.principal.kind, ["human", "agent", "service", "local"]) &&
      isExactRecord(candidate, [
        "candidateId",
        "contributorId",
        "resourceKey",
        "revisionHint",
        "necessity",
        "priority",
        "estimatedTokens",
        "estimateQuality",
      ]) &&
      isNonEmptyString(candidate.candidateId) &&
      isNonEmptyString(candidate.contributorId) &&
      candidate.resourceKey === receipt.resourceKey &&
      candidate.revisionHint === receipt.revision &&
      candidate.necessity === "required" &&
      isNonNegativeInteger(candidate.priority) &&
      isNonNegativeInteger(candidate.estimatedTokens) &&
      candidate.estimateQuality === "fallback"
    );
  }
  if (
    isExactRecord(value, ["status", "id", "missing", "message"]) &&
    value.status === "missing-requirements"
  ) {
    return (
      isManagedSkillId(value.id) &&
      Array.isArray(value.missing) &&
      value.missing.every(isNonEmptyString) &&
      isNonEmptyString(value.message)
    );
  }
  return isSkillFailure(value);
}

function isSkillToolProjection(value: unknown): value is SkillToolProjection {
  return (
    isExactRecord(value, ["name", "operation", "description", "inputSchema"]) &&
    isNonEmptyString(value.name) &&
    isOneOf(value.operation, ["read", "attach", "activate", "test"]) &&
    isNonEmptyString(value.description) &&
    isExactRecord(value.inputSchema, [
      "type",
      "properties",
      "required",
      "additionalProperties",
    ]) &&
    value.inputSchema.type === "object" &&
    value.inputSchema.properties !== null &&
    typeof value.inputSchema.properties === "object" &&
    Array.isArray(value.inputSchema.required) &&
    value.inputSchema.required.every(isNonEmptyString) &&
    value.inputSchema.additionalProperties === false
  );
}

function isSkillFailure(value: unknown): value is Extract<SkillMutationResult, { status: "failed" }> {
  return (
    isExactRecord(value, [
      "status",
      "id",
      "reason",
      "message",
      "currentRevision",
      "affectedPaths",
    ]) &&
    value.status === "failed" &&
    isNonEmptyString(value.id) &&
    isOneOf(value.reason, [
      "denied",
      "not-found",
      "already-exists",
      "invalid",
      "conflict",
      "unsupported",
    ]) &&
    isNonEmptyString(value.message) &&
    (value.currentRevision === undefined || isHash(value.currentRevision)) &&
    (value.affectedPaths === undefined ||
      (Array.isArray(value.affectedPaths) &&
        value.affectedPaths.every(isManagedSkillPath)))
  );
}

function pickSummary(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "id", "name", "description", "version", "author", "origin", "scope",
    "lifecycle", "capabilities", "revision", "contentHash", "pinned",
    "agentCreated", "useCount", "lastUsedAt", "updatedAt", "requirements",
    "freshness",
  ]) {
    if (Object.hasOwn(value, key)) out[key] = value[key];
  }
  return out;
}

function isExactRecord(
  value: unknown,
  allowedKeys: readonly string[]
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key))
  );
}

function isScope(value: unknown): boolean {
  return isOneOf(value, ["global", "persona", "project", "directory", "session"]);
}

function isCapability(value: unknown): boolean {
  return isOneOf(value, [
    "read", "attach", "activate", "edit", "archive", "delete", "pin", "test",
  ]);
}

function isOneOf(value: unknown, values: readonly string[]): boolean {
  return typeof value === "string" && values.includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isOptionalNonEmptyString(value: unknown): boolean {
  return value === undefined || isNonEmptyString(value);
}

function isOptionalIsoTimestamp(value: unknown): boolean {
  return value === undefined || isIsoTimestamp(value);
}

function isOptionalIsoDateOrTimestamp(value: unknown): boolean {
  return value === undefined || isIsoDateOrTimestamp(value);
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isOptionalNonEmptyStringArray(value: unknown): boolean {
  return (
    value === undefined ||
    (Array.isArray(value) && value.every(isNonEmptyString))
  );
}

function isHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isTreeName(value: unknown): value is string {
  return (
    isNonEmptyString(value) &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !value.includes("\\")
  );
}
