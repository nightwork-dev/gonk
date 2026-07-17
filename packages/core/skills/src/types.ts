import type { AuthContext, AuthenticatedPrincipal } from "@gonk/auth";
import type { ContextContributor } from "@gonk/context";
import type { ScopeEnvironment } from "@gonk/scope";
import type { ToolContext } from "@gonk/tool-registry";
import type { ApprovalProvider } from "@gonk/tool-registry/security";

export type SkillScope =
  | "global"
  | "persona"
  | "project"
  | "directory"
  | "session";

export type SkillLifecycle = "active" | "staged" | "archived";

export type SkillOriginKind =
  | "gonk-managed"
  | "host-installed"
  | "package"
  | "workspace";

export type SkillCapability =
  | "read"
  | "attach"
  | "activate"
  | "edit"
  | "archive"
  | "delete"
  | "pin"
  | "test";

export type SkillFreshness =
  | "fresh"
  | "stale"
  | "dead"
  | "unprobeable"
  | "unknown";

export type SkillMutationFailureReason =
  | "denied"
  | "not-found"
  | "already-exists"
  | "invalid"
  | "conflict"
  | "unsupported";

export type SkillProvenanceAnchorKind = "file" | "symbol";

export interface SkillOrigin {
  kind: SkillOriginKind;
  adapterId?: string;
  packageId?: string;
}

export interface SkillRequirement {
  tools?: readonly string[];
  hosts?: readonly string[];
  platforms?: readonly string[];
}

export interface SkillProvenanceAnchor {
  kind: SkillProvenanceAnchorKind;
  value: string;
}

export interface SkillProvenance {
  repositoryId?: string;
  packageId?: string;
  version?: string;
  pinnedAt?: string;
  anchors: readonly SkillProvenanceAnchor[];
}

export interface SkillFreshnessResult {
  status: SkillFreshness;
  summary?: string;
  checkedAt?: string;
}

export interface SkillFreshnessProbeInput {
  id: string;
  revision: string;
  provenance: SkillProvenance;
}

export interface SkillFreshnessProbe {
  probe(
    input: SkillFreshnessProbeInput
  ):
    | SkillFreshnessResult
    | Promise<SkillFreshnessResult>;
}

export interface SkillFileEntry {
  kind: "file";
  name: string;
  path: string;
  size: number;
  contentHash: string;
}

export interface SkillDirectoryEntry {
  kind: "directory";
  name: string;
  path: string;
  children: readonly SkillTreeEntry[];
}

export type SkillTreeEntry = SkillFileEntry | SkillDirectoryEntry;

export interface ManagedSkillSummary {
  id: string;
  name?: string;
  description: string;
  version?: string;
  author?: string;
  tags?: readonly string[];
  origin: SkillOrigin;
  scope: SkillScope;
  lifecycle: "active";
  capabilities: readonly SkillCapability[];
  revision: string;
  contentHash: string;
  pinned?: boolean;
  agentCreated?: boolean;
  useCount?: number;
  lastUsedAt?: string;
  updatedAt?: string;
  requirements?: SkillRequirement;
  freshness?: SkillFreshnessResult;
}

export interface ManagedSkillDetail extends ManagedSkillSummary {
  body: string;
  supportingFiles: readonly SkillTreeEntry[];
  provenance?: SkillProvenance;
  /** Other definitions of this id, labelled neutrally in scope order. */
  otherDefinitions: readonly ManagedSkillSummary[];
}

export interface SkillListRequest {
  scope?: SkillScope;
  includeFreshness?: boolean;
}

export interface SkillGetRequest {
  id: string;
  scope?: SkillScope;
  includeFreshness?: boolean;
}

export interface SkillResolveRequest {
  id: string;
  includeFreshness?: boolean;
}

export interface SkillReadRequest {
  id: string;
  path?: string;
  scope?: SkillScope;
}

export interface SkillListResult {
  status: "ok";
  skills: readonly ManagedSkillSummary[];
}

export type SkillGetResult =
  | { status: "found"; skill: ManagedSkillDetail }
  | { status: "not-found"; id: string };

export type SkillResolveResult =
  | {
      status: "found";
      id: string;
      active: ManagedSkillDetail;
      definitions: readonly ManagedSkillSummary[];
    }
  | { status: "not-found"; id: string };

export type SkillReadResult =
  | {
      status: "found";
      id: string;
      scope: SkillScope;
      path: string;
      content: string;
      contentHash: string;
      skillRevision: string;
      mediaType: "text/markdown" | "text/plain";
    }
  | {
      status: "not-found";
      id: string;
      path: string;
      reason: "skill-not-found" | "file-not-found";
    };

export interface SkillMutationFile {
  path: string;
  content: string;
}

