import { canonicalResourceKey } from "./identity.ts";
import { retrievalEvidenceResultSchema } from "./schemas.ts";
import type {
  RetrievalClock,
  RetrievalEvidenceBudget,
  RetrievalEvidenceContributorReceipt,
  RetrievalEvidenceDropReceipt,
  RetrievalEvidencePacket,
  RetrievalEvidenceRequest,
  RetrievalEvidenceResult,
  RetrievalEvidenceSelectionReceipt,
  RetrievalHit,
  RetrievalReceiptSource,
  RetrievalSearchResult,
} from "./types.ts";
import type { RetrievalEngine } from "./engine.ts";
import { validateStandard } from "./validation.ts";

const DEFAULT_CANDIDATE_LIMIT = 100;

export class RetrievalEvidenceCoordinator {
  constructor(
    private readonly options: {
      engine: Pick<RetrievalEngine, "search">;
      clock?: RetrievalClock;
    }
  ) {}

  async collect(request: RetrievalEvidenceRequest): Promise<RetrievalEvidenceResult> {
    validateEvidenceRequest(request);
    const search = await this.options.engine.search({
      requestId: `${request.requestId}:search`,
      auth: request.auth,
      text: request.text,
      ...(request.sourceIds === undefined ? {} : { sourceIds: request.sourceIds }),
      ...(request.filters === undefined ? {} : { filters: request.filters }),
      mode: request.mode,
      purpose: request.purpose,
      limit: request.candidateLimit ?? Math.max(DEFAULT_CANDIDATE_LIMIT, request.maxPackets),
    });
    const selection = selectWithinBudget(
      search,
      request.maxPackets,
      request.maxTokens,
      request.estimateTokens ?? defaultEstimate
    );
    return validateStandard(
      retrievalEvidenceResultSchema,
      {
        packets: selection.selected,
        receipt: {
          kind: "retrieval-evidence",
          receiptVersion: 1,
          requestId: request.requestId,
          timestamp: this.now(),
          purpose: request.purpose,
          maxPackets: request.maxPackets,
          ...(request.maxTokens === undefined ? {} : { maxTokens: request.maxTokens }),
          candidateCount: search.hits.length,
          totalTokens: selection.totalTokens,
          contributors: contributorReceipts(
            search.receipt.sources,
            selection.candidates,
            selection.selected,
            selection.dropped
          ),
          selected: selection.selected.map(selectionReceipt),
          dropped: selection.dropped,
          search: search.receipt,
        },
      },
      "RetrievalEvidenceResult"
    );
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }
}

function selectWithinBudget(
  search: RetrievalSearchResult,
  maxPackets: number,
  maxTokens: number | undefined,
  estimateTokens: (hit: RetrievalHit) => RetrievalEvidenceBudget
): {
  candidates: readonly RetrievalEvidencePacket[];
  selected: readonly RetrievalEvidencePacket[];
  dropped: readonly RetrievalEvidenceDropReceipt[];
  totalTokens: number;
} {
  const sourceModes = new Map(
    search.receipt.sources.map((source) => [source.sourceId, source] as const)
  );
  const seen = new Set<string>();
  const candidates: RetrievalEvidencePacket[] = [];
  const selected: RetrievalEvidencePacket[] = [];
  const dropped: RetrievalEvidenceDropReceipt[] = [];
  let totalTokens = 0;

  for (const hit of search.hits) {
    const packet = evidencePacket(hit, sourceModes, estimateTokens(hit));
    candidates.push(packet);
    if (seen.has(packet.resourceKey)) {
      dropped.push(dropReceipt("duplicate", packet));
      continue;
    }
    seen.add(packet.resourceKey);
    const wouldExceedTokens =
      maxTokens !== undefined && totalTokens + packet.budget.estimatedTokens > maxTokens;
    if (selected.length >= maxPackets || wouldExceedTokens) {
      dropped.push(dropReceipt("budget", packet));
      continue;
    }
    selected.push(packet);
    totalTokens += packet.budget.estimatedTokens;
  }

  return { candidates, selected, dropped, totalTokens };
}

function evidencePacket(
  hit: RetrievalHit,
  sourceModes: ReadonlyMap<string, RetrievalReceiptSource>,
  budget: RetrievalEvidenceBudget
): RetrievalEvidencePacket {
  const resourceKey = canonicalResourceKey(hit.resource);
  const source = sourceModes.get(hit.resource.sourceId);
  if (source === undefined) {
    throw new TypeError(`Missing retrieval receipt source: ${hit.resource.sourceId}`);
  }
  return {
    packetId: resourceKey,
    resourceKey,
    resource: structuredClone(hit.resource),
    audience: hit.audience,
    source: {
      sourceId: source.sourceId,
      mode: source.mode,
      ...(source.generationId === undefined ? {} : { generationId: source.generationId }),
    },
    ranking: {
      lexical: structuredClone(hit.scores.lexical),
      sourcePriority: hit.scores.sourcePriority,
      final: hit.scores.final,
      matchedTerms: [...hit.matchedTerms],
    },
    budget: {
      estimatedTokens: budget.estimatedTokens,
      estimateQuality: budget.estimateQuality,
    },
  };
}

function contributorReceipts(
  sources: readonly RetrievalReceiptSource[],
  candidates: readonly RetrievalEvidencePacket[],
  selected: readonly RetrievalEvidencePacket[],
  dropped: readonly RetrievalEvidenceDropReceipt[]
): readonly RetrievalEvidenceContributorReceipt[] {
  return sources.map((source) => ({
    sourceId: source.sourceId,
    mode: source.mode,
    ...(source.generationId === undefined ? {} : { generationId: source.generationId }),
    candidateCount: candidates.filter(
      (candidate) => candidate.source.sourceId === source.sourceId
    ).length,
    selectedCount: selected.filter(
      (candidate) => candidate.source.sourceId === source.sourceId
    ).length,
    droppedCount: dropped.filter((drop) => drop.sourceId === source.sourceId).length,
  }));
}

function selectionReceipt(
  packet: RetrievalEvidencePacket
): RetrievalEvidenceSelectionReceipt {
  return {
    packetId: packet.packetId,
    resourceKey: packet.resourceKey,
    sourceId: packet.source.sourceId,
    estimatedTokens: packet.budget.estimatedTokens,
  };
}

function dropReceipt(
  reason: RetrievalEvidenceDropReceipt["reason"],
  packet: RetrievalEvidencePacket
): RetrievalEvidenceDropReceipt {
  return {
    reason,
    packetId: packet.packetId,
    resourceKey: packet.resourceKey,
    sourceId: packet.source.sourceId,
    estimatedTokens: packet.budget.estimatedTokens,
  };
}

function defaultEstimate(_hit: RetrievalHit): RetrievalEvidenceBudget {
  return { estimatedTokens: 1, estimateQuality: "fallback" };
}

function validateEvidenceRequest(request: RetrievalEvidenceRequest): void {
  if (!Number.isInteger(request.maxPackets) || request.maxPackets < 1) {
    throw new TypeError("Retrieval evidence maxPackets must be a positive integer");
  }
  if (
    request.maxTokens !== undefined &&
    (!Number.isInteger(request.maxTokens) || request.maxTokens < 1)
  ) {
    throw new TypeError("Retrieval evidence maxTokens must be a positive integer");
  }
  if (
    request.candidateLimit !== undefined &&
    (!Number.isInteger(request.candidateLimit) || request.candidateLimit < 1)
  ) {
    throw new TypeError("Retrieval evidence candidateLimit must be a positive integer");
  }
}
