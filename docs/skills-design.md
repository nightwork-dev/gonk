# Managed skills design

> Status: **Phase 1 implemented; GR-74 remains open** until the extension
> registry and first Sigil consumer migrate to Core.

## Boundary

Core owns the canonical managed-skill records, YAML parsing plus strict field validation,
deterministic scope resolution, read APIs, authorized writable APIs,
provenance/freshness vocabulary, filesystem implementation, activation
receipts/context projection, distinct tool projection, and reusable conformance
suite. Host catalogs, UI state, semantic search, and host-specific test runners
remain outside this package.

This extracts and hardens the useful filesystem behavior in the existing
`skill-creator` extension registry, whose migration to Core is still pending.
It is not a generic registry abstraction, and Core does not depend on that
extension.

The package depends on `@gonk/scope`, `@standard-schema/spec`, and `yaml`.
`yaml` is intentional compatibility substrate: the legacy registry writes with
`yaml.stringify`, including folded/wrapped scalars that a hand-written subset
parser cannot safely reinterpret.

## Read model

An active definition is rooted at:

```text
<tier-home>/skills/<id>/SKILL.md
```

The registry exposes four asynchronous operations:

- `list` returns one active winner per ID, sorted by ID;
- `get` returns the winner (or an exact requested scope) plus neutrally labelled other definitions;
- `resolve` accepts no scope override, returns every definition in scope-precedence order, and always identifies the real narrowest winner;
- `read` returns the manifest body or one normalized supporting file.

All public requests and results have exact Standard Schema validators. Their
scope, lifecycle, origin, capability, freshness, result, and failure values are
closed unions. Opaque host adapter and package identifiers remain data fields.

Read methods do not accept an auth context and do not authorize disclosure. They
are the canonical storage/discovery substrate underneath an authorized adapter:
the consumer must authorize list visibility, detail and definition information,
and every body or supporting-file read before returning it to a principal.
Writable methods are separate and require canonical `@gonk/auth` `AuthContext`;
authorization failures, thrown policies, and malformed principals fail closed.

## Filesystem invariants

Scope homes and precedence come directly from `@gonk/scope`; the registry does
not reconstruct them. A long-lived instance therefore honors live persona
rebinding when its `ScopeEnvironment` provides `resolvePersonaHome`.

`.staging` and `.archive` are hidden structurally because discovery rejects dot
directories before it considers skill IDs. They are not list filters and
cannot be targeted through `get` or `read`.

Managed IDs are lowercase and restricted to `a-z`, digits, `.`, `_`, and `-`.
Relative supporting paths reject absolute paths, backslashes, empty segments,
`.` and `..`. Directory entries, manifests, and supporting files must all be
real non-symbolic filesystem objects inside the selected skill root. Phase 0
rejects every symlink, including in-tree aliases; this is intentionally stricter
than merely rejecting links that escape.

Malformed frontmatter removes only the malformed definition, never a valid
neighbor. Parsing uses `yaml`, matching the actual legacy writer, while aliases,
duplicate keys, non-scalar data, and invalid typed fields fail closed.
`description` and a non-empty body are required; a declared `id` must match its
directory. Operational timestamps require ISO 8601 instants. The legacy
provenance `pinnedAt` field also accepts a strict ISO calendar date because the
extension contract documented and emitted date-only values.

## Revisions and files

The manifest body gets its own SHA-256 content hash. The skill revision is a
length-prefixed SHA-256 digest over the raw manifest followed by sorted relative
supporting paths and file bytes. The normalized tree reports stable ordering,
sizes, and per-file hashes. Registry methods hold no mutable read cursor, so
parallel callers do not share request state.
Supporting content is returned from the same verified byte snapshot used to
compute its file hash and skill revision, so a path cannot be swapped to a
symlink between discovery and `read()`.
Directory identity is checked across enumeration and reads; a concurrent rename
discards the raced entry (or the whole raced scope root) rather than committing
partial results.

## Provenance and freshness

Legacy extension provenance is normalized into typed fields and anchors:

```ts
type SkillProvenanceAnchor =
  | { kind: "file"; value: string }
  | { kind: "symbol"; value: string };
```

Freshness is optional and requested explicitly. A caller may inject a
`SkillFreshnessProbe`; Core itself never fetches. Missing probes report
`unknown`. Throws or schema-invalid probe results report `unprobeable` and do
not make the skill disappear.

## Writable lifecycle

`ManagedSkillRegistry` remains the read-only contract. `WritableManagedSkillRegistry`
adds create, patch, archive, restore, promote, pin, usage, and activate as
required methods so consumers cannot accidentally treat mutation support as
optional and fail open.

Mutation requests carry `idempotencyKey`; the filesystem implementation keeps an
in-process replay ledger keyed by request fingerprint. Reusing a key with a
different request returns a structured conflict. Patch, pin, usage, and archive
also carry `expectedRevision`; stale callers receive the current revision and
affected paths. Patch can update the manifest body, write supporting files, and
remove supporting files through a copy-then-rename directory rewrite. Pinned
skills reject agent edits and archive by default.

Create can write active or staged skills, but not overwrite existing live
material. Staged skills live under `.staging` and remain invisible to list/get/read.
Promotion requires both `skill.manage` authorization and an injected
`@gonk/tool-registry` approval provider; a missing, required, or denied approval
provider leaves the staged copy untouched. Restore copies from `.archive` and
refuses to clobber a live skill.

## Activation and tools

Activation is not a read shortcut. `activate()` authorizes `skill.activate`,
checks basic readiness, records usage metadata, and returns an activation receipt
plus a compiler candidate. Model-visible content flows through
`createSkillActivationContributor()` and the normal `@gonk/context` discovery,
resolution, and `context.use` authorization path.

Tool projection is closed and distinct: `read`, `attach`, `activate`, and
`test`. `projectSkillToolDefinitions()` returns real `@gonk/tool-registry`
definitions with closed Standard Schema input/output contracts; the lighter
`projectSkillTools()` descriptor is for catalogs. Core deliberately does not
project a generic invoke verb.

## Intentionally not lifted

The extension parser's permissive fallback for malformed frontmatter, linked
file traversal, inline shell/template expansion, host-installed discovery,
semantic search, Sigil UI state, and host-specific skill test execution remain
outside Core.

## Migration and release

The Phase 0 changeset is minor because it adds a new public Core contract. Under
the fixed `@gonk/*` release train this is destined for `0.2.0`. The already
merged context changeset must likewise be corrected to minor before that train
is released. GR-74 closes only after extension behavior is migrated and Sigil
consumes the Core package; landing this package alone is not completion.

The Changesets peer-dependent option only escalates peers when their declared
range is actually left. `@gonk/tool-registry` now declares its optional scope
peer as compatible across pre-1 Core minors, preventing that in-range peer from
turning the fixed train's intended `0.2.0` minor into a spurious `1.0.0` major.