export interface SkillCreateRequest {
  auth: AuthContext;
  idempotencyKey: string;
  id: string;
  scope: SkillScope;
  description: string;
  body: string;
  name?: string;
  version?: string;
  author?: string;
  tags?: readonly string[];
  provenance?: SkillProvenance;
  pinned?: boolean;
  agentCreated?: boolean;
  staged?: boolean;
  files?: readonly SkillMutationFile[];
}

export interface SkillPatchRequest {
  auth: AuthContext;
  idempotencyKey: string;
  expectedRevision: string;
  id: string;
  scope?: SkillScope;
  path?: string;
  find: string;
  replace: string;
  writeFiles?: readonly SkillMutationFile[];
  removeFiles?: readonly string[];
}

export interface SkillArchiveRequest {
  auth: AuthContext;
  idempotencyKey: string;
  expectedRevision: string;
  id: string;
  scope?: SkillScope;
}

export interface SkillRestoreRequest {
  auth: AuthContext;
  idempotencyKey: string;
  id: string;
  scope?: SkillScope;
  archiveId?: string;
}

export interface SkillPromoteRequest {
  auth: AuthContext;
  idempotencyKey: string;
  id: string;
  scope?: SkillScope;
  approval: SkillPromotionApproval;
}

export interface SkillPinRequest {
  auth: AuthContext;
  idempotencyKey: string;
  expectedRevision: string;
  id: string;
  scope?: SkillScope;
  pinned: boolean;
}

export interface SkillRecordUsageRequest {
  auth: AuthContext;
  idempotencyKey: string;
  expectedRevision: string;
  id: string;
  scope?: SkillScope;
  usedAt?: string;
}

export type SkillMutationOperation =
  | "create"
  | "patch"
  | "archive"
  | "restore"
  | "promote"
  | "pin"
  | "record-usage";

export type SkillMutationResult =
  | {
      status: "ok";
      id: string;
      scope: SkillScope;
      lifecycle: SkillLifecycle;
      revision: string;
    }
  | {
      status: "failed";
      id: string;
      reason: SkillMutationFailureReason;
      message: string;
      currentRevision?: string;
      affectedPaths?: readonly string[];
    };

export interface SkillPromotionApproval {
  assertion: "approved-for-promotion";
  approvedBy: string;
  approvedAt: string;
  reason: string;
}

export interface SkillArchiveEntry {
  id: string;
  archiveId: string;
  scope: SkillScope;
  archivedAt: string;
  restoredAt?: string;
}

export type SkillArchiveResult =
  | {
      status: "ok";
      id: string;
      scope: SkillScope;
      archiveId: string;
      archivedAt: string;
    }
  | {
      status: "failed";
      id: string;
      reason: SkillMutationFailureReason;
      message: string;
    };

export type SkillRestoreResult =
  | {
      status: "ok";
      id: string;
      scope: SkillScope;
      archiveId: string;
      revision: string;
    }
  | {
      status: "failed";
      id: string;
      reason: SkillMutationFailureReason;
      message: string;
    };

export type SkillMutationReceiptResult =
  | SkillMutationResult
  | SkillArchiveResult
  | SkillRestoreResult;

export interface SkillMutationReceipt {
  kind: "skill-mutation";
  receiptVersion: 1;
  receiptId: string;
  timestamp: string;
  operation: SkillMutationOperation;
  requestFingerprint: string;
  id: string;
  scope: SkillScope;
  result: SkillMutationReceiptResult;
}

export interface SkillMutationReceiptRequest {
  auth: AuthContext;
  operation: SkillMutationOperation;
  idempotencyKey: string;
}

export type SkillMutationReceiptReadResult =
  | { status: "found"; receipt: SkillMutationReceipt }
  | { status: "not-found" }
  | { status: "failed"; reason: "denied"; message: string };

export interface SkillActivationReceipt {
  kind: "skill-activation";
  receiptVersion: 1;
  activationId: string;
  timestamp: string;
  id: string;
  scope: SkillScope;
  revision: string;
  resourceKey: string;
  principal: Pick<AuthenticatedPrincipal, "id" | "kind">;
}

export interface SkillActivationReceiptListRequest {
  auth: AuthContext;
  id?: string;
  scope?: SkillScope;
}

export interface SkillActivationReceiptListResult {
  status: "ok";
  receipts: readonly SkillActivationReceipt[];
}

export interface SkillActivationReceiptGetRequest {
  auth: AuthContext;
  activationId: string;
}

export type SkillActivationReceiptGetResult =
  | { status: "found"; receipt: SkillActivationReceipt }
  | { status: "not-found" }
  | { status: "failed"; reason: "denied"; message: string };

export interface SkillMutationJournalQuery {
  operation: SkillMutationOperation;
  securityContextKey: string;
  idempotencyKey: string;
}

export interface SkillMutationJournalWrite extends SkillMutationJournalQuery {
  timestamp: string;
  requestFingerprint: string;
  id: string;
  scope: SkillScope;
  result: SkillMutationReceiptResult;
}

export interface SkillActivationJournalQuery {
  securityContextKey: string;
  activationId: string;
}

