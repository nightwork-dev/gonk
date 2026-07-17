import type { AuthContext, AuthenticatedPrincipal, AuthorizationRequest } from "@gonk/auth";
import { BackedKvStore, type KvSetOptions, type KvStore } from "@gonk/store";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";

import {
  canonicalResourceKey,
  nativeRetrievalCandidateSchema,
  RetrievalEngine,
  RetrievalIndexCoordinator,
  RetrievalSourceRegistry,
  retrievalSearchRequestSchema,
  retrievalSearchResultSchema,
  retrievalSourceDescriptionSchema,
  type CoordinatedRetrievalSource,
  type NativeRetrievalCandidate,
  type NativeRetrievalSearchRequest,
  type NativeRetrievalSource,
  type RetrievalDocument,
  type RetrievalGenerationStorage,
  type RetrievalResourceRef,
  type RetrievalSourceDescription,
  type SourceResolutionResult,
} from "../src/index.ts";
import {
  nativeAuthorizedRankingConformanceCases,
  retrievalConformanceCases,
  type NativeAuthorizedRankingConformanceHarness,
  type RetrievalConformanceHarness,
} from "../src/conformance.ts";
import { MemoryStoreBackend } from "./memory-backend.ts";

const NOW = "2026-07-16T18:00:00.000Z";

describe("retrieval conformance", () => {
  for (const testCase of retrievalConformanceCases()) {
    it(testCase.name, async () => {
      const fixture = makeFixture("conformance");
      await testCase.run(conformanceHarness(fixture));
    });
  }

  for (const testCase of nativeAuthorizedRankingConformanceCases()) {
    it(testCase.name, async () => {
      await testCase.run(nativeConformanceHarness());
    });
  }
});

describe("authorization isolation", () => {
  it("keeps hidden sources out of results, receipts, scores, and counts", async () => {
    const fixture = makeFixture("visible");
    fixture.source.replace([document("visible", "alpha", "r1", "lantern common")]);
    const hidden = new TestCoordinatedSource("hidden", 1000);
    hidden.replace([document("hidden", "secret", "r1", "lantern lantern secret")]);
    fixture.registry.register(hidden);
    await fixture.coordinator.index(indexRequest("index-visible", fixture.auth, "visible"));
    fixture.policy.hiddenSources.add("hidden");
    const before = await fixture.engine.search(searchRequest("stable", fixture.auth, "lantern"));

    await fixture.coordinator.index(indexRequest("index-hidden", fixture.adminAuth, "hidden"));
    const after = await fixture.engine.search(searchRequest("stable", fixture.auth, "lantern"));
    expect(after).toEqual(before);
    expect(JSON.stringify(after)).not.toContain("hidden");
    expect(JSON.stringify(after)).not.toContain("secret");
  });

  it("never calls resolve or exposes labels/content during search", async () => {
    const fixture = makeFixture();
    fixture.source.replace([document("source", "alpha", "r1", "private lantern body")]);
    await fixture.coordinator.index(indexRequest("index", fixture.auth, "source"));
    const result = await fixture.engine.search(searchRequest("search", fixture.auth, "lantern"));
    expect(fixture.source.resolveCalls).toBe(0);
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]).not.toHaveProperty("label");
    expect(result.hits[0]).not.toHaveProperty("excerpt");
    expect(result.hits[0]).not.toHaveProperty("content");
  });

  it("redacts citation labels and excerpts after access is revoked", async () => {
    const fixture = makeFixture();
    const doc = document("source", "alpha", "r1", "private lantern body");
    fixture.source.replace([doc]);
    const created = await fixture.engine.createCitation({
      requestId: "citation-create",
      auth: fixture.auth,
      resource: doc.resource,
      excerpt: "lantern",
    });
    expect(created.status).toBe("created");
    const citationId = created.citation!.id;
    fixture.policy.deniedContent.add(canonicalResourceKey(doc.resource));
    const revoked = await fixture.engine.resolveCitation({
      requestId: "citation-resolve",
      auth: fixture.auth,
      citationId,
    });
    expect(revoked).toEqual({
      status: "unauthorized",
      citation: created.citation,
    });
    expect(JSON.stringify(revoked)).not.toContain("lantern");
    expect(JSON.stringify(revoked)).not.toContain("Label alpha");
  });

  it("does not resolve a citation across authority partitions", async () => {
    const fixture = makeFixture();
    const doc = document("source", "alpha", "r1", "tenant one lantern");
    fixture.source.replace([doc]);
    const created = await fixture.engine.createCitation({
      requestId: "citation-create",
      auth: fixture.auth,
      resource: doc.resource,
      excerpt: "lantern",
    });
    expect(created.status).toBe("created");
    const otherPrincipal: AuthenticatedPrincipal = {
      ...principal(),
      id: "principal-2",
      identity: { issuer: "test", subject: "user-2", method: "oauth" },
      tenantId: "tenant-2",
      workspaceId: "workspace-2",
    };
    const crossTenant = await fixture.engine.resolveCitation({
      requestId: "citation-cross-tenant",
      auth: auth(new Policy(), otherPrincipal),
      citationId: created.citation!.id,
    });
    expect(crossTenant).toEqual({
      status: "not-found",
      citationId: created.citation!.id,
    });
    expect(JSON.stringify(crossTenant)).not.toContain("tenant one");
    expect(JSON.stringify(crossTenant)).not.toContain("alpha");
  });
});

