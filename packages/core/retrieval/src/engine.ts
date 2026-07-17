import { captureAuthContext, type AuthContext } from "@gonk/auth";

import {
  authorityMatches,
  authorizeRetrieval,
  resolvedAuthorityMatches,
  resourceBelongsToSource,
  retrievalAuthzResource,
} from "./authorization.ts";
import { RetrievalIndexCoordinator } from "./coordinator.ts";
import {
  canonicalAuthorityPartition,
  canonicalResourceKey,
  stableHash,
} from "./identity.ts";
import {
  compareRetrievalHits,
  rankAuthorizedDocuments,
} from "./ranking.ts";
import { RetrievalSourceRegistry } from "./registry.ts";
import {
  nativeRetrievalCandidateSchema,
  retrievalCitationCreateRequestSchema,
  retrievalCitationCreateResultSchema,
  retrievalCitationResolutionSchema,
  retrievalCitationResolveRequestSchema,
  retrievalResolveRequestSchema,
  retrievalResolveResultSchema,
  retrievalSearchRequestSchema,
  retrievalSearchResultSchema,
  isRetrievalResourceRefValue,
  sourceResolutionResultSchema,
} from "./schemas.ts";
import type {
  NativeRetrievalCandidate,
  NativeRetrievalSource,
  ResolvedRetrievalContent,
  RetrievalCitationCreateRequest,
  RetrievalCitationCreateResult,
  RetrievalCitationHandle,
  RetrievalCitationResolution,
  RetrievalCitationResolveRequest,
  RetrievalClock,
  RetrievalDocument,
  RetrievalGenerationStorage,
  RetrievalHit,
  RetrievalReceiptDrop,
  RetrievalReceiptSource,
  RetrievalResolveReceipt,
  RetrievalResolveRequest,
  RetrievalResolveResult,
  RetrievalResourceRef,
  RetrievalSearchRequest,
  RetrievalSearchResult,
  RetrievalSource,
  RetrievalSourceFilter,
  SourceResolutionResult,
} from "./types.ts";
import { validateStandard } from "./validation.ts";

interface CitationRecord {
  version: 1;
  authorityPartition: string;
  citation: RetrievalCitationHandle;
  originalAudience: ResolvedRetrievalContent["audience"];
  label: string;
  sourceLabel: string;
  excerpt?: string;
  excerptHash?: string;
}

export class RetrievalEngine {
  constructor(
    private readonly options: {
      registry: RetrievalSourceRegistry;
      coordinator: RetrievalIndexCoordinator;
      storage: RetrievalGenerationStorage;
      clock?: RetrievalClock;
    }
  ) {}

  async search(request: RetrievalSearchRequest): Promise<RetrievalSearchResult> {
    const valid = await validateStandard(
      retrievalSearchRequestSchema,
      request,
      "RetrievalSearchRequest"
    );
    const auth = captureAuthContext(valid.auth);
    const selected = new Set(valid.sourceIds ?? this.options.registry.registered().map(
      ({ description }) => description.id
    ));
    const filters = new Map(
      (valid.filters ?? []).map((filter) => [filter.sourceId, filter] as const)
    );
    const hits: RetrievalHit[] = [];
    const receiptSources: RetrievalReceiptSource[] = [];
    const drops = new Map<RetrievalReceiptDrop["reason"], number>();

    for (const source of this.options.registry.registered()) {
      if (!selected.has(source.description.id)) continue;
      if (!(await this.options.registry.canDiscover(source, auth))) continue;
      let filter: unknown;
      try {
        filter = await this.validateFilter(source, filters.get(source.description.id));
      } catch {
        throw new TypeError(`Invalid retrieval filter for ${source.description.id}`);
      }
      if (isCoordinatedSource(source)) {
        const generation = this.options.coordinator.readCurrent(
          source.description.id,
          auth.principal
        );
        receiptSources.push({
          sourceId: source.description.id,
          mode: "coordinated-index",
          ...(generation === undefined ? {} : { generationId: generation.generationId }),
        });
        if (!generation) continue;
        let filtered: readonly RetrievalDocument[];
        try {
          filtered =
            filter === undefined
              ? generation.documents
              : generation.documents.filter((document) =>
                  source.matchesFilter(document, filter)
                );
        } catch {
          increment(drops, "source-failed");
          continue;
        }
        const authorized: RetrievalDocument[] = [];
        for (const document of filtered) {
          if (!authorityMatches(auth.principal, document)) {
            continue;
          }
          if (
            await authorizeRetrieval(
              auth,
              "retrieval.hit.read",
              retrievalAuthzResource(document)
            )
          ) {
            authorized.push(document);
          }
        }
        hits.push(
          ...rankAuthorizedDocuments(
            source.description,
            generation.generationId,
            authorized,
            valid.text
          )
        );
      } else if (isNativeSource(source)) {
        receiptSources.push({ sourceId: source.description.id, mode: "native-index" });
        await this.searchNative(source, filter, valid, auth, hits, drops);
      }
    }

    hits.sort(compareRetrievalHits);
    const visible = hits.slice(0, valid.limit);
    const result: RetrievalSearchResult = {
      hits: visible,
      receipt: {
        kind: "retrieval-search",
        receiptVersion: 1,
        requestId: valid.requestId,
        timestamp: this.now(),
        mode: "lexical",
        purpose: valid.purpose,
        outcome: "success",
        sources: receiptSources,
        visibleHits: visible.map((hit) => ({
          resourceKey: canonicalResourceKey(hit.resource),
          sourceId: hit.resource.sourceId,
          scores: hit.scores,
        })),
        drops: [...drops.entries()]
          .sort(([left], [right]) => compareOpaque(left, right))
          .map(([reason, count]) => ({ reason, count })),
      },
    };
    return validateStandard(
      retrievalSearchResultSchema,
      result,
      "RetrievalSearchResult"
    );
  }

