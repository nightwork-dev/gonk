import type {
  ToolArtifactReference,
  ToolResultMetadata,
  ToolResultProvenance,
  ToolResultSize,
  ToolResultTruncation,
} from "./types.ts";

/** Metadata that is safe to put in a receipt or audit projection.
 *
 * Payloads, display blocks, cache keys/validators, continuation cursors, and
 * authorization bindings are intentionally absent. Hosts can keep those values
 * in their private execution state while still making the result legible. */
export interface ToolResultReceiptProjection {
  provenance?: ToolResultProvenance;
  size?: ToolResultSize;
  truncation?: Omit<ToolResultTruncation, "continuation"> & {
    artifact?: ToolArtifactReference;
  };
  freshness?: ToolResultMetadata["freshness"];
  cache?: {
    policy: NonNullable<ToolResultMetadata["cache"]>["policy"];
    guidance?: string;
  };
}

/** Project only non-secret result metadata for receipts and telemetry. */
export function projectToolResultReceipt(
  metadata: ToolResultMetadata | undefined,
): ToolResultReceiptProjection | undefined {
  if (metadata === undefined) return undefined;

  const projection: ToolResultReceiptProjection = {};
  if (metadata.provenance !== undefined) {
    projection.provenance = {
      sourceKind: metadata.provenance.sourceKind,
      sourceId: metadata.provenance.sourceId,
      ...(metadata.provenance.sourceRevision === undefined
        ? {}
        : { sourceRevision: metadata.provenance.sourceRevision }),
      ...(metadata.provenance.sourceVersion === undefined
        ? {}
        : { sourceVersion: metadata.provenance.sourceVersion }),
      ...(metadata.provenance.evidenceAnchors === undefined
        ? {}
        : { evidenceAnchors: [...metadata.provenance.evidenceAnchors] }),
    };
  }
  if (metadata.freshness !== undefined) {
    projection.freshness = { ...metadata.freshness };
  }
  if (metadata.size !== undefined) projection.size = { ...metadata.size };
  if (metadata.cache !== undefined) {
    projection.cache = {
      policy: metadata.cache.policy,
      ...(metadata.cache.guidance === undefined
        ? {}
        : { guidance: metadata.cache.guidance }),
    };
  }
  if (metadata.truncation !== undefined) {
    const truncation = metadata.truncation;
    projection.truncation = {
      truncated: truncation.truncated,
      ...(truncation.limit === undefined ? {} : { limit: truncation.limit }),
      ...(truncation.unit === undefined ? {} : { unit: truncation.unit }),
      ...(truncation.reason === undefined ? {} : { reason: truncation.reason }),
      ...("artifact" in truncation && truncation.artifact !== undefined
        ? { artifact: { ...truncation.artifact } }
        : {}),
    };
  }

  return Object.keys(projection).length > 0 ? projection : undefined;
}