describe("generation publication", () => {
  it("rejects tenant broadening and preserves the old publication pointer", async () => {
    const fixture = makeFixture();
    fixture.source.replace([document("source", "alpha", "r1", "stable lantern")]);
    const first = await fixture.coordinator.index(indexRequest("first", fixture.auth, "source"));
    expect(first.status).toBe("published");
    fixture.source.replace([
      {
        ...document("source", "foreign", "r1", "foreign lantern"),
        tenantId: "tenant-2",
      },
    ]);
    const failed = await fixture.coordinator.index(indexRequest("foreign", fixture.auth, "source"));
    expect(failed.status).toBe("failed");
    expect(failed.receipt.failure).toBe("invalid-document");
    const search = await fixture.engine.search(searchRequest("after", fixture.auth, "lantern"));
    expect(search.hits.map(({ resource }) => resource.id)).toEqual(["alpha"]);
    expect(fixture.source.scanContexts.every(({ frozen }) => frozen)).toBe(true);
  });

  it("preserves the old pointer when the single publication write fails", async () => {
    const pointers = new FailingKvStore<unknown>(
      new BackedKvStore<unknown>(new MemoryStoreBackend()),
    );
    const fixture = makeFixture("source", pointers);
    fixture.source.replace([document("source", "alpha", "r1", "old lantern")]);
    expect((await fixture.coordinator.index(indexRequest("old", fixture.auth, "source"))).status)
      .toBe("published");
    pointers.failNextSet = true;
    fixture.source.replace([document("source", "beta", "r1", "new lantern")]);
    const failed = await fixture.coordinator.index(indexRequest("new", fixture.auth, "source"));
    expect(failed.status).toBe("failed");
    expect(failed.receipt.failure).toBe("publication");
    const search = await fixture.engine.search(searchRequest("after", fixture.auth, "lantern"));
    expect(search.hits.map(({ resource }) => resource.id)).toEqual(["alpha"]);
  });

  it("publishes byte-stable generations, hits, and receipts for identical input", async () => {
    const fixture = makeFixture();
    fixture.source.replace([
      document("source", "beta", "r1", "beta lantern"),
      document("source", "alpha", "r1", "alpha lantern"),
    ]);
    const first = await fixture.coordinator.index(indexRequest("same", fixture.auth, "source"));
    const searchA = await fixture.engine.search(searchRequest("same", fixture.auth, "lantern"));
    fixture.source.reverseScan = true;
    const second = await fixture.coordinator.index(indexRequest("same", fixture.auth, "source"));
    const searchB = await fixture.engine.search(searchRequest("same", fixture.auth, "lantern"));
    expect(second).toEqual(first);
    expect(JSON.stringify(searchB)).toBe(JSON.stringify(searchA));
  });

  it("refuses a stored generation whose content no longer matches its address", async () => {
    const fixture = makeFixture();
    fixture.source.replace([document("source", "alpha", "r1", "stable lantern")]);
    expect((await fixture.coordinator.index(indexRequest("index", fixture.auth, "source"))).status)
      .toBe("published");
    const [generationKey] = fixture.storage.generations.list("generation/");
    const stored = fixture.storage.generations.get(generationKey!) as {
      documents: Array<{ searchText: string }>;
    };
    stored.documents[0]!.searchText = "tampered lantern";
    fixture.storage.generations.set(generationKey!, stored);

    const result = await fixture.engine.search(
      searchRequest("search-corrupt", fixture.auth, "lantern")
    );
    expect(result.hits).toEqual([]);
    expect(result.receipt.sources[0]).not.toHaveProperty("generationId");
  });
});

