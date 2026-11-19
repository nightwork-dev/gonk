# @gonk/skills

Find, read and manage agent skills: folders that hold a `SKILL.md` file and the
files it refers to. `@gonk/skills` looks for skills across the five
[`@gonk/scope`](https://www.npmjs.com/package/@gonk/scope) tiers (session,
directory, project, persona and global) and picks the most specific definition
of each one. Changes to skills go through
[`@gonk/auth`](https://www.npmjs.com/package/@gonk/auth) authorization and are
recorded so that they survive a restart.

It also serves skills that ship inside an application through two read-only
tools for a [`@gonk/tool-registry`](https://www.npmjs.com/package/@gonk/tool-registry)
registry.

## Install

```sh
npm install @gonk/skills @gonk/scope @gonk/store @mirk/store
```

## Quick start: read skills

A skill lives at `<tier home>/skills/<id>/SKILL.md`. For a project, the tier
home is the project folder:

```text
my-project/
  skills/
    release-check/
      SKILL.md
      references/checklist.md
```

```markdown
---
name: release-check
description: Steps to check a release before it ships.
---

# Release check

Read references/checklist.md, then do each step.
```

```ts
import { InMemoryKv } from "@mirk/store";
import type { SyncStore } from "@mirk/store";
import type { ScopeName } from "@gonk/scope/types";
import type { GonkSyncStateSource } from "@gonk/store";
import { FilesystemManagedSkillRegistry } from "@gonk/skills";

// Lifecycle records go to a Mirk store that the host chooses and owns.
// InMemoryKv keeps this example short; use a persistent adapter in a real host.
const stores = new Map<ScopeName, SyncStore>();
const stateSource: GonkSyncStateSource = {
  kv(tier) {
    let store = stores.get(tier);
    if (!store) stores.set(tier, (store = new InMemoryKv()));
    return store;
  },
};

const skills = new FilesystemManagedSkillRegistry({
  env: { cwd: process.cwd(), sessionId: "session-123" },
  stateSource,
});

const listed = await skills.list();
// → { status: "ok", skills: [{ id: "release-check", description: "...", scope: "directory", ... }] }

const detail = await skills.get({ id: "release-check" });
const checklist = await skills.read({
  id: "release-check",
  path: "references/checklist.md",
});
// → { status: "found", content: "...", contentHash: "sha256:...", ... }
```

Every result is a plain record with a fixed schema. It includes the skill's
scope, a stable `revision`, content hashes, and the tree of supporting files.

## How skills resolve

- **Most specific wins.** If the same skill ID exists in several tiers, the
  narrowest one wins: session, then directory, project, persona and global.
  `resolve({ id })` returns the winner and every other definition in order.
- **Strict paths.** Malformed manifests, reserved IDs, paths that leave the
  skill folder and symbolic links are refused.
- **Hidden lifecycle folders.** Staged and archived skills live in `.staging`
  and `.archive` folders that `list`, `get` and `read` never show.
- **Freshness.** You can inject a `freshnessProbe` that checks whether a skill
  is out of date. Without one, freshness is reported as `unknown`. The package
  makes no network calls itself.

The read methods do not check authorization. Before you show results to a
caller, check that the caller may see them.

## Changing skills

`FilesystemManagedSkillRegistry` also implements the writable contract. Every
change takes an `AuthContext` and an `idempotencyKey`:

```ts
import { ownerPrincipal } from "@gonk/auth";

const auth = ownerPrincipal(process.env);

const created = await skills.create({
  auth,
  idempotencyKey: "create-deploy-notes-1",
  id: "deploy-notes",
  scope: "directory",
  description: "How to deploy this service.",
  body: "# Deploy\n\nRun the release script.\n",
});

if (created.status === "ok") {
  await skills.patch({
    auth,
    idempotencyKey: "patch-deploy-notes-1",
    expectedRevision: created.revision,
    id: "deploy-notes",
    find: "Run the release script.",
    replace: "Run the release script with --dry-run first.",
  });
}
```

| Method | What it does |
| --- | --- |
| `create` | Writes a new active skill, or a staged one with `staged: true`. |
| `patch` | Finds and replaces text in the body, and writes or removes supporting files. |
| `pin` | Locks a skill against edits and archiving until it is unpinned. |
| `archive`, `restore` | Moves a skill out of and back into the active set. |
| `promote` | Makes a staged skill active. It needs an injected approval provider. |
| `recordUsage` | Updates a skill's usage metadata. |
| `activate` | Marks a skill as used by the model and records an activation receipt. |

Changes that take an `expectedRevision` return a structured conflict when the
skill changed in the meantime. Repeating a request with the same
`idempotencyKey` returns the recorded result, after authorization is checked
again. If a crash interrupts a change before it is recorded, the registry rolls
the change back when it next starts. `getMutationReceipt()`, `getActivationReceipt()` and
`listActivationReceipts()` return the recorded results.

Lifecycle records go to the Mirk store that you pass as `stateSource`. The
package never chooses an adapter or a path for it and never closes it. It does
not store credentials, policy functions, request bodies or idempotency keys.

## Skills in the model's context and as tools

- `createSkillActivationContributor()` feeds activated skills to a
  [`@gonk/context`](https://www.npmjs.com/package/@gonk/context) compiler as
  required context.
- `createSkillToolDefinitions()` returns registry tools bound to a writable
  registry: `skill-read` and `skill-activate`, plus `skill-attach` and
  `skill-test` when the host supplies those callbacks. Every tool fails
  without `ctx.auth`.

## Skills packaged with an application

`@gonk/skills/bundled` serves skill folders that ship inside your application,
through two read-only tools. Register them once and they are available in every
host that serves the registry: MCP, HTTP and the CLI.

```ts
import { createBundledSkillToolDefinitions } from "@gonk/skills/bundled";

registry.register(
  createBundledSkillToolDefinitions({
    root: new URL("./skills/", import.meta.url),
  }),
);
```

- `skill_list` returns each skill's ID, name and description from its
  frontmatter.
- `skill_get({ id })` returns the full `SKILL.md`.

The root holds one folder per skill, each with a `SKILL.md`. An ID cannot
reach a path outside the root. Bundled skills need no state store. Set
`listName` and `getName` to rename the tools when you combine several bundles.
To also offer the bundle through native MCP Skills, see
[`@gonk/tool-registry-mcp`](https://www.npmjs.com/package/@gonk/tool-registry-mcp).

## Testing your own registry

`@gonk/skills/conformance` exports `managedSkillRegistryConformanceCases()`, a
set of named async test cases for the registry contract. Adapt them to your
test framework to check another implementation.

## Entry points

| Import | Contents |
| --- | --- |
| `@gonk/skills` | `FilesystemManagedSkillRegistry`, tool and context helpers, schemas and types. |
| `@gonk/skills/bundled` | `createBundledSkillToolDefinitions`. |
| `@gonk/skills/conformance` | `managedSkillRegistryConformanceCases`. |

## License

Apache-2.0
