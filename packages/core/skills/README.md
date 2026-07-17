# @gonk/skills

Canonical, host-neutral discovery, lifecycle mutation, activation, and reads for
Gonk-managed skills.

`@gonk/skills` finds active `SKILL.md` trees through the five `@gonk/scope`
tiers, resolves definitions deterministically, mutates managed skills through
canonical `@gonk/auth` checks, and returns closed Standard Schema records with
typed provenance, optional freshness, stable revisions, and a normalized
supporting-file tree.

```bash
npm install @gonk/skills @gonk/scope
```

```ts
import { FilesystemManagedSkillRegistry } from "@gonk/skills";

const skills = new FilesystemManagedSkillRegistry({
  env: { cwd: process.cwd(), sessionId: "session-123" },
});

const listed = await skills.list();
const detail = await skills.get({ id: "release-check" });
const reference = await skills.read({
  id: "release-check",
  path: "references/checklist.md",
});
```

Managed active skills live at `<tier-home>/skills/<id>/SKILL.md`. Manifests are
parsed with the same `yaml` implementation used by the legacy writer, including
wrapped scalars, then validated against Core's typed fields. The normal
registry cannot reach `.staging` or `.archive`; malformed manifests, reserved
IDs, traversal paths, and symbolic links fail closed. The narrowest definition
wins (`session > directory > project > persona > global`). `resolve()` always
returns that real winner and every definition in order; `get({ scope })`
inspects an exact definition and labels the others neutrally.

Mutations live on the separate `WritableManagedSkillRegistry` contract. Create
can write active skills or structurally invisible staged skills while preserving
typed tags and provenance. Patch supports
body find/replace plus supporting-file writes/removals and compares
`expectedRevision`; patch, pin, usage, and archive return structured conflicts
with the current revision and affected paths. `idempotencyKey` is replayed from a
restart-durable lifecycle journal namespaced by operation, canonical auth security
context, and a hashed request fingerprint; authorization is rechecked before every
replay. `getMutationReceipt()` makes the durable result observable without exposing
it across principals. Filesystem mutations keep a scope-local pending pre-image
until the receipt commits; registry construction restores a pending mutation
without a receipt and discards the pre-image when the receipt exists. Pinned
skills reject edits and archive until an authorized `pin({ pinned: false })`
explicitly unpins them.

Staged promotion is never implicit. `promote()` requires normal Gonk
authorization and an injected `@gonk/tool-registry` approval provider; without
that provider, or when approval is required/denied, the staged directory is left
untouched.

Activation is model-visible only through `@gonk/context`. `activate()` returns
`ready` only after its usage metadata update and activation receipt are durable.
The usage rewrite is covered by the same pending pre-image protocol, so receipt
failure or process interruption cannot leave an unreceipted use count committed.
`getActivationReceipt()` and `listActivationReceipts()` recover security-bound
receipts after restart; `createSkillActivationContributor()` projects recovered
receipts as required model-context candidates. Tool
projection is distinct (`read`, `attach`, `activate`, `test`).
`createSkillToolDefinitions()` binds real `skill-read` and `skill-activate`
handlers to a writable registry; it emits `skill-attach` or `skill-test` only
when the host injects the corresponding executable callback. All definitions
have closed Standard Schema contracts and fail closed without `ctx.auth`.
`projectSkillTools()` remains a lightweight capability descriptor. There is no
generic invoke verb.

Freshness is an injected capability. Core performs no network access: without a
probe it reports `unknown`, and a failed probe becomes `unprobeable` without
hiding the skill.

Read APIs remain a discovery/read substrate, not an authorization boundary.
Applications and host adapters must authorize list visibility, detail and
definition disclosure, and body/supporting-file reads before exposing results to
a principal. Writable APIs take canonical `AuthContext` and fail closed.

Lifecycle records use `@gonk/store` at
`<tier-home>/.agents/store/skills.lifecycle/kv.json` (or the pre-existing legacy
`.gonk/store/skills.lifecycle/kv.json` selected by scope). Records use closed
schemas and atomic KV writes; raw auth contexts, policy functions, request bodies,
and idempotency keys are not stored. The journal inherits `@gonk/store`'s
single-writer-per-namespace assumption. Pending pre-images live in the sibling
`skills.lifecycle-transactions` namespace with atomic markers containing only
relative paths and opaque receipt identifiers. A scope lock is held from pending
snapshot creation through receipt commit and cleanup; live-owner locks prevent a
second registry from constructing over an in-flight mutation, while dead-owner
locks are reclaimed on reconstruction. To roll back or clear receipt history,
stop writers, construct the registry once to reconcile pending transactions,
verify that namespace has no `.pending-*` directories, back up, then remove only
the `skills.lifecycle` namespace directory in the affected tiers. Managed skill
directories remain untouched; the tradeoff is that old mutation calls can no
longer replay and old activation receipts cannot be recovered.

Future stores can import the runner-neutral
`managedSkillRegistryConformanceCases()` from `@gonk/skills/conformance` and
adapt the named async cases to their test framework. The suite exercises the public registry contract;
filesystem-specific security cases remain package tests.

Still out of scope: host-installed skill discovery, Sigil UI state, semantic
skill search, and host-specific skill test execution.