describe("closed filters and ranking", () => {
  it("validates source-owned typed filters before corpus statistics", async () => {
    const fixture = makeFixture();
    fixture.source.replace([
      document("source", "keep", "r1", "lantern", "keep"),
      document("source", "drop", "r1", "lantern lantern lantern", "drop"),
    ]);
    await fixture.coordinator.index(indexRequest("index", fixture.auth, "source"));
    const filtered = await fixture.engine.search({
      ...searchRequest("filtered", fixture.auth, "lantern"),
      filters: [filter("source", { tag: "keep" })],
    });
    expect(filtered.hits.map(({ resource }) => resource.id)).toEqual(["keep"]);

    fixture.source.replace([document("source", "keep", "r1", "lantern", "keep")]);
    await fixture.coordinator.index(indexRequest("index-only", fixture.auth, "source"));
    const only = await fixture.engine.search({
      ...searchRequest("only", fixture.auth, "lantern"),
      filters: [filter("source", { tag: "keep" })],
    });
    expect(filtered.hits[0]?.scores).toEqual(only.hits[0]?.scores);

    await expect(
      fixture.engine.search({
        ...searchRequest("bad", fixture.auth, "lantern"),
        filters: [filter("source", { tag: "keep", extra: true })],
      })
    ).rejects.toThrow("Invalid retrieval filter");
    await expect(
      fixture.engine.search({
        ...searchRequest("wrong-schema", fixture.auth, "lantern"),
        filters: [{ ...filter("source", { tag: "keep" }), schemaId: "wrong" }],
      })
    ).rejects.toThrow("Invalid retrieval filter");
  });

  it("authorizes the coordinated corpus before invoking source filters", async () => {
    const fixture = makeFixture();
    const visible = document("source", "visible", "r1", "lantern", "keep");
    const denied = document("source", "denied", "r1", "lantern lantern", "keep");
    fixture.policy.deniedHits.add(canonicalResourceKey(denied.resource));
    fixture.source.throwFilterIds.add("denied");
    fixture.source.replace([visible]);
    await fixture.coordinator.index(indexRequest("baseline-index", fixture.auth, "source"));
    const baseline = await fixture.engine.search({
      ...searchRequest("stable-filter", fixture.auth, "lantern"),
      filters: [filter("source", { tag: "keep" })],
    });

    fixture.source.replace([visible, denied]);
    await fixture.coordinator.index(indexRequest("hidden-index", fixture.auth, "source"));
    const withDenied = await fixture.engine.search({
      ...searchRequest("stable-filter", fixture.auth, "lantern"),
      filters: [filter("source", { tag: "keep" })],
    });

    expect(normalizeGenerationIds(withDenied)).toEqual(
      normalizeGenerationIds(baseline)
    );
    expect(withDenied.receipt.drops).toEqual([]);
  });

  it("rejects filters for unregistered and unselected sources before search", async () => {
    const fixture = makeFixture();
    await expect(
      fixture.engine.search({
        ...searchRequest("typo", fixture.auth, "lantern"),
        filters: [filter("soruce", { tag: "keep" })],
      })
    ).rejects.toThrow("Unregistered retrieval filter source: soruce");

    const other = new TestCoordinatedSource("other");
    fixture.registry.register(other);
    await expect(
      fixture.engine.search({
        ...searchRequest("unselected", fixture.auth, "lantern"),
        sourceIds: ["source"],
        filters: [filter("other", { tag: "keep" })],
      })
    ).rejects.toThrow("Unselected retrieval filter source: other");
    expect(fixture.source.filterCalls).toBe(0);
    expect(other.filterCalls).toBe(0);
  });

  it("rejects unknown query fields and open query modes", () => {
    expect(valid(retrievalSearchRequestSchema, searchRequest("ok", auth(), "query"))).toBe(true);
    expect(
      valid(retrievalSearchRequestSchema, {
        ...searchRequest("bad", auth(), "query"),
        mode: "semantic",
      })
    ).toBe(false);
    expect(
      valid(retrievalSearchRequestSchema, {
        ...searchRequest("bad", auth(), "query"),
        arbitrary: true,
      })
    ).toBe(false);
  });

  it("requires the native authorized-corpus marker and rejects adapter terms", () => {
    const native = new TestNativeSource("native");
    expect(valid(retrievalSourceDescriptionSchema, native.description)).toBe(true);
    const { rankingContract: _rankingContract, ...unmarked } = native.description;
    expect(valid(retrievalSourceDescriptionSchema, unmarked)).toBe(false);
    expect(
      valid(nativeRetrievalCandidateSchema, {
        ...candidate(ref("native", "visible", "r1"), 1),
        matchedTerms: ["adapter-controlled"],
      })
    ).toBe(false);
  });

  it("rejects impossible receipt timestamps", async () => {
    const fixture = makeFixture();
    const result = await fixture.engine.search(
      searchRequest("timestamp", fixture.auth, "query")
    );
    expect(
      valid(retrievalSearchResultSchema, {
        ...result,
        receipt: { ...result.receipt, timestamp: "2026-02-31T18:00:00Z" },
      })
    ).toBe(false);
  });
});