  async resolve(request: RetrievalResolveRequest): Promise<RetrievalResolveResult> {
    const valid = await validateStandard(
      retrievalResolveRequestSchema,
      request,
      "RetrievalResolveRequest"
    );
    const auth = captureAuthContext(valid.auth);
    const result = await this.resolveCaptured(valid.requestId, auth, valid.resource);
    return validateStandard(
      retrievalResolveResultSchema,
      result,
      "RetrievalResolveResult"
    );
  }

  async createCitation(
    request: RetrievalCitationCreateRequest
  ): Promise<RetrievalCitationCreateResult> {
    const valid = await validateStandard(
      retrievalCitationCreateRequestSchema,
      request,
      "RetrievalCitationCreateRequest"
    );
    const auth = captureAuthContext(valid.auth);
    const authorityPartition = canonicalAuthorityPartition(auth.principal);
    const resolution = await this.resolveCaptured(
      valid.requestId,
      auth,
      valid.resource
    );
    if (
      resolution.status !== "resolved" ||
      (valid.excerpt !== undefined && !resolution.value.content.includes(valid.excerpt))
    ) {
      return validateStandard(
        retrievalCitationCreateResultSchema,
        { status: "unavailable", resolution },
        "RetrievalCitationCreateResult"
      );
    }
    const source = this.options.registry.getRegistered(valid.resource.sourceId);
    if (!source) {
      return validateStandard(
        retrievalCitationCreateResultSchema,
        { status: "unavailable", resolution },
        "RetrievalCitationCreateResult"
      );
    }
    const excerptHash =
      valid.excerpt === undefined
        ? undefined
        : stableHash("retrieval-excerpt", valid.excerpt);
    const citation: RetrievalCitationHandle = {
      id: stableHash("retrieval-citation", {
        authorityPartition,
        resource: canonicalResourceKey(valid.resource),
        excerptHash: excerptHash ?? null,
      }),
      resource: structuredClone(valid.resource),
    };
    const record: CitationRecord = {
      version: 1,
      authorityPartition,
      citation,
      originalAudience: resolution.value.audience,
      label: resolution.value.label,
      sourceLabel: source.description.label,
      ...(valid.excerpt === undefined ? {} : { excerpt: valid.excerpt }),
      ...(excerptHash === undefined ? {} : { excerptHash }),
    };
    this.options.storage.citations.set(citation.id, structuredClone(record));
    return validateStandard(
      retrievalCitationCreateResultSchema,
      { status: "created", citation, resolution },
      "RetrievalCitationCreateResult"
    );
  }

