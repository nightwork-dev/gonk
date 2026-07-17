import type {
  RetrievalDocument,
  RetrievalIndexResult,
  RetrievalResolveResult,
  RetrievalSearchResult,
} from "./types.ts";

export const retrievalConformanceDocuments = Object.freeze({
  alpha: document("alpha", "r1", "alpha lantern common"),
  beta: document("beta", "r1", "beta lantern common"),
  hidden: document("hidden", "r1", "lantern lantern lantern secret"),
});

export interface RetrievalConformanceHarness {
  replaceDocuments(documents: readonly RetrievalDocument[]): void;
  denyHit(id: string, denied: boolean): void;
  denyContent(id: string, denied: boolean): void;
  index(requestId: string): Promise<RetrievalIndexResult>;
  search(requestId: string, text: string): Promise<RetrievalSearchResult>;
  resolve(requestId: string, id: string, revision: string): Promise<RetrievalResolveResult>;
}

export interface RetrievalConformanceCase {
  name: string;
  run(harness: RetrievalConformanceHarness): Promise<void>;
}

export interface NativeAuthorizedRankingConformanceHarness {
  replaceDocuments(documents: readonly RetrievalDocument[]): void;
  denyHit(id: string, denied: boolean): void;
  search(requestId: string, text: string): Promise<RetrievalSearchResult>;
}

export interface NativeAuthorizedRankingConformanceCase {
  name: string;
  run(harness: NativeAuthorizedRankingConformanceHarness): Promise<void>;
}

/**
 * Native-index sources own their ranking corpus. Core cannot reconstruct it, so
 * adapters claiming `source-enforced-authorized-corpus` must pass this suite.
 */
export function nativeAuthorizedRankingConformanceCases(): readonly NativeAuthorizedRankingConformanceCase[] {
  return [
    {
      name: "native ranking excludes denied documents before score calculation",
      async run(harness) {
        harness.denyHit("hidden", true);
        harness.replaceDocuments([
          retrievalConformanceDocuments.alpha,
          retrievalConformanceDocuments.beta,
        ]);
        const baseline = await harness.search("native-score-isolation", "lantern");
        harness.replaceDocuments([
          retrievalConformanceDocuments.alpha,
          retrievalConformanceDocuments.beta,
          retrievalConformanceDocuments.hidden,
        ]);
        const withHidden = await harness.search(
          "native-score-isolation",
          "lantern"
        );
        assert(
          JSON.stringify(projectHits(baseline)) === JSON.stringify(projectHits(withHidden)),
          "native source ranked over a denied document"
        );
        assert(
          JSON.stringify(baseline.receipt.drops) ===
            JSON.stringify(withHidden.receipt.drops),
          "native denied document changed caller-visible counts"
        );
      },
    },
  ];
}

export function retrievalConformanceCases(): readonly RetrievalConformanceCase[] {
  return [
    {
      name: "search hits are metadata-only until final resolution",
      async run(harness) {
        harness.replaceDocuments([retrievalConformanceDocuments.alpha]);
        await requirePublished(harness.index("index-metadata"));
        const search = await harness.search("search-metadata", "lantern");
        assert(search.hits.length === 1, "expected one metadata hit");
        assert(!("content" in search.hits[0]!), "search hit exposed content");
        assert(!("excerpt" in search.hits[0]!), "search hit exposed excerpt");
        assert(!("label" in search.hits[0]!), "search hit exposed label");
      },
    },
    {
      name: "denied hits cannot change visible BM25 scores",
      async run(harness) {
        harness.denyHit("hidden", true);
        harness.replaceDocuments([
          retrievalConformanceDocuments.alpha,
          retrievalConformanceDocuments.beta,
        ]);
        await requirePublished(harness.index("index-baseline"));
        const baseline = await harness.search("search-isolation", "lantern");
        harness.replaceDocuments([
          retrievalConformanceDocuments.alpha,
          retrievalConformanceDocuments.beta,
          retrievalConformanceDocuments.hidden,
        ]);
        await requirePublished(harness.index("index-hidden"));
        const withHidden = await harness.search("search-isolation", "lantern");
        assert(
          JSON.stringify(projectHits(baseline)) === JSON.stringify(projectHits(withHidden)),
          "denied hit changed visible score/order"
        );
        assert(
          baseline.hits.length === withHidden.hits.length &&
            JSON.stringify(baseline.receipt.drops) ===
              JSON.stringify(withHidden.receipt.drops),
          "denied hit changed caller-visible counts"
        );
      },
    },
    {
      name: "tombstones remove absent resources from the published generation",
      async run(harness) {
        harness.replaceDocuments([
          retrievalConformanceDocuments.alpha,
          retrievalConformanceDocuments.beta,
        ]);
        await requirePublished(harness.index("index-before-delete"));
        harness.replaceDocuments([retrievalConformanceDocuments.alpha]);
        const published = await requirePublished(harness.index("index-after-delete"));
        assert(published.receipt.tombstoneCount === 1, "expected one tombstone");
        const result = await harness.search("search-after-delete", "lantern");
        assert(
          result.hits.every(({ resource }) => resource.id !== "beta"),
          "tombstoned resource remained searchable"
        );
      },
    },
    {
      name: "content denial at the final gate returns no body",
      async run(harness) {
        harness.replaceDocuments([retrievalConformanceDocuments.alpha]);
        await requirePublished(harness.index("index-final-gate"));
        harness.denyContent("alpha", true);
        const result = await harness.resolve("resolve-denied", "alpha", "r1");
        assert(result.status === "unauthorized", "final gate did not deny resolution");
        assert(!JSON.stringify(result).includes("alpha lantern"), "denied body leaked");
      },
    },
  ];
}

function document(id: string, revision: string, searchText: string): RetrievalDocument {
  return {
    resource: {
      sourceId: "conformance",
      kind: "document",
      id,
      revision,
      fragment: { kind: "record", id },
    },
    searchText,
    contentHash: `hash-${id}-${revision}`,
    audience: "workspace",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  };
}

async function requirePublished(
  promise: Promise<RetrievalIndexResult>
): Promise<Extract<RetrievalIndexResult, { status: "published" }>> {
  const result = await promise;
  assert(result.status === "published", "expected generation publication");
  return result;
}

function projectHits(result: RetrievalSearchResult): unknown {
  return result.hits.map(({ resource, scores, matchedTerms }) => ({
    id: resource.id,
    scores,
    matchedTerms,
  }));
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