describe("source registration", () => {
  it("snapshots the validated source description", async () => {
    const registry = new RetrievalSourceRegistry();
    const source = new TestCoordinatedSource("stable-source");
    registry.register(source);
    (source.description as { label: string }).label = "mutated";

    const listed = await registry.list({ requestId: "list", auth: auth() });
    expect(listed.sources[0]?.label).toBe("Source stable-source");
    expect(Object.isFrozen(listed.sources[0])).toBe(true);
  });
});

describe("source modes and revision capabilities", () => {
  it("supports independently authorized native-index search", async () => {
    const fixture = makeFixture();
    const native = new TestNativeSource("native");
    const visible = ref("native", "visible", "r1");
    const denied = ref("native", "denied", "r1");
    native.candidates = [candidate(visible, 5), candidate(denied, 100)];
    fixture.registry.register(native);
    fixture.policy.deniedHits.add(canonicalResourceKey(denied));
    const result = await fixture.engine.search({
      ...searchRequest("native", fixture.auth, "lantern"),
      sourceIds: ["native"],
    });
    expect(result.hits.map(({ resource }) => resource.id)).toEqual(["visible"]);
    expect(result.hits[0]?.scores.lexical.algorithm).toBe("native");
    expect(result.hits[0]?.matchedTerms).toEqual(["lantern"]);
    expect(result.receipt.drops).toEqual([]);
  });

  it("derives native matched terms from the normalized query", async () => {
    const fixture = makeFixture();
    const native = new TestNativeSource("native");
    native.candidates = [candidate(ref("native", "visible", "r1"), 5)];
    fixture.registry.register(native);

    const result = await fixture.engine.search({
      ...searchRequest("native-terms", fixture.auth, " LANTERN alpha lantern "),
      sourceIds: ["native"],
    });
    expect(result.hits[0]?.matchedTerms).toEqual(["alpha", "lantern"]);
  });

  it("distinguishes current-only change from historical resolution", async () => {
    const fixture = makeFixture();
    const current = document("source", "alpha", "r2", "current body");
    fixture.source.replace([current]);
    const old = ref("source", "alpha", "r1");
    const changed = await fixture.engine.resolve({
      requestId: "current-only",
      auth: fixture.auth,
      resource: old,
    });
    expect(changed.status).toBe("changed");

    const historical = new TestCoordinatedSource("history", 0, "historical");
    historical.replace([document("history", "alpha", "r2", "current body")]);
    historical.addHistorical(ref("history", "alpha", "r1"), "historical body");
    fixture.registry.register(historical);
    const resolved = await fixture.engine.resolve({
      requestId: "historical",
      auth: fixture.auth,
      resource: ref("history", "alpha", "r1"),
    });
    expect(resolved.status).toBe("resolved");
    expect(resolved.status === "resolved" ? resolved.value.content : undefined).toBe(
      "historical body"
    );
  });
});

