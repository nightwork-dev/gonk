# Managed skills design

> Status: **shipped, Phase 0.** Implemented by `@gonk/skills`.

## Boundary

Core owns the canonical managed-skill records, strict manifest parsing,
deterministic scope resolution, read APIs, provenance/freshness vocabulary,
filesystem implementation, and reusable conformance suite. Host catalogs,
tool and UI projections, mutations, activation, and semantic search remain
outside this package.

This is an extraction and hardening of the useful filesystem behavior in the
former extension-owned `skill-creator`, not a generic registry abstraction.
Core does not depend on that extension.

## Read model

An active definition is rooted at:

```text
<tier-home>/skills/<id>/SKILL.md
```

The registry exposes four asynchronous operations:

- `list` returns one active winner per ID, sorted by ID;
- `get` returns the winner (or an exact requested scope) plus shadowed summaries;
- `resolve` returns every definition in scope-precedence order and identifies the winner;
- `read` returns the manifest body or one normalized supporting file.

All public requests and results have exact Standard Schema validators. Their
scope, lifecycle, origin, capability, freshness, result, and failure values are
closed unions. Opaque host adapter and package identifiers remain data fields.

Phase 0 does not accept an auth context and does not authorize disclosure. It
is the canonical storage/discovery substrate underneath an authorized adapter:
the consumer must authorize list visibility, detail and shadow information,
and every body or supporting-file read before returning it to a principal.
This boundary is explicit in the registry interface documentation; Core does
not imply that filesystem reachability grants model or user visibility.

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
neighbor. Parsing supports the conservative YAML subset used by existing
skills: mappings, scalar sequences, quoted/plain scalars, and inline scalar
arrays. Unsupported YAML constructs fail closed. `description` and a non-empty
body are required; a declared `id` must match its directory.

## Revisions and files

The manifest body gets its own SHA-256 content hash. The skill revision is a
length-prefixed SHA-256 digest over the raw manifest followed by sorted relative
supporting paths and file bytes. The normalized tree reports stable ordering,
sizes, and per-file hashes. Registry methods hold no mutable read cursor, so
parallel callers do not share request state.
Supporting content is returned from the same verified byte snapshot used to
compute its file hash and skill revision, so a path cannot be swapped to a
symlink between discovery and `read()`.

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

## Intentionally not lifted

The extension parser's permissive fallback for malformed frontmatter, linked
file traversal, mutation and staging views, inline shell/template expansion,
tool wiring, activation, and host projection are not part of Phase 0. The next
slice adds lifecycle operations and activation receipts over these same read
contracts; it will use canonical Gonk auth and `@gonk/context`, with distinct
`read`, `attach`, `activate`, and `test` operations rather than generic
`invoke`.
