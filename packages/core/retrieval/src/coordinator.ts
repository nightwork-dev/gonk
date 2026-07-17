import { captureAuthContext, type AuthenticatedPrincipal } from "@gonk/auth";

import {
  authorityMatches,
  authorizeRetrieval,
  resourceBelongsToSource,
  sourceAuthzResource,
} from "./authorization.ts";
import {
  canonicalAuthorityPartition,
  canonicalResourceKey,
  stableHash,
  stableJson,
} from "./identity.ts";
import { RetrievalSourceRegistry } from "./registry.ts";
import {
  isRetrievalDocumentValue,
  isRetrievalResourceRefValue,
  retrievalDocumentSchema,
  retrievalIndexRequestSchema,
  retrievalIndexResultSchema,
} from "./schemas.ts";
import type {
  CoordinatedRetrievalSource,
  RetrievalClock,
  RetrievalDocument,
  RetrievalGenerationStorage,
  RetrievalIndexReceipt,
  RetrievalIndexRequest,
  RetrievalIndexResult,
  RetrievalResourceRef,
} from "./types.ts";
import { validateStandard } from "./validation.ts";

interface StoredGeneration {
  version: 1;
  sourceId: string;
  partition: string;
  generationId: string;
  documents: readonly RetrievalDocument[];
  tombstones: readonly RetrievalResourceRef[];
}

interface GenerationPointer {
  version: 1;
  generationId: string;
}

export class RetrievalIndexCoordinator {
  constructor(
    private readonly options: {
      registry: RetrievalSourceRegistry;
      storage: RetrievalGenerationStorage;
      clock?: RetrievalClock;
    }
  ) {}

  async index(request: RetrievalIndexRequest): Promise<RetrievalIndexResult> {
    const valid = await validateStandard(
      retrievalIndexRequestSchema,
      request,
      "RetrievalIndexRequest"
    );
    const auth = captureAuthContext(valid.auth);
    const source = this.options.registry.getRegistered(valid.sourceId);
    const timestamp = this.now();
    if (!source || !isCoordinatedSource(source)) {
      return this.validResult(failedResult(valid.requestId, valid.sourceId, timestamp, "source"));
    }
    const discoverable = await this.options.registry.canDiscover(source, auth);
    const allowed =
      discoverable &&
      (await authorizeRetrieval(
        auth,
        "retrieval.index.manage",
        sourceAuthzResource(source.description, auth.principal)
      ));
    if (!allowed) {
      return this.validResult(
        failedResult(valid.requestId, valid.sourceId, timestamp, "authorization", "denied")
      );
    }

    const partition = canonicalAuthorityPartition(auth.principal);
    const previous = this.readCurrent(source.description.id, auth.principal);
    let documents: RetrievalDocument[];
    try {
      documents = await this.scanDocuments(
        source,
        valid.requestId,
        auth.principal,
        auth
      );
    } catch (error) {
      const failure = error instanceof InvalidDocumentError ? "invalid-document" : "source";
      return this.validResult(
        failedResult(valid.requestId, valid.sourceId, timestamp, failure)
      );
    }

    const currentKeys = new Set(documents.map(({ resource }) => canonicalResourceKey(resource)));
    const tombstones = (previous?.documents ?? [])
      .filter(({ resource }) => !currentKeys.has(canonicalResourceKey(resource)))
      .map(({ resource }) => resource)
      .sort(compareResourceRefs);
    const generationCore = {
      version: 1 as const,
      sourceId: source.description.id,
      partition,
      documents,
      tombstones,
    };
    const generationId = stableHash("retrieval-generation", generationCore);
    const generation: StoredGeneration = { ...generationCore, generationId };

    try {
      const generationKey = generationStorageKey(partition, source.description.id, generationId);
      this.options.storage.generations.set(generationKey, structuredClone(generation));
      const verified = this.options.storage.generations.get(generationKey);
      if (stableJson(verified) !== stableJson(generation)) {
        throw new Error("generation verification failed");
      }
      this.options.storage.pointers.set(pointerStorageKey(partition, source.description.id), {
        version: 1,
        generationId,
      } satisfies GenerationPointer);
    } catch {
      return this.validResult(
        failedResult(valid.requestId, valid.sourceId, timestamp, "publication")
      );
    }

    const receipt: RetrievalIndexReceipt & { outcome: "published" } = {
      kind: "retrieval-index",
      receiptVersion: 1,
      requestId: valid.requestId,
      timestamp,
      sourceId: source.description.id,
      outcome: "published",
      generationId,
      documentCount: documents.length,
      tombstoneCount: tombstones.length,
    };
    return this.validResult({
      status: "published",
      sourceId: source.description.id,
      generationId,
      receipt,
    });
  }

  readCurrent(
    sourceId: string,
    principal: AuthenticatedPrincipal
  ): StoredGeneration | undefined {
    const partition = canonicalAuthorityPartition(principal);
    const pointer = this.options.storage.pointers.get(
      pointerStorageKey(partition, sourceId)
    );
    if (!isGenerationPointer(pointer)) return undefined;
    const generation = this.options.storage.generations.get(
      generationStorageKey(partition, sourceId, pointer.generationId)
    );
    return isStoredGeneration(generation, sourceId, partition, pointer.generationId)
      ? structuredClone(generation)
      : undefined;
  }