function makeFixture(sourceId = "source", pointers?: KvStore<unknown>) {
  const registry = new RetrievalSourceRegistry();
  const source = new TestCoordinatedSource(sourceId);
  registry.register(source);
  const storage: RetrievalGenerationStorage = {
    generations: new BackedKvStore(new MemoryStoreBackend()),
    pointers: pointers ?? new BackedKvStore(new MemoryStoreBackend()),
    citations: new BackedKvStore(new MemoryStoreBackend()),
  };
  const policy = new Policy();
  const userAuth = auth(policy);
  const adminAuth = auth(new Policy());
  const clock = { now: () => NOW };
  const coordinator = new RetrievalIndexCoordinator({ registry, storage, clock });
  const engine = new RetrievalEngine({ registry, coordinator, storage, clock });
  return { registry, source, storage, policy, auth: userAuth, adminAuth, coordinator, engine };
}

function conformanceHarness(
  fixture: ReturnType<typeof makeFixture>
): RetrievalConformanceHarness {
  return {
    replaceDocuments: (documents) => fixture.source.replace(documents),
    denyHit: (id, denied) => toggle(
      fixture.policy.deniedHits,
      canonicalResourceKey(ref("conformance", id, "r1")),
      denied
    ),
    denyContent: (id, denied) => toggle(
      fixture.policy.deniedContent,
      canonicalResourceKey(ref("conformance", id, "r1")),
      denied
    ),
    index: (requestId) => fixture.coordinator.index(
      indexRequest(requestId, fixture.auth, "conformance")
    ),
    search: (requestId, text) => fixture.engine.search(
      searchRequest(requestId, fixture.auth, text)
    ),
    resolve: (requestId, id, revision) => fixture.engine.resolve({
      requestId,
      auth: fixture.auth,
      resource: ref("conformance", id, revision),
    }),
  };
}

function nativeConformanceHarness(): NativeAuthorizedRankingConformanceHarness {
  const registry = new RetrievalSourceRegistry();
  const source = new ConformantNativeSource("conformance");
  registry.register(source);
  const storage: RetrievalGenerationStorage = {
    generations: new BackedKvStore(new MemoryStoreBackend()),
    pointers: new BackedKvStore(new MemoryStoreBackend()),
    citations: new BackedKvStore(new MemoryStoreBackend()),
  };
  const policy = new Policy();
  const context = auth(policy);
  const coordinator = new RetrievalIndexCoordinator({
    registry,
    storage,
    clock: { now: () => NOW },
  });
  const engine = new RetrievalEngine({
    registry,
    coordinator,
    storage,
    clock: { now: () => NOW },
  });
  return {
    replaceDocuments: (documents) => source.replace(documents),
    denyHit: (id, denied) =>
      toggle(
        policy.deniedHits,
        canonicalResourceKey(ref("conformance", id, "r1")),
        denied
      ),
    search: (requestId, text) =>
      engine.search({
        ...searchRequest(requestId, context, text),
        sourceIds: ["conformance"],
      }),
  };
}

class TestCoordinatedSource implements CoordinatedRetrievalSource<TagFilter> {
  readonly description: Extract<
    RetrievalSourceDescription,
    { mode: "coordinated-index" }
  >;
  readonly filterSchema = tagFilterSchema;
  private documents: RetrievalDocument[] = [];
  private readonly history = new Map<string, string>();
  readonly scanContexts: Array<{ tenantId?: string; workspaceId?: string; frozen: boolean }> = [];
  resolveCalls = 0;
  filterCalls = 0;
  reverseScan = false;
  readonly throwFilterIds = new Set<string>();

  constructor(
    id: string,
    priority = 0,
    revisionResolution: "current-only" | "historical" = "current-only"
  ) {
    this.description = {
      id,
      label: `Source ${id}`,
      mode: "coordinated-index",
      revisionResolution,
      resourceKinds: ["document"],
      filter: { schemaId: "test-tag-filter", schemaVersion: 1 },
      priority,
    };
  }

  replace(documents: readonly RetrievalDocument[]): void {
    this.documents = structuredClone([...documents]);
  }

  addHistorical(resource: RetrievalResourceRef, content: string): void {
    this.history.set(canonicalResourceKey(resource), content);
  }

  async *scan(request: { tenantId?: string; workspaceId?: string }, context: AuthContext) {
    this.scanContexts.push({
      ...(request.tenantId === undefined ? {} : { tenantId: request.tenantId }),
      ...(request.workspaceId === undefined ? {} : { workspaceId: request.workspaceId }),
      frozen: Object.isFrozen(context.principal),
    });
    const values = this.reverseScan ? [...this.documents].reverse() : this.documents;
    for (const document of values) yield structuredClone(document);
  }

