# Pi storage ownership

The Pi host selects database locations and owns Mirk adapters. Plugins receive
scoped state ports from `@gonk/extension-spec-pi/storage`. Capability namespaces
continue to use `bindGonkSyncState` from `@gonk/store`.

The shared leasing implementation lives in `@gonk/store/host-storage`. Pi and
Codex use thin host policy adapters. `@gonk/extension-spec-codex/storage` resolves
portable jobs and communication against the same scope authorities as Pi.
Database paths and adapters stay inside these host bindings.

## Connections and shutdown

`acquirePiStorage` returns a consumer lease with `source` and `close`.
The source supplies Mirk KV and vector ports. When the caller supplies a scope,
the lease also exposes `state` through the existing Gonk namespace binding.

The host pool shares each physical database connection across plugin packages.
A versioned global symbol preserves sharing across separate bundled copies.
Closing a lease releases its references. The final release closes the adapter.

The shared Pi adapter maps portable `session_end` hooks to native
`session_shutdown` hooks. Consumers finish their capability shutdown work before
releasing their storage lease.

## New data and existing data

Fresh state uses `<scopeHome>/.agents/gonk/<tier>/state.db`. Session homes and
native persona mirrors already sit inside the managed namespace. Their state
uses `<scopeHome>/gonk/<tier>/state.db`.

The host retains these existing database locations:

| Existing location | Consumers |
| --- | --- |
| `memory-state/state.db` | Memory, persona, knowing, introspection, probe |
| `pi-state/state.db` | Autotune, image, jobs, persistence, RLM |
| `pi-state/<tier>/state.db` | Comms, curator, handoff, reflector, subagent, work-items |
| `store/skills/state.db` | Skill lifecycle journal |

The compatibility resolver checks the existing managed and legacy roots for
each location. Existing databases remain authoritative for their consumers.
Opening a new canonical database does not migrate or merge another database.
An unreadable existing database produces an error instead of an empty replacement.

This compatibility policy keeps older processes and updated plugins on their
existing data. Physical consolidation requires a separate migration with all
writers stopped, backups, and record checks. Changing a path alone is not a
database migration.

## Scope and filesystem objects

Directory-tier state lives in the working directory, so an agent session
leaves `.agents/gonk/directory/state.db` wherever it runs. Generated `gonk`,
`pi-state`, `memory-state`, `autotune-claims`, and `objective-watch` directories
inside `.agents` or `.gonk` are storage, not project markers: a namespace that
holds only these and the older substrate kinds (`memory`, `knowledge`,
`sessions`, `store`) does not make its parent a project root. Authored
settings, skills, and persona definitions keep their existing scope rules.
`migrateSubstrateHome` does not move these runtime directories, because a bare
directory with the same name can be authored content.

`findProjectRoot` accepts a `ceiling`, and `ScopeEnvironment` accepts
`projectCeiling`. The project walk examines the ceiling and stops there.
Sandboxes and tests set it to their own root so that markers in parent
directories cannot change their project resolution.

Autotune uses a host-selected claims directory and retains exclusive filesystem
creation for cross-process claims. An existing legacy claims directory remains
authoritative so old and new processes use the same locks.

Browser profiles, generated deliverables, and filesystem workspaces retain their
own contracts. This storage API centralizes Pi database ownership; it does not
convert filesystem objects into KV records.
