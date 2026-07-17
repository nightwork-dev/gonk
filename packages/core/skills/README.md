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
can write active skills or structurally invisible staged skills. Patch supports
body find/replace plus supporting-file writes/removals and compares
`expectedRevision`; patch, pin, usage, and archive return structured conflicts
with the current revision and affected paths. `idempotencyKey` is replayed by an
in-process ledger for the filesystem registry. Pinned skills reject agent edits
and archive by default.

Staged promotion is never implicit. `promote()` requires normal Gonk
authorization and an injected `@gonk/tool-registry` approval provider; without
that provider, or when approval is required/denied, the staged directory is left
untouched.

Activation is model-visible only through `@gonk/context`. `activate()` returns a
readiness result and compiler candidate; `createSkillActivationContributor()`
projects activation receipts as required model-context candidates. Tool
projection is distinct (`read`, `attach`, `activate`, `test`): use
`projectSkillToolDefinitions()` for `@gonk/tool-registry` definitions with
closed Standard Schema input/output contracts, or `projectSkillTools()` for a
lightweight catalog descriptor. There is no generic invoke verb.

Freshness is an injected capability. Core performs no network access: without a
probe it reports `unknown`, and a failed probe becomes `unprobeable` without
hiding the skill.

Read APIs remain a discovery/read substrate, not an authorization boundary.
Applications and host adapters must authorize list visibility, detail and
definition disclosure, and body/supporting-file reads before exposing results to
a principal. Writable APIs take canonical `AuthContext` and fail closed.

Future stores can import the runner-neutral
`managedSkillRegistryConformanceCases()` from `@gonk/skills/conformance` and
adapt the named async cases to their test framework. The suite exercises the public registry contract;
filesystem-specific security cases remain package tests.

Still out of scope: host-installed skill discovery, Sigil UI state, semantic
skill search, and host-specific skill test execution.