  matchesFilter(document: RetrievalDocument, filterValue: TagFilter): boolean {
    this.filterCalls += 1;
    if (this.throwFilterIds.has(document.resource.id)) {
      throw new Error("filter must not observe denied document");
    }
    return document.facets?.some(
      (facet) => facet.name === "tag" && facet.value === filterValue.tag
    ) ?? false;
  }

  resolve(resource: RetrievalResourceRef): SourceResolutionResult {
    this.resolveCalls += 1;
    const historical = this.history.get(canonicalResourceKey(resource));
    if (historical !== undefined) return resolved(resource, historical);
    const current = this.documents.find(({ resource: refValue }) => refValue.id === resource.id);
    if (!current) return { status: "deleted", resource };
    if (current.resource.revision !== resource.revision) {
      return { status: "changed", requested: resource, current: current.resource };
    }
    return resolved(current.resource, current.searchText);
  }
}

class TestNativeSource implements NativeRetrievalSource<TagFilter> {
  readonly description: Extract<
    RetrievalSourceDescription,
    { mode: "native-index" }
  >;
  readonly filterSchema = tagFilterSchema;
  candidates: NativeRetrievalCandidate[] = [];

  constructor(id: string) {
    this.description = {
      id,
      label: `Source ${id}`,
      mode: "native-index",
      rankingContract: "source-enforced-authorized-corpus",
      revisionResolution: "current-only",
      resourceKinds: ["document"],
      filter: { schemaId: "test-tag-filter", schemaVersion: 1 },
      priority: 0,
    };
  }

  search(_request: NativeRetrievalSearchRequest<TagFilter>): readonly NativeRetrievalCandidate[] {
    return structuredClone(this.candidates);
  }

  resolve(resource: RetrievalResourceRef): SourceResolutionResult {
    return resolved(resource, `native content ${resource.id}`);
  }
}

class ConformantNativeSource implements NativeRetrievalSource<TagFilter> {
  readonly description: Extract<
    RetrievalSourceDescription,
    { mode: "native-index" }
  >;
  readonly filterSchema = tagFilterSchema;
  private documents: RetrievalDocument[] = [];

  constructor(id: string) {
    this.description = {
      id,
      label: `Source ${id}`,
      mode: "native-index",
      rankingContract: "source-enforced-authorized-corpus",
      revisionResolution: "current-only",
      resourceKinds: ["document"],
      filter: { schemaId: "test-tag-filter", schemaVersion: 1 },
      priority: 0,
    };
  }

  replace(documents: readonly RetrievalDocument[]): void {
    this.documents = structuredClone([...documents]);
  }

  async search(
    request: NativeRetrievalSearchRequest<TagFilter>,
    context: AuthContext
  ): Promise<readonly NativeRetrievalCandidate[]> {
    const authorized: RetrievalDocument[] = [];
    for (const value of this.documents) {
      const decision = await context.authorize({
        action: "retrieval.hit.read",
        resource: {
          kind: "retrieval-resource",
          target: canonicalResourceKey(value.resource),
          scope: "resource",
          ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
          ...(value.workspaceId === undefined
            ? {}
            : { workspaceId: value.workspaceId }),
          metadata: {
            sourceId: value.resource.sourceId,
            resourceKind: value.resource.kind,
            revision: value.resource.revision,
            audience: value.audience,
          },
        },
      });
      if (decision.outcome === "allow") authorized.push(value);
    }
    const normalizedQuery = request.text.toLocaleLowerCase("en-US");
    return authorized
      .filter(({ searchText }) =>
        searchText.toLocaleLowerCase("en-US").includes(normalizedQuery)
      )
      .map((value) => ({
        resource: value.resource,
        audience: value.audience,
        ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
        ...(value.workspaceId === undefined
          ? {}
          : { workspaceId: value.workspaceId }),
        lexicalScore: 1 / authorized.length,
      }));
  }

  resolve(resource: RetrievalResourceRef): SourceResolutionResult {
    const current = this.documents.find(({ resource: value }) =>
      canonicalResourceKey(value) === canonicalResourceKey(resource)
    );
    return current === undefined
      ? { status: "deleted", resource }
      : resolved(resource, current.searchText);
  }
}

class Policy {
  readonly hiddenSources = new Set<string>();
  readonly deniedHits = new Set<string>();
  readonly deniedContent = new Set<string>();

