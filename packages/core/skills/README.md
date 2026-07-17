# @gonk/skills

Canonical, host-neutral discovery and reads for Gonk-managed skills.

`@gonk/skills` finds active `SKILL.md` trees through the five `@gonk/scope`
tiers, resolves definitions deterministically, and returns closed Standard Schema
records with typed provenance, optional freshness, stable revisions, and a
normalized supporting-file tree.

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

Freshness is an injected capability. Core performs no network access: without a
probe it reports `unknown`, and a failed probe becomes `unprobeable` without
hiding the skill.

This registry is a discovery/read substrate, not an authorization boundary.
Applications and host adapters must authorize list visibility, detail and
definition disclosure, and body/supporting-file reads before exposing results to a
principal. Phase 0 deliberately avoids inventing an auth policy inside the
filesystem package.

Future stores can import the runner-neutral
`managedSkillRegistryConformanceCases()` from `@gonk/skills/conformance` and
adapt the named async cases to their test framework. The suite exercises the public registry contract;
filesystem-specific security cases remain package tests.

Phase 0 is deliberately read-only. It does not create, patch, archive, restore,
activate, project tools, discover host-installed skills, or perform semantic
search. Those operations will build on these records without adding a generic
`invoke` verb.
