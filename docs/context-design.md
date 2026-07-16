# Authorized deterministic context compilation

Status: **SHIPPED — Phase 0**
Package: `@gonk/context`
Roadmap: GR-73

## Decision

Gonk Core owns a dependency-light context compiler that turns untrusted,
serializable candidate descriptors from registered in-process contributors into
an authorized, deduplicated, token-budgeted artifact with a redacted domain
receipt.

The compiler is the policy boundary for context intended to become visible to a
model or user. It does not own source search, durable source state, host prompt
hooks, or rendering templates.

## Security sequence

```text
candidate descriptor
  -> context.discover on redacted resourceKey
  -> contributor resolve
  -> validate identity agreement and authoritative resource
  -> context.use on authoritative resource
  -> token accounting, deduplication, budgeting, artifact
```

Denied discovery never calls `resolve`. Optional hidden candidates do not enter
caller-visible drop counts or content-derived receipt fields, so a hidden corpus
cannot perturb visible output. Required or pinned failures return a closed
`blocked` result with no sendable artifact.

Authorization audit receipts remain owned by `@gonk/auth`. Context compilation
emits a separate content-free domain receipt and deliberately does not create a
generic receipt abstraction.

## Deterministic identity and ordering

Four identities remain separate:

- candidate ID: unique within one compile;
- contributor ID: registered executable producer;
- resource key: canonical resource/fragment identity used for exclusions, pins,
  and deduplication;
- revision: authoritative opaque source revision.

Contributors and candidates are normalized into lexical order. Canonical
resource duplicates choose pinned before required, then higher priority, then
lexical contributor and candidate IDs. Budget selection uses that same order.

## Token accounting

`ContextTokenCounter` receives content and an optional opaque model ID. Its
result carries closed quality vocabulary: `fallback`, `model-aware`, or `exact`.
The compiler counts source content, rendered segments including separators, and
the final combined artifact. Provider-reported aggregate usage is not assigned
back to individual candidates.

## Boundary discipline

All public request/result boundaries ship Standard Schema validators. Candidate
descriptors contain no content, callbacks, resolvers, renderers, filter bags, or
policy bags. Protocol discriminants are closed; contributor IDs, resource keys,
revisions, and model IDs remain opaque registered data.

## Deferred

Phase 0 intentionally excludes templates, host hooks, remote contributors, tool
projection, retrieval, managed skills, and generic registry/receipt packages.
Those integrate around the compiler after the pure contract has real consumers.