  async resolveCitation(
    request: RetrievalCitationResolveRequest
  ): Promise<RetrievalCitationResolution> {
    const valid = await validateStandard(
      retrievalCitationResolveRequestSchema,
      request,
      "RetrievalCitationResolveRequest"
    );
    const auth = captureAuthContext(valid.auth);
    const stored = this.options.storage.citations.get(valid.citationId);
    if (
      !isCitationRecord(stored) ||
      stored.authorityPartition !== canonicalAuthorityPartition(auth.principal)
    ) {
      return validateStandard(
        retrievalCitationResolutionSchema,
        { status: "not-found", citationId: valid.citationId },
        "RetrievalCitationResolution"
      );
    }
    const resolution = await this.resolveCaptured(
      valid.requestId,
      auth,
      stored.citation.resource
    );
    let result: RetrievalCitationResolution;
    if (resolution.status === "resolved") {
      const excerptStillValid =
        stored.excerpt === undefined ||
        (resolution.value.content.includes(stored.excerpt) &&
          stableHash("retrieval-excerpt", stored.excerpt) === stored.excerptHash);
      result = excerptStillValid
        ? {
            status: "resolved",
            citation: stored.citation,
            label: stored.label,
            sourceLabel: stored.sourceLabel,
            ...(stored.excerpt === undefined ? {} : { excerpt: stored.excerpt }),
            ...(stored.excerptHash === undefined
              ? {}
              : { excerptHash: stored.excerptHash }),
            resolvedAt: this.now(),
          }
        : { status: "changed", citation: stored.citation };
    } else {
      result = {
        status: resolution.status,
        citation: stored.citation,
      };
    }
    return validateStandard(
      retrievalCitationResolutionSchema,
      result,
      "RetrievalCitationResolution"
    );
  }

  private async searchNative(
    source: NativeRetrievalSource<unknown>,
    filter: unknown,
    request: RetrievalSearchRequest,
    auth: AuthContext,
    hits: RetrievalHit[],
    drops: Map<RetrievalReceiptDrop["reason"], number>
  ): Promise<void> {
    let candidates: readonly NativeRetrievalCandidate[];
    try {
      candidates = await source.search(
        {
          requestId: request.requestId,
          principal: auth.principal,
          text: request.text,
          ...(filter === undefined ? {} : { filter }),
          limit: Math.max(request.limit, 1000),
          purpose: request.purpose,
        },
        auth
      );
    } catch {
      increment(drops, "source-failed");
      return;
    }
    if (!Array.isArray(candidates)) {
      increment(drops, "source-failed");
      return;
    }
    for (const candidate of candidates) {
      let validCandidate: NativeRetrievalCandidate;
      try {
        validCandidate = await validateStandard(
          nativeRetrievalCandidateSchema,
          candidate,
          "NativeRetrievalCandidate"
        );
      } catch {
        continue;
      }
      if (
        !resourceBelongsToSource(validCandidate.resource, source.description) ||
        !authorityMatches(auth.principal, validCandidate)
      ) {
        continue;
      }
      if (
        !(await authorizeRetrieval(
          auth,
          "retrieval.hit.read",
          retrievalAuthzResource(validCandidate)
        ))
      ) {
        continue;
      }
      hits.push({
        resource: structuredClone(validCandidate.resource),
        audience: validCandidate.audience,
        scores: {
          lexical: {
            algorithm: "native",
            sourceId: source.description.id,
            value: validCandidate.lexicalScore,
          },
          sourcePriority: source.description.priority,
          final: validCandidate.lexicalScore + source.description.priority,
        },
        matchedTerms: [...validCandidate.matchedTerms],
      });
    }
  }

  private async validateFilter(
    source: RetrievalSource,
    envelope: RetrievalSourceFilter | undefined
  ): Promise<unknown> {
    if (envelope === undefined) return undefined;
    const definition = source.description.filter;
    if (
      envelope.sourceId !== source.description.id ||
      envelope.schemaId !== definition.schemaId ||
      envelope.schemaVersion !== definition.schemaVersion
    ) {
      throw new TypeError("Retrieval filter schema identity mismatch");
    }
    return validateStandard(
      source.filterSchema,
      envelope.value,
      `filter ${definition.schemaId}@${definition.schemaVersion}`
    );
  }

