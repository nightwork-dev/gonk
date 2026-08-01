# @gonk/retrieval

Authorized source discovery, deterministic lexical retrieval, authoritative
content resolution, and stable citations for Gonk hosts.

`@gonk/retrieval` supports two source modes. A `native-index` source owns its
index and declares that it ranks only its source-authorized corpus. A
`coordinated-index` source supplies an authenticated scan while Gonk publishes
immutable index generations and performs deterministic BM25 ranking. Core
applies the same discovery, returned-hit, and content gates to both modes.

The base entry point remains an in-process retrieval library. The optional
`@gonk/retrieval/context` entry point imports `@gonk/context` only to project
explicitly selected, authorized hits into context candidates. The package does
not create embeddings, register remote sources, or provide Sigil-specific
adapters.

## Install

```sh
npm i @gonk/retrieval @gonk/auth @gonk/store
```

Install `@gonk/context` as well when using the optional context adapter.

## Coordinated source

```ts
import { FsStoreBackend, BackedKvStore } from "@gonk/store";
import {
  RetrievalEngine,
  RetrievalIndexCoordinator,
  RetrievalSourceRegistry,
} from "@gonk/retrieval";

const registry = new RetrievalSourceRegistry();
registry.register(projectDocumentsSource);

const storage = {
  generations: new BackedKvStore(
    new FsStoreBackend(".gonk/retrieval/generations"),
  ),
  pointers: new BackedKvStore(
    new FsStoreBackend(".gonk/retrieval/pointers"),
  ),
  citations: new BackedKvStore(
    new FsStoreBackend(".gonk/retrieval/citations"),
  ),
};
const coordinator = new RetrievalIndexCoordinator({ registry, storage });
const retrieval = new RetrievalEngine({ registry, coordinator, storage });

await coordinator.index({
  requestId: "index-42",
  auth,
  sourceId: "project-documents",
});

const result = await retrieval.search({
  requestId: "search-42",
  auth,
  text: "session binding",
  mode: "lexical",
  limit: 10,
  purpose: "user-search",
});

// Hits contain refs and score components, never labels, excerpts, or content.
const resolved = await retrieval.resolve({
  requestId: "resolve-42",
  auth,
  resource: result.hits[0].resource,
});
```

Sources own their filter value type and Standard Schema. A search filter carries
the source ID plus the schema ID and version; Core validates the value through
the registered schema. Every filter must name a discoverable, selected source.
Missing, discovery-hidden, and unselected filter sources fail with the same
unavailable-source error so validation does not become a source-discovery oracle.
For coordinated indexes, Core authorizes documents before invoking the source
filter callback, and filters before corpus statistics. There is no open filter
bag or predicate callback at the public boundary.

## Evidence coordinator

`RetrievalEvidenceCoordinator` is the shared retrieval-contributor coordinator
for hosts that need one prompt-facing selection pass across multiple sources.
It calls `RetrievalEngine.search()`, so source discovery authorization, hit
authorization, and source-owned filter validation happen before any cross-source
ranking, fusion, token budgeting, or prompt assembly decision.

```ts
import { RetrievalEvidenceCoordinator } from "@gonk/retrieval";

const evidence = new RetrievalEvidenceCoordinator({ engine: retrieval });
const result = await evidence.collect({
  requestId: "evidence-42",
  auth,
  text: "session binding",
  mode: "lexical",
  purpose: "agent-recall",
  maxPackets: 6,
  maxTokens: 1200,
});
```

Evidence packets contain resource refs, audience, source mode/generation,
matched terms, score components, and token estimates. They do not contain
resolved labels, excerpts, or body content. The coordinator records selected
packets, budget/duplicate drops, and per-source contributor receipts so
consumers can prove why a packet did or did not enter the prompt.

## Authorization boundary

Every operation captures the canonical `AuthContext` before asynchronous work.
Core then applies three gates:

1. `retrieval.source.discover` before a source is listed or searched;
2. `retrieval.hit.read` before a coordinated candidate can reach source filters
   or affect BM25 statistics, scores, ordering, visible counts, or receipts;
3. `retrieval.content.resolve` against freshly resolved authoritative metadata
   before any label, excerpt, or content is returned.

Denied sources and hits are silent. They do not appear as denial counts in
retrieval receipts. Native adapter output and coordinated scan output are
validated and independently confined to the authenticated tenant/workspace.

### Native-index trust contract

A native source description must include:

```ts
{
  mode: "native-index",
  rankingContract: "source-enforced-authorized-corpus",
}
```

The native source receives the captured `AuthContext` and must exclude denied
documents before its own filtering, corpus statistics, normalization, and
ranking. Core cannot infer that property from a returned numeric score, so it is
a trusted adapter obligation enforced by the runner-neutral
`nativeAuthorizedRankingConformanceCases()` suite. Core independently validates
and authorizes returned candidates. Native candidates do not submit matched
terms; public `matchedTerms` are derived from the normalized query inside Core.

## Immutable generations

`@gonk/store` intentionally does not promise multi-key transactions. The
coordinator therefore writes a content-addressed immutable generation, reads it
back and verifies it, then publishes it with one pointer write. Search reads the
pointer once. A failed scan, invalid document, corrupt generation, or failed
pointer write leaves the previous generation authoritative. Tombstones are
stored inside the next generation.

## Resolution and citations

Search hits are metadata-only. `resolve` calls the source again and applies the
authoritative final gate. Closed outcomes distinguish `resolved`, `changed`,
`revision-unavailable`, `deleted`, and `unauthorized`.

Citations bind an immutable resource ref, its original audience, the caller's
tenant/workspace partition, and an optional excerpt hash. Citation resolution
repeats authoritative resolution and authorization. A caller who no longer has
access receives only the citation handle and closed status—not a historical
label or excerpt. Cross-partition lookups return `not-found`.

## Runtime schemas

Serializable public requests, results, source candidates, resolution results,
resource refs, source descriptions, and filter envelopes export exact Standard
Schema validators. Protocol unions are closed and opaque source values remain
opaque only where the registered source schema owns them.

## Conformance

`@gonk/retrieval/conformance` exports runner-neutral fixtures and cases for
metadata-only hits, denied-hit ranking isolation, tombstone publication, and
authoritative final-gate denial. It also exports the mandatory native
authorized-corpus ranking case. Source implementations can run these cases
without depending on Vitest.

## Explicit context projection

`@gonk/retrieval/context` exports `createRetrievalContextContributor()` and
`listRetrievalContextSources()`. Search remains discovery only: the contributor
accepts explicit selected-hit references, repeats source and hit authorization,
and resolves through `RetrievalEngine.resolve()` before content can enter the
context compiler. Hidden sources are removed before optional health or freshness
probes run.

## Release train

This package ships on Gonk's fixed `@gonk/*` train. The context adapter is
published in Core 0.3.1; that patch supersedes 0.3.0 without changing retrieval
contracts. Raw tarballs created before `changeset version` retain source-tree
metadata and are not supported release artifacts.

## Deferred beyond Phase 0

- embeddings, vector search, and hybrid ranking;
- remote source registration;
- Sigil resource adapters and UI;
- generic registry or receipt packages.

## License

Apache-2.0.