  decide(request: AuthorizationRequest) {
    const target = request.resource.target ?? "";
    const deny =
      (request.action === "retrieval.source.discover" && this.hiddenSources.has(target)) ||
      (request.action === "retrieval.hit.read" && this.deniedHits.has(target)) ||
      (request.action === "retrieval.content.resolve" && this.deniedContent.has(target));
    return { outcome: deny ? "deny" as const : "allow" as const, reason: deny ? "test deny" : "test allow" };
  }
}

class FailingKvStore<T> implements KvStore<T> {
  failNextSet = false;
  constructor(private readonly delegate: KvStore<T>) {}
  get(key: string): T | undefined { return this.delegate.get(key); }
  set(key: string, value: T, options?: KvSetOptions): void {
    if (this.failNextSet) {
      this.failNextSet = false;
      throw new Error("publication failed");
    }
    this.delegate.set(key, value, options);
  }
  patch(key: string, partial: Partial<T>, options?: KvSetOptions): void {
    this.delegate.patch(key, partial, options);
  }
  delete(key: string): void { this.delegate.delete(key); }
  list(prefix?: string): string[] { return this.delegate.list(prefix); }
  entries(prefix?: string): Array<{ key: string; value: T }> {
    return this.delegate.entries(prefix);
  }
}

interface TagFilter { tag: string }

const tagFilterSchema: StandardSchemaV1<unknown, TagFilter> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate(value) {
      return value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 1 &&
        typeof (value as { tag?: unknown }).tag === "string"
        ? { value: value as TagFilter }
        : { issues: [{ message: "Invalid TagFilter" }] };
    },
  },
};

function auth(
  policy = new Policy(),
  principalValue: AuthenticatedPrincipal = principal()
): AuthContext {
  return {
    principal: principalValue,
    authorize: (request) => policy.decide(request),
  };
}

function principal(): AuthenticatedPrincipal {
  return {
    id: "principal-1",
    kind: "human",
    identity: { issuer: "test", subject: "user-1", method: "oauth" },
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    roles: ["member"],
    scopes: ["retrieval:read"],
  };
}

function document(
  sourceId: string,
  id: string,
  revision: string,
  searchText: string,
  tag?: string
): RetrievalDocument {
  return {
    resource: ref(sourceId, id, revision),
    searchText,
    contentHash: `hash-${id}-${revision}`,
    audience: "workspace",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    ...(tag === undefined ? {} : { facets: [{ name: "tag", value: tag }] }),
  };
}

function ref(sourceId: string, id: string, revision: string): RetrievalResourceRef {
  return {
    sourceId,
    kind: "document",
    id,
    revision,
    fragment: { kind: "record", id },
  };
}

function resolved(resource: RetrievalResourceRef, content: string): SourceResolutionResult {
  return {
    status: "resolved",
    value: {
      resource,
      label: `Label ${resource.id}`,
      content,
      audience: "workspace",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    },
  };
}

function candidate(resource: RetrievalResourceRef, lexicalScore: number): NativeRetrievalCandidate {
  return {
    resource,
    audience: "workspace",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    lexicalScore,
  };
}

function normalizeGenerationIds(result: import("../src/index.ts").RetrievalSearchResult) {
  return {
    ...result,
    hits: result.hits.map(({ generationId: _generationId, ...hit }) => hit),
    receipt: {
      ...result.receipt,
      sources: result.receipt.sources.map(
        ({ generationId: _generationId, ...source }) => source
      ),
    },
  };
}

function indexRequest(requestId: string, context: AuthContext, sourceId: string) {
  return { requestId, auth: context, sourceId };
}

function searchRequest(requestId: string, context: AuthContext, text: string) {
  return {
    requestId,
    auth: context,
    text,
    mode: "lexical" as const,
    limit: 20,
    purpose: "user-search" as const,
  };
}

function filter(sourceId: string, value: unknown) {
  return {
    sourceId,
    schemaId: "test-tag-filter",
    schemaVersion: 1,
    value,
  };
}

function valid(
  schema: { readonly "~standard": { validate(value: unknown): unknown } },
  value: unknown
): boolean {
  const result = schema["~standard"].validate(value);
  return !!result && typeof result === "object" && !("issues" in result);
}

function toggle(set: Set<string>, key: string, enabled: boolean): void {
  if (enabled) set.add(key);
  else set.delete(key);
}