export interface SkillActivationJournalWrite {
  securityContextKey: string;
  receipt: SkillActivationReceipt;
}

export interface SkillMutationJournalRecord {
  kind: "skill-mutation-journal";
  recordVersion: 1;
  securityContextKey: string;
  receipt: SkillMutationReceipt;
}

export interface SkillActivationJournalRecord {
  kind: "skill-activation-journal";
  recordVersion: 1;
  securityContextKey: string;
  receipt: SkillActivationReceipt;
}

export interface SkillLifecycleJournal {
  mutationReceiptId(query: SkillMutationJournalQuery): string;
  readMutation(query: SkillMutationJournalQuery): SkillMutationReceipt | undefined;
  readMutationByReceiptId(
    scope: SkillScope,
    receiptId: string
  ): SkillMutationReceipt | undefined;
  writeMutation(input: SkillMutationJournalWrite): SkillMutationReceipt;
  readActivation(query: SkillActivationJournalQuery): SkillActivationReceipt | undefined;
  listActivations(securityContextKey: string): readonly SkillActivationReceipt[];
  writeActivation(input: SkillActivationJournalWrite): void;
}

export interface SkillActivateRequest {
  auth: AuthContext;
  id: string;
  scope?: SkillScope;
  requestId?: string;
  trigger: "manual" | "rule" | "startup" | "session";
  reason: string;
}

export type SkillActivateResult =
  | {
      status: "ready";
      receipt: SkillActivationReceipt;
      candidate: {
        candidateId: string;
        contributorId: string;
        resourceKey: string;
        revisionHint: string;
        necessity: "required";
        priority: number;
        estimatedTokens: number;
        estimateQuality: "fallback";
      };
    }
  | {
      status: "missing-requirements";
      id: string;
      missing: readonly string[];
      message: string;
    }
  | {
      status: "failed";
      id: string;
      reason: SkillMutationFailureReason;
      message: string;
    };

export interface SkillActivationContributorOptions {
  registry: ManagedSkillRegistry;
  activations: () => readonly SkillActivationReceipt[];
  contributorId?: string;
}

export interface SkillToolProjection {
  name: string;
  operation: "read" | "attach" | "activate" | "test";
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: readonly string[];
    additionalProperties: false;
  };
}

export interface SkillHostToolInput {
  id: string;
  scope?: SkillScope;
  path?: string;
}

export interface SkillHostToolResult {
  status: "ok" | "failed";
  operation: "attach" | "test";
  id: string;
  message: string;
}

export type SkillHostToolCallback = (
  input: SkillHostToolInput,
  context: ToolContext
) => SkillHostToolResult | Promise<SkillHostToolResult>;

export interface SkillToolDefinitionFactoryOptions {
  registry: WritableManagedSkillRegistry;
  attach?: SkillHostToolCallback;
  test?: SkillHostToolCallback;
}

export interface ManagedSkillRegistry {
  /** Discovery only. The caller owns authorization before returning records. */
  list(request?: SkillListRequest): Promise<SkillListResult>;
  /** The caller must authorize detail/body disclosure before exposing this result. */
  get(request: SkillGetRequest): Promise<SkillGetResult>;
  /** The caller must authorize definition-resolution disclosure before exposing this result. */
  resolve(request: SkillResolveRequest): Promise<SkillResolveResult>;
  /** The caller must authorize content disclosure before exposing this result. */
  read(request: SkillReadRequest): Promise<SkillReadResult>;
}

export interface WritableManagedSkillRegistry extends ManagedSkillRegistry {
  create(request: SkillCreateRequest): Promise<SkillMutationResult>;
  patch(request: SkillPatchRequest): Promise<SkillMutationResult>;
  archive(request: SkillArchiveRequest): Promise<SkillArchiveResult>;
  restore(request: SkillRestoreRequest): Promise<SkillRestoreResult>;
  promote(request: SkillPromoteRequest): Promise<SkillMutationResult>;
  pin(request: SkillPinRequest): Promise<SkillMutationResult>;
  recordUsage(request: SkillRecordUsageRequest): Promise<SkillMutationResult>;
  activate(request: SkillActivateRequest): Promise<SkillActivateResult>;
  getMutationReceipt(
    request: SkillMutationReceiptRequest
  ): Promise<SkillMutationReceiptReadResult>;
  getActivationReceipt(
    request: SkillActivationReceiptGetRequest
  ): Promise<SkillActivationReceiptGetResult>;
  listActivationReceipts(
    request: SkillActivationReceiptListRequest
  ): Promise<SkillActivationReceiptListResult>;
}

export interface FilesystemManagedSkillRegistryOptions {
  env: ScopeEnvironment;
  freshnessProbe?: SkillFreshnessProbe;
  now?: () => string;
  promotionApprovalProvider?: ApprovalProvider;
  lifecycleJournal?: SkillLifecycleJournal;
}

export type { ContextContributor };
