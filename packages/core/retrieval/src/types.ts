import type {
  AuthContext,
  AuthenticatedPrincipal,
} from "@gonk/auth";
import type { KvStore } from "@gonk/store";
import type { StandardSchemaV1 } from "@standard-schema/spec";

export type RetrievalSourceMode = "native-index" | "coordinated-index";
export type RevisionResolution = "current-only" | "historical";
export type RetrievalAudience = "public" | "tenant" | "workspace" | "restricted";
export type RetrievalPurpose = "user-search" | "agent-recall" | "context-preview";
export type RetrievalQueryMode = "lexical";

export type RetrievalFragmentRef =
  | { kind: "range"; id: string; start: number; end: number }
  | { kind: "section"; id: string }
  | { kind: "chunk"; id: string }
  | { kind: "record"; id: string };

export interface RetrievalResourceRef {
  sourceId: string;
  kind: string;
  id: string;
  revision: string;
  fragment?: RetrievalFragmentRef;
}

export type RetrievalFacetValue = string | number | boolean;

export interface RetrievalFacet {
  name: string;
  value: RetrievalFacetValue;
}

export interface RetrievalFilterDefinition {
  schemaId: string;
  schemaVersion: number;
}

interface RetrievalSourceDescriptionBase {
  id: string;
  label: string;
  revisionResolution: RevisionResolution;
  resourceKinds: readonly string[];
  filter: RetrievalFilterDefinition;
  priority: number;
}

export type RetrievalSourceDescription = RetrievalSourceDescriptionBase &
  (
    | {
        mode: "native-index";
        rankingContract: "source-enforced-authorized-corpus";
      }
    | { mode: "coordinated-index" }
  );

export interface RetrievalSourceFilter<Filter = unknown> {
  sourceId: string;
  schemaId: string;
  schemaVersion: number;
  value: Filter;
}

export interface RetrievalSearchRequest {
  requestId: string;
  auth: AuthContext;
  text: string;
  sourceIds?: readonly string[];
  filters?: readonly RetrievalSourceFilter[];
  mode: RetrievalQueryMode;
  limit: number;
  purpose: RetrievalPurpose;
}

export interface RetrievalScanRequest {
  requestId: string;
  principal: AuthenticatedPrincipal;
  sourceId: string;
  tenantId?: string;
  workspaceId?: string;
}

export interface RetrievalIndexRequest {
  requestId: string;
  auth: AuthContext;
  sourceId: string;
}

export interface RetrievalDocument {
  resource: RetrievalResourceRef;
  searchText: string;
  contentHash: string;
  audience: RetrievalAudience;
  tenantId?: string;
  workspaceId?: string;
  facets?: readonly RetrievalFacet[];
}

export interface NativeRetrievalCandidate {
  resource: RetrievalResourceRef;
  audience: RetrievalAudience;
  tenantId?: string;
  workspaceId?: string;
  /** Score computed by the source after enforcing its authorized-corpus contract. */
  lexicalScore: number;
}

export interface NativeRetrievalSearchRequest<Filter = unknown> {
  requestId: string;
  principal: AuthenticatedPrincipal;
  text: string;
  filter?: Filter;
  limit: number;
  purpose: RetrievalPurpose;
}

export interface ResolvedRetrievalContent {
  resource: RetrievalResourceRef;
  label: string;
  content: string;
  audience: RetrievalAudience;
  tenantId?: string;
  workspaceId?: string;
}

export type SourceResolutionResult =
  | { status: "resolved"; value: ResolvedRetrievalContent }
  | {
      status: "changed";
      requested: RetrievalResourceRef;
      current: RetrievalResourceRef;
    }
  | { status: "revision-unavailable"; resource: RetrievalResourceRef }
  | { status: "deleted"; resource: RetrievalResourceRef };

interface RetrievalSourceBase<Filter> {
  readonly description: RetrievalSourceDescription;
  readonly filterSchema: StandardSchemaV1<unknown, Filter>;
  resolve(
    resource: RetrievalResourceRef,
    auth: AuthContext
  ): SourceResolutionResult | Promise<SourceResolutionResult>;
}