  private async scanDocuments(
    source: CoordinatedRetrievalSource<unknown>,
    requestId: string,
    principal: AuthenticatedPrincipal,
    auth: import("@gonk/auth").AuthContext
  ): Promise<RetrievalDocument[]> {
    const documents: RetrievalDocument[] = [];
    const seen = new Set<string>();
    const scan = source.scan(
      {
        requestId,
        principal,
        sourceId: source.description.id,
        ...(principal.tenantId === undefined ? {} : { tenantId: principal.tenantId }),
        ...(principal.workspaceId === undefined
          ? {}
          : { workspaceId: principal.workspaceId }),
      },
      auth
    );
    for await (const candidate of scan) {
      let document: RetrievalDocument;
      try {
        document = await validateStandard(
          retrievalDocumentSchema,
          candidate,
          "RetrievalDocument"
        );
      } catch {
        throw new InvalidDocumentError();
      }
      if (
        !resourceBelongsToSource(document.resource, source.description) ||
        !authorityMatches(principal, document)
      ) {
        throw new InvalidDocumentError();
      }
      const normalized = normalizeDocument(document);
      const key = canonicalResourceKey(normalized.resource);
      if (seen.has(key)) throw new InvalidDocumentError();
      seen.add(key);
      documents.push(normalized);
    }
    return documents.sort((left, right) =>
      compareOpaque(canonicalResourceKey(left.resource), canonicalResourceKey(right.resource))
    );
  }

  private now(): string {
    return this.options.clock?.now() ?? new Date().toISOString();
  }

  private async validResult(result: RetrievalIndexResult): Promise<RetrievalIndexResult> {
    return validateStandard(retrievalIndexResultSchema, result, "RetrievalIndexResult");
  }
}

function normalizeDocument(document: RetrievalDocument): RetrievalDocument {
  return {
    resource: structuredClone(document.resource),
    searchText: document.searchText,
    contentHash: document.contentHash,
    audience: document.audience,
    ...(document.tenantId === undefined ? {} : { tenantId: document.tenantId }),
    ...(document.workspaceId === undefined
      ? {}
      : { workspaceId: document.workspaceId }),
    ...(document.facets === undefined
      ? {}
      : {
          facets: [...document.facets]
            .map((facet) => ({ ...facet }))
            .sort((left, right) =>
              compareOpaque(
                stableJson([left.name, left.value]),
                stableJson([right.name, right.value])
              )
            ),
        }),
  };
}

function failedResult(
  requestId: string,
  sourceId: string,
  timestamp: string,
  failure: NonNullable<RetrievalIndexReceipt["failure"]>,
  outcome: "failed" | "denied" = "failed"
): RetrievalIndexResult {
  return {
    status: "failed",
    sourceId,
    receipt: {
      kind: "retrieval-index",
      receiptVersion: 1,
      requestId,
      timestamp,
      sourceId,
      outcome,
      documentCount: 0,
      tombstoneCount: 0,
      failure,
    },
  };
}

function pointerStorageKey(partition: string, sourceId: string): string {
  return `pointer/${partition}/${stableHash("retrieval-source", sourceId)}`;
}

function generationStorageKey(
  partition: string,
  sourceId: string,
  generationId: string
): string {
  return `generation/${partition}/${stableHash("retrieval-source", sourceId)}/${generationId}`;
}

function isGenerationPointer(value: unknown): value is GenerationPointer {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => key === "version" || key === "generationId") &&
    value.version === 1 &&
    typeof value.generationId === "string" &&
    value.generationId.length > 0
  );
}

function isStoredGeneration(
  value: unknown,
  sourceId: string,
  partition: string,
  generationId: string
): value is StoredGeneration {
  if (
    !(
    isRecord(value) &&
    Object.keys(value).every((key) =>
      ["version", "sourceId", "partition", "generationId", "documents", "tombstones"].includes(key)
    ) &&
    value.version === 1 &&
    value.sourceId === sourceId &&
    value.partition === partition &&
    value.generationId === generationId &&
    Array.isArray(value.documents) &&
    value.documents.every(isRetrievalDocumentValue) &&
    Array.isArray(value.tombstones) &&
    value.tombstones.every(isRetrievalResourceRefValue)
    )
  ) {
    return false;
  }
  const generationCore = {
    version: value.version,
    sourceId: value.sourceId,
    partition: value.partition,
    documents: value.documents,
    tombstones: value.tombstones,
  };
  return stableHash("retrieval-generation", generationCore) === generationId;
}

function compareResourceRefs(
  left: RetrievalResourceRef,
  right: RetrievalResourceRef
): number {
  return compareOpaque(canonicalResourceKey(left), canonicalResourceKey(right));
}

function compareOpaque(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

class InvalidDocumentError extends Error {}

function isCoordinatedSource(
  source: import("./types.ts").RetrievalSource
): source is CoordinatedRetrievalSource<unknown> {
  return source.description.mode === "coordinated-index";
}