  private async resolveCaptured(
    requestId: string,
    auth: AuthContext,
    resource: RetrievalResourceRef
  ): Promise<RetrievalResolveResult> {
    const source = this.options.registry.getRegistered(resource.sourceId);
    if (!source) return this.unavailable(requestId, resource, "revision-unavailable");
    if (!(await this.options.registry.canDiscover(source, auth))) {
      return this.unavailable(requestId, resource, "unauthorized");
    }
    if (!resourceBelongsToSource(resource, source.description)) {
      return this.unavailable(requestId, resource, "revision-unavailable");
    }
    let sourceResult: SourceResolutionResult;
    try {
      sourceResult = await validateStandard(
        sourceResolutionResultSchema,
        await source.resolve(resource, auth),
        "SourceResolutionResult"
      );
    } catch {
      return this.unavailable(requestId, resource, "revision-unavailable");
    }
    if (sourceResult.status === "resolved") {
      if (
        canonicalResourceKey(sourceResult.value.resource) !== canonicalResourceKey(resource) ||
        !resourceBelongsToSource(sourceResult.value.resource, source.description) ||
        !resolvedAuthorityMatches(auth.principal, sourceResult.value) ||
        !(await this.authorizeContent(auth, sourceResult.value))
      ) {
        return this.unavailable(requestId, resource, "unauthorized");
      }
      return {
        status: "resolved",
        value: structuredClone(sourceResult.value),
        receipt: this.resolveReceipt(requestId, resource, "resolved"),
      };
    }
    if (sourceResult.status === "changed") {
      if (
        canonicalResourceKey(sourceResult.requested) !== canonicalResourceKey(resource) ||
        !resourceBelongsToSource(sourceResult.current, source.description)
      ) {
        return this.unavailable(requestId, resource, "revision-unavailable");
      }
      let current: SourceResolutionResult;
      try {
        current = await validateStandard(
          sourceResolutionResultSchema,
          await source.resolve(sourceResult.current, auth),
          "SourceResolutionResult"
        );
      } catch {
        return this.unavailable(requestId, resource, "revision-unavailable");
      }
      if (
        current.status !== "resolved" ||
        canonicalResourceKey(current.value.resource) !==
          canonicalResourceKey(sourceResult.current) ||
        !resolvedAuthorityMatches(auth.principal, current.value) ||
        !(await this.authorizeContent(auth, current.value))
      ) {
        return this.unavailable(requestId, resource, "unauthorized");
      }
      return {
        status: "changed",
        requested: structuredClone(resource),
        current: structuredClone(sourceResult.current),
        receipt: this.resolveReceipt(requestId, resource, "changed"),
      };
    }
    if (
      canonicalResourceKey(sourceResult.resource) !== canonicalResourceKey(resource)
    ) {
      return this.unavailable(requestId, resource, "revision-unavailable");
    }
    return this.unavailable(requestId, resource, sourceResult.status);
  }

  private async authorizeContent(
    auth: AuthContext,
    value: ResolvedRetrievalContent
  ): Promise<boolean> {
    return authorizeRetrieval(
      auth,
      "retrieval.content.resolve",
      retrievalAuthzResource(value)
    );
  }

  private unavailable(
    requestId: string,
    resource: RetrievalResourceRef,
    status: "revision-unavailable" | "deleted" | "unauthorized"
  ): RetrievalResolveResult {
    return {
      status,
      resource: structuredClone(resource),
      receipt: this.resolveReceipt(requestId, resource, status),
    };
  }

  private resolveReceipt<Outcome extends RetrievalResolveReceipt["outcome"]>(
    requestId: string,
    resource: RetrievalResourceRef,
    outcome: Outcome
  ): RetrievalResolveReceipt & { outcome: Outcome } {
    return {
      kind: "retrieval-resolve",
      receiptVersion: 1,
      requestId,
      timestamp: this.now(),
      resourceKey: canonicalResourceKey(resource),
      outcome,
    };
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }
}

function isCitationRecord(value: unknown): value is CitationRecord {
  return (
    isRecord(value) &&
    exact(value, [
      "version",
      "authorityPartition",
      "citation",
      "originalAudience",
      "label",
      "sourceLabel",
      "excerpt",
      "excerptHash",
    ]) &&
    value.version === 1 &&
    isNonEmptyString(value.authorityPartition) &&
    isRecord(value.citation) &&
    exact(value.citation, ["id", "resource"]) &&
    isNonEmptyString(value.citation.id) &&
    isRetrievalResourceRefValue(value.citation.resource) &&
    isAudience(value.originalAudience) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.sourceLabel) &&
    (value.excerpt === undefined || typeof value.excerpt === "string") &&
    (value.excerptHash === undefined || isNonEmptyString(value.excerptHash))
  );
}

function isAudience(value: unknown): value is ResolvedRetrievalContent["audience"] {
  return (
    value === "public" ||
    value === "tenant" ||
    value === "workspace" ||
    value === "restricted"
  );
}

function increment(
  map: Map<RetrievalReceiptDrop["reason"], number>,
  key: RetrievalReceiptDrop["reason"]
): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function exact(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareOpaque(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isCoordinatedSource(
  source: RetrievalSource
): source is import("./types.ts").CoordinatedRetrievalSource<unknown> {
  return source.description.mode === "coordinated-index";
}

function isNativeSource(
  source: RetrievalSource
): source is NativeRetrievalSource<unknown> {
  return source.description.mode === "native-index";
}