export interface NativeRetrievalSource<Filter = unknown>
  extends RetrievalSourceBase<Filter> {
  /**
   * Declares that search excludes unauthorized documents before filtering,
   * corpus statistics, normalization, and ranking. Implementations must pass
   * `nativeAuthorizedRankingConformanceCases()`.
   */
  readonly description: Extract<RetrievalSourceDescription, { mode: "native-index" }>;
  search(
    request: NativeRetrievalSearchRequest<Filter>,
    auth: AuthContext
  ):
    | readonly NativeRetrievalCandidate[]
    | Promise<readonly NativeRetrievalCandidate[]>;
}

export interface CoordinatedRetrievalSource<Filter = unknown>
  extends RetrievalSourceBase<Filter> {
  readonly description: Extract<
    RetrievalSourceDescription,
    { mode: "coordinated-index" }
  >;
  scan(
    request: RetrievalScanRequest,
    auth: AuthContext
  ): AsyncIterable<RetrievalDocument>;
  matchesFilter(document: RetrievalDocument, filter: Filter): boolean;
}

export type RetrievalSource =
  | NativeRetrievalSource<unknown>
  | CoordinatedRetrievalSource<unknown>;

export interface RetrievalSourceListRequest {
  requestId: string;
  auth: AuthContext;
}

export interface RetrievalSourceListResult {
  sources: readonly RetrievalSourceDescription[];
}

export interface RetrievalLexicalScore {
  algorithm: "bm25" | "native";
  sourceId: string;
  value: number;
}

export interface RetrievalScoreComponents {
  lexical: RetrievalLexicalScore;
  sourcePriority: number;
  final: number;
}

export interface RetrievalHit {
  resource: RetrievalResourceRef;
  audience: RetrievalAudience;
  generationId?: string;
  scores: RetrievalScoreComponents;
  matchedTerms: readonly string[];
}

export interface RetrievalReceiptSource {
  sourceId: string;
  mode: RetrievalSourceMode;
  generationId?: string;
}

export interface RetrievalReceiptHit {
  resourceKey: string;
  sourceId: string;
  scores: RetrievalScoreComponents;
}

export interface RetrievalReceiptDrop {
  reason: "source-failed";
  count: number;
}

export interface RetrievalSearchReceipt {
  kind: "retrieval-search";
  receiptVersion: 1;
  requestId: string;
  timestamp: string;
  mode: RetrievalQueryMode;
  purpose: RetrievalPurpose;
  outcome: "success";
  sources: readonly RetrievalReceiptSource[];
  visibleHits: readonly RetrievalReceiptHit[];
  drops: readonly RetrievalReceiptDrop[];
}

export interface RetrievalSearchResult {
  hits: readonly RetrievalHit[];
  receipt: RetrievalSearchReceipt;
}

export type RetrievalEvidenceEstimateQuality = "fallback" | "model-aware" | "exact";

export interface RetrievalEvidenceBudget {
  estimatedTokens: number;
  estimateQuality: RetrievalEvidenceEstimateQuality;
}

export interface RetrievalEvidenceRanking {
  lexical: RetrievalLexicalScore;
  sourcePriority: number;
  final: number;
  matchedTerms: readonly string[];
}

export interface RetrievalEvidenceSourceRef {
  sourceId: string;
  mode: RetrievalSourceMode;
  generationId?: string;
}

export interface RetrievalEvidencePacket {
  packetId: string;
  resourceKey: string;
  resource: RetrievalResourceRef;
  audience: RetrievalAudience;
  source: RetrievalEvidenceSourceRef;
  ranking: RetrievalEvidenceRanking;
  budget: RetrievalEvidenceBudget;
}

export interface RetrievalEvidenceContributorReceipt {
  sourceId: string;
  mode: RetrievalSourceMode;
  generationId?: string;
  candidateCount: number;
  selectedCount: number;
  droppedCount: number;
}

export interface RetrievalEvidenceSelectionReceipt {
  packetId: string;
  resourceKey: string;
  sourceId: string;
  estimatedTokens: number;
}

export type RetrievalEvidenceDropReason = "duplicate" | "budget";

export interface RetrievalEvidenceDropReceipt {
  reason: RetrievalEvidenceDropReason;
  packetId: string;
  resourceKey: string;
  sourceId: string;
  estimatedTokens: number;
}

