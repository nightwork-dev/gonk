# Authorized retrieval core

Status: **SHIPPED — Phase 0; Phase 1 adapter in progress**

Package: `@gonk/retrieval`

Roadmap: GR-75

## Decision

Gonk Core owns a separate retrieval package over `@gonk/auth` and
`@gonk/store`. It registers in-process sources, publishes immutable coordinated
index generations, searches a Core-authorized coordinated corpus or a
source-enforced authorized native corpus, resolves content through a final
authoritative gate, creates stable citations, and emits content-free
retrieval-domain receipts.

Retrieval search and citation remain useful on their own. The optional
`@gonk/retrieval/context` adapter turns explicitly selected, authorized
retrieval hits into `@gonk/context` candidates without merging the two policy
boundaries or making search results prompt-visible by default.

## Source modes

- `native-index`: the source owns an authenticated index and returns untrusted
  metadata candidates. Its description must declare
  `rankingContract: "source-enforced-authorized-corpus"`. The source must apply
  authorization before its own corpus statistics/ranking and pass the native
  conformance suite; Core cannot reconstruct or prove those source-owned
  statistics. Core still validates every returned candidate and applies the hit
  gate independently.
- `coordinated-index`: the source provides an authenticated scan and
  source-owned typed filtering. Core owns immutable generations, tombstones,
  authorization-before-statistics, and deterministic BM25 ranking.

The registry is deterministic and in-process. It snapshots validated source
descriptions at registration. `@gonk/scope` may configure adapters but is not a
registration trust boundary.

## Security sequence

```text
captured AuthContext
  -> retrieval.source.discover
  -> validate selected source + source-owned filter schema
  -> coordinated generation read
  -> validate canonical ref + tenant/workspace confinement
  -> retrieval.hit.read
  -> source filter predicate over authorized documents only
  -> authorized-corpus statistics and lexical ranking
  -> metadata-only hit

captured AuthContext
  -> retrieval.source.discover
  -> validate selected source + source-owned filter schema
  -> native source authorizes its corpus, filters, and ranks
  -> Core validates returned refs + tenant/workspace confinement
  -> Core independently repeats retrieval.hit.read
  -> metadata-only hit with Core-normalized query terms

metadata-only ref
  -> source resolve against current authoritative state
  -> validate identity + tenant/workspace confinement
  -> retrieval.content.resolve
  -> label/excerpt/content or closed redacted status

selected retrieval hit
  -> adapter auth snapshot for the same context request principal
  -> retrieval.source.discover re-check
  -> content-free context candidate
  -> ContextCompiler context.discover / context.use gates
  -> RetrievalEngine.resolve final content gate
  -> resolved context block or null
```

Discovery-denied sources are absent from source lists, searches, and receipts.
Hit denials are also silent. In coordinated mode, Core guarantees that denied
candidates never reach source filter callbacks or affect visible corpus
statistics, scores, order, counts, or drop receipts. In native mode, score
noninterference is the source's declared, conformance-tested obligation rather
than a property Core can prove after receiving source-produced scores. Search
does not call content resolution. Adapter output remains untrusted even when
the adapter received the authenticated request.

## Identity and schemas

Canonical resource identity contains the registered source ID, source-owned
closed resource kind, opaque resource ID, opaque revision, and a closed
range/section/chunk/record fragment. Filters are envelopes naming a registered
source schema and version; the value is accepted only through that exact
Standard Schema.

Serializable public requests and results export exact Standard Schema
validators. Protocol discriminants are closed. There is no `| string` escape
hatch, numeric revision, predicate filter, or `Record<string, unknown>` filter
contract.

## Generation publication

The store contract has no cross-key transaction. Coordinated publication uses
an immutable content-addressed generation followed by one pointer write:

1. scan, validate, normalize, sort, and derive tombstones;
2. write the immutable generation;
3. read it back and verify its exact bytes;
4. publish one `{ version, generationId }` pointer;
5. have each reader resolve that pointer once per source/query.

Generation reads validate the complete stored value and recompute its content
address. Failed scans, invalid authority, corrupt storage, or failed publication
leave the previous pointer authoritative.

## Lexical baseline

Phase 0 tokenizes deterministically and computes coordinated BM25 over documents
that have already passed tenant/workspace confinement, `retrieval.hit.read`, and
then the source-owned structured filter. Scores expose a closed lexical
component with source ID, source priority, and final score. Stable resource
identity is the final tie-breaker.

Native source scores are source-produced and labelled `native`; Core does not
pretend it can reconstruct native corpus statistics without owning that index.
The required `source-enforced-authorized-corpus` marker and native conformance
suite make that trust obligation explicit. Native candidates do not provide
matched terms; Core derives the public `matchedTerms` deterministically from the
normalized query. Core still validates and authorizes every returned candidate.

## Citations and receipts

Citations store the immutable resource ref, original audience, authority
partition, source and resource labels, and optional excerpt/hash. Citation IDs
also bind the tenant/workspace partition. Those historical display values are
returned only after current authoritative resolution and the final content
gate. Revoked callers receive a citation handle plus closed status only;
cross-partition lookups are indistinguishable from missing citations.

Search, indexing, and resolution have separate domain receipts. They share
correlation conventions with auth/context but do not introduce a generic
receipt hierarchy. Receipts contain resource identities and scores where
visible, never search text, content, hidden sources, or denial counts for hidden
hits.

## Context adapter

`@gonk/retrieval/context` exports `createRetrievalContextContributor()` and
`listRetrievalContextSources()`.

The contributor consumes a host-supplied selected-hit provider. It does not run
search, does not choose retrieval results, and does not add search hits to a
model prompt merely because they were found. Discovery reuses the retrieval
source registry and repeats `retrieval.source.discover` before it emits a
content-free context candidate. Resolution calls `RetrievalEngine.resolve`, so
stale revisions, tenant/workspace confinement, authoritative source reads, and
the final `retrieval.content.resolve` gate remain owned by retrieval. The
compiled model artifact still appears only after the context compiler's
`context.discover` and `context.use` checks.

Source health/freshness projection also uses the existing retrieval source
registry. `listRetrievalContextSources()` starts from `registry.list()`, so
hidden sources are absent before optional probes run and no second source
registry is introduced.

## Release train

The Phase 0 changeset is minor because it adds a new public Core contract. The
repository's fixed `@gonk/*` release group therefore versions both
`@gonk/retrieval` and its `@gonk/auth` dependency at `0.2.0`; `changeset status`
must report that pair before release packaging is approved.

Raw tarballs packed before `changeset version` still carry the source-tree
`0.1.0` versions. Those are not release artifacts and can collide with the
already published pre-train packages. Pre-version smoke tests must pin the
local train explicitly; final publish smoke tests run only after Changesets has
materialized the fixed `0.2.0` train.

## Deferred

Phase 0 intentionally excludes embeddings, vector/hybrid search, remote source
registration, Sigil adapters/UI, and generic registry or receipt packages.
Phase 1 adds only the context adapter seam; it still excludes Deadletters corpus
indexing, Sigil UI, and any second retrieval registry.
