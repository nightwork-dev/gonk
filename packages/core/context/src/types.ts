import type {
  AuthContext,
  AuthenticatedPrincipal,
  AuthzResource,
} from "@gonk/auth";

export type ContextAudience = "model" | "user";
export type ContextNecessity = "optional" | "required";
export type ContextEstimateQuality = "fallback" | "model-aware" | "exact";
export type ContextCompileStatus = "ready" | "blocked";
export type ContextDropReason =
  | "duplicate"
  | "budget"
  | "discovery-denied"
  | "resolution-failed"
  | "use-denied"
  | "invalid"
  | "contributor-failed";

export interface ContextCompileRequest {
  requestId: string;
  auth: AuthContext;
  audience: ContextAudience;
  maxTokens: number;
  model?: string;
  query?: string;
  requestedContributorIds?: readonly string[];
  excludedResourceKeys?: readonly string[];
  pinnedResourceKeys?: readonly string[];
}

export interface ContextCandidate {
  candidateId: string;
  contributorId: string;
  resourceKey: string;
  revisionHint?: string;
  necessity: ContextNecessity;
  priority: number;
  estimatedTokens: number;
  estimateQuality: ContextEstimateQuality;
}

export interface ResolvedContextCandidate {
  candidateId: string;
  contributorId: string;
  resourceKey: string;
  revision: string;
  necessity: ContextNecessity;
  priority: number;
  audience: ContextAudience;
  content: string;
  resource: AuthzResource;
}

export interface ContextDiscoveryRequest {
  requestId: string;
  audience: ContextAudience;
  principal: AuthenticatedPrincipal;
  query?: string;
}

export interface ContextResolutionRequest {
  requestId: string;
  audience: ContextAudience;
  principal: AuthenticatedPrincipal;
  candidate: ContextCandidate;
}

export interface ContextContributor {
  readonly id: string;
  discover(
    request: ContextDiscoveryRequest
  ):
    | readonly ContextCandidate[]
    | Promise<readonly ContextCandidate[]>;
  resolve(
    request: ContextResolutionRequest
  ):
    | ResolvedContextCandidate
    | null
    | Promise<ResolvedContextCandidate | null>;
}

export interface ContextTokenCounter {
  count(input: {
    content: string;
    model?: string;
  }): ContextTokenCount | Promise<ContextTokenCount>;
}

export interface ContextTokenCount {
  tokens: number;
  quality: ContextEstimateQuality;
}

export interface CompiledContextBlock {
  candidateId: string;
  contributorId: string;
  resourceKey: string;
  revision: string;
  necessity: ContextNecessity;
  priority: number;
  audience: ContextAudience;
  content: string;
  contentTokens: number;
  renderedTokens: number;
  tokenQuality: ContextEstimateQuality;
}

export interface ContextReceiptSelection {
  candidateId: string;
  contributorId: string;
  resourceKey: string;
  revision: string;
  necessity: ContextNecessity;
  contentTokens: number;
  renderedTokens: number;
  tokenQuality: ContextEstimateQuality;
}

export type ContextReceiptDrop =
  | {
      reason: "duplicate";
      candidateId: string;
      contributorId: string;
      resourceKey: string;
      revision: string;
    }
  | {
      reason: "budget";
      candidateId: string;
      contributorId: string;
      resourceKey: string;
      revision: string;
      necessity: ContextNecessity;
      contentTokens: number;
      renderedTokens: number;
      tokenQuality: ContextEstimateQuality;
    }
  | {
      reason: "resolution-failed" | "use-denied";
      candidateId: string;
      contributorId: string;
      resourceKey: string;
      necessity: ContextNecessity;
    }
  | {
      reason: "invalid";
      contributorId: string;
    }
  | {
      reason: "invalid";
      contributorId: string;
      candidateId: string;
      resourceKey: string;
      necessity: ContextNecessity;
    }
  | {
      reason: "contributor-failed";
      contributorId: string;
    };

export type ContextBlockingReason =
  | {
      reason: "discovery-denied";
      necessity: "required";
      pinned: false;
    }
  | {
      reason: "discovery-denied";
      necessity: ContextNecessity;
      pinned: true;
      resourceKey: string;
    }
  | {
      reason: "resolution-failed" | "use-denied" | "budget" | "invalid";
      necessity: ContextNecessity;
      pinned: boolean;
      contributorId?: string;
      candidateId?: string;
      resourceKey?: string;
    };

export interface ContextCompilationReceipt {
  kind: "context-compilation";
  receiptVersion: 1;
  requestId: string;
  timestamp: string;
  compilerVersion: string;
  configVersion: string;
  status: ContextCompileStatus;
  audience: ContextAudience;
  maxTokens: number;
  totalTokens: number;
  selected: readonly ContextReceiptSelection[];
  dropped: readonly ContextReceiptDrop[];
  blockers: readonly ContextBlockingReason[];
}

export interface ContextCompileReadyResult {
  status: "ready";
  blocks: readonly CompiledContextBlock[];
  content: string;
  totalTokens: number;
  receipt: ContextCompilationReceipt & { status: "ready" };
}

export interface ContextCompileBlockedResult {
  status: "blocked";
  blockers: readonly ContextBlockingReason[];
  receipt: ContextCompilationReceipt & { status: "blocked" };
}

export type ContextCompileResult =
  | ContextCompileReadyResult
  | ContextCompileBlockedResult;
