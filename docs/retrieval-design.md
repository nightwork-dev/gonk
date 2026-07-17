# Authorized retrieval core

Status: **SHIPPED — Phase 0**

Package: `@gonk/retrieval`

Roadmap: GR-75

## Decision

Gonk Core owns a separate retrieval package over `@gonk/auth` and
`@gonk/store`. It registers in-process sources, publishes immutable coordinated
index generations, searches only the authorized corpus, resolves content
through a final authoritative gate, creates stable citations, and emits
content-free retrieval-domain receipts.

Retrieval does not import `@gonk/context`. Search and citation are useful on
their own; a later adapter may turn authorized retrieval results into context
candidates without merging the two policy boundaries.

## Source modes

- `native-index`: the source owns an authenticated index and returns untrusted
  metadata candidates. Core validates identity and authority, then applies the
  hit gate independently.
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
  -> source-owned typed filter validation
  -> authenticated source scan/search
  -> validate canonical ref + tenant/workspace confinement
  -> retrieval.hit.read
  -> authorized-corpus statistics and lexical ranking
  -> metadata-only hit

metadata-only ref
  -> source resolve against current authoritative state
  -> validate identity + tenant/workspace confinement
  -> retrieval.content.resolve
  -> label/excerpt/content or closed redacted status
```

Discovery-denied sources are absent from source lists, searches, and receipts.
Hit denials are also silent: denied candidates cannot affect visible corpus
statistics, scores, order, counts, or drop receipts. Search does not call
content resolution. Adapter output is untrusted even when the adapter received
the authenticated request.

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

Phase 0 tokenizes deterministically and computes BM25 over documents that have
already passed structured filters, tenant/workspace confinement, and
`retrieval.hit.read`. Scores expose a closed lexical component with source ID,
source priority, and final score. Stable resource identity is the final
tie-breaker.

Native source scores are source-produced and labelled `native`; Core does not
pretend it can reconstruct native corpus statistics without owning that index.
It still validates and authorizes every returned candidate.

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
registration, context integration, Sigil adapters/UI, and generic registry or
receipt packages.