export interface RetrievalEvidenceReceipt {
  kind: "retrieval-evidence";
  receiptVersion: 1;
  requestId: string;
  timestamp: string;
  purpose: RetrievalPurpose;
  maxPackets: number;
  maxTokens?: number;
  candidateCount: number;
  totalTokens: number;
  contributors: readonly RetrievalEvidenceContributorReceipt[];
  selected: readonly RetrievalEvidenceSelectionReceipt[];
  dropped: readonly RetrievalEvidenceDropReceipt[];
  search: RetrievalSearchReceipt;
}

export interface RetrievalEvidenceRequest {
  requestId: string;
  auth: AuthContext;
  text: string;
  sourceIds?: readonly string[];
  filters?: readonly RetrievalSourceFilter[];
  mode: RetrievalQueryMode;
  purpose: RetrievalPurpose;
  maxPackets: number;
  maxTokens?: number;
  candidateLimit?: number;
  estimateTokens?: (hit: RetrievalHit) => RetrievalEvidenceBudget;
}

export interface RetrievalEvidenceResult {
  packets: readonly RetrievalEvidencePacket[];
  receipt: RetrievalEvidenceReceipt;
}

export interface RetrievalIndexReceipt {
  kind: "retrieval-index";
  receiptVersion: 1;
  requestId: string;
  timestamp: string;
  sourceId: string;
  outcome: "published" | "failed" | "denied";
  generationId?: string;
  documentCount: number;
  tombstoneCount: number;
  failure?: "authorization" | "source" | "publication" | "invalid-document";
}

export type RetrievalIndexResult =
  | {
      status: "published";
      sourceId: string;
      generationId: string;
      receipt: RetrievalIndexReceipt & { outcome: "published" };
    }
  | {
      status: "failed";
      sourceId: string;
      receipt: RetrievalIndexReceipt & { outcome: "failed" | "denied" };
    };

export interface RetrievalResolveRequest {
  requestId: string;
  auth: AuthContext;
  resource: RetrievalResourceRef;
}

export interface RetrievalResolveReceipt {
  kind: "retrieval-resolve";
  receiptVersion: 1;
  requestId: string;
  timestamp: string;
  resourceKey: string;
  outcome:
    | "resolved"
    | "changed"
    | "revision-unavailable"
    | "deleted"
    | "unauthorized";
}

export type RetrievalResolveResult =
  | {
      status: "resolved";
      value: ResolvedRetrievalContent;
      receipt: RetrievalResolveReceipt & { outcome: "resolved" };
    }
  | {
      status: "changed";
      requested: RetrievalResourceRef;
      current: RetrievalResourceRef;
      receipt: RetrievalResolveReceipt & { outcome: "changed" };
    }
  | {
      status: "revision-unavailable" | "deleted" | "unauthorized";
      resource: RetrievalResourceRef;
      receipt: RetrievalResolveReceipt;
    };

export interface RetrievalCitationCreateRequest {
  requestId: string;
  auth: AuthContext;
  resource: RetrievalResourceRef;
  excerpt?: string;
}

export interface RetrievalCitationHandle {
  id: string;
  resource: RetrievalResourceRef;
}

export interface RetrievalCitationCreateResult {
  status: "created" | "unavailable";
  citation?: RetrievalCitationHandle;
  resolution: RetrievalResolveResult;
}

export interface RetrievalCitationResolveRequest {
  requestId: string;
  auth: AuthContext;
  citationId: string;
}

export type RetrievalCitationResolution =
  | {
      status: "resolved";
      citation: RetrievalCitationHandle;
      label: string;
      sourceLabel: string;
      excerpt?: string;
      excerptHash?: string;
      resolvedAt: string;
    }
  | {
      status:
        | "changed"
        | "revision-unavailable"
        | "deleted"
        | "unauthorized";
      citation: RetrievalCitationHandle;
    }
  | { status: "not-found"; citationId: string };

export interface RetrievalGenerationStorage {
  generations: KvStore<unknown>;
  pointers: KvStore<unknown>;
  citations: KvStore<unknown>;
}

export interface RetrievalClock {
  now(): string;
}
