# Gonk roadmap

**Status:** proposed; not adopted  
**Current evidence date:** 2026-08-12  
**Authority:** this is the tracked repository roadmap for Gonk Core and its
cross-repository delivery gates

Detailed implementation notes may exist in local agent plans, but they do not
replace this tracked roadmap. Dated receipts remain immutable evidence rather
than roadmap authorities.

## Product boundary

Gonk owns portable capability identity, authorization, host projection,
execution state, attempts, leases, progress, cancellation, outcomes, and
receipts.

Gonk does not own:

- generic physical persistence or artifact bytes, which belong to Mirk;
- product state or semantic acceptance;
- provider-specific infrastructure policy;
- UI/application foundations; or
- another planner, memory substrate, or job model.

## Evidence vocabulary

Use these terms as separate states:

- **implemented:** source behavior exists and repository-local checks pass;
- **packed:** a package artifact was produced and inspected;
- **published locally:** a named package exists in local Verdaccio;
- **published publicly:** a named package exists in the public registry;
- **installed:** a named host resolves the named package artifact;
- **runtime-proved:** the real registered entry point executed;
- **consumer-accepted:** the product accepted and reopened the result through
  its own authority;
- **deployed:** a named long-running environment is operating; and
- **adopted:** the roadmap or release was accepted through its approval process.

No state implies the next.

## Current state

### Core

- Current source evidence is `main@0f10b7046a8f4eef5209e92bc73a311081af349d`,
  clean and ahead of `origin/main` at the evidence date.
- The package line contains 20 publishable packages on `0.8.0`.
- A local release receipt covers an earlier clean Core source revision and
  locally installed packages. It does not bind the current source revision to a
  packed artifact or installed host.
- The current Store target binds scope and namespace to caller-owned Mirk
  state.
- The deprecated Store compatibility architecture still exists. Core has not
  been pruned.

### Extensions and execution

- `@gonk/dispatch-contract` verifies declared artifacts and no-change outcomes
  rather than trusting process exit.
- Jobs persist terminal process evidence and require verification before
  becoming `done`.
- Fabric Release B proves a local Verdaccio package set, standing Tailscale
  relay and worker, a real Sigil Chat product path, and modular Codex adoption.
- Fabric Release B does not prove public npm, git push, external production, or
  one immutable binding from exact source through installed modular plugins.

The current Fabric boundary and receipts are maintained in the Extensions
[Fabric status page](../../gonk-extensions/docs/fabric-status.md).

## Ordered roadmap

### R4 — Bind the installed release

**Status:** open  
**Heritage:** existing release-version checks, compatibility probes, Verdaccio
publisher, materialized Codex plugins, and Fabric receipts  
**Cost:** existing release machinery; no new architecture

Produce one receipt that binds:

1. clean immutable Core, Extensions, and Mirk source revisions;
2. packed artifact digests;
3. local-registry versions and integrity;
4. a clean external install;
5. installed modular Codex plugin manifests and dependency versions;
6. fresh-session MCP discovery; and
7. one real capability call through the registered path.

The receipt must distinguish the current modular plugin family from the
disabled legacy suite. Public publication and external deployment are separate
outward gates.

### R7 — Remove the Store compatibility architecture

**Status:** GS-05 partial; GS-06 gated  
**Heritage:** the implemented caller-owned Mirk binding and one-release
migration facade  
**Cost:** breaking cleanup after adoption proof

#### GS-05 — Complete migration evidence

Before deletion:

1. pack the migration release from a clean source revision;
2. install it outside the monorepo;
3. exercise official Pi, Claude, Codex, and Eve composition through installed
   artifacts;
4. record source revision, package version, installed artifact, and runtime
   result;
5. scan current Extensions and named external consumers for legacy Store APIs;
   and
6. obtain consumer-owned migration receipts for every remaining user.

A source scan with no production legacy imports is useful evidence, but it is
not an external-consumer migration receipt.

#### GS-06 — Delete the legacy surface

After GS-05, cut one breaking release that removes:

- `StoreBackend`, `BackendFactory`, and `FsStoreBackend`;
- `createStore`, `resolveStoreDir`, and backend-selection factories;
- `Backed*Store`, `FoldStore`, tail/vector helpers, and duplicate vector types;
- `MirkStoreBackend` and private adapter access;
- default filesystem persistence and implicit legacy import;
- the Store package's native `better-sqlite3` peer; and
- compatibility-only exports, tests, and documentation.

The retained package should bind Gonk scope/namespace policy to caller-provided
Mirk ports. It must not present another generic persistence substrate.

There is no third “still deprecated” release. If GS-05 is incomplete, delay
GS-06 rather than preserving the bridge indefinitely.

### R8 — Make operating evidence legible

**Status:** open  
**Heritage:** Jobs, WorkItems, traces, dispatch receipts, Fabric receipts, and
the studio warm-loop ledger  
**Cost:** bounded observability work

Add:

- a per-extension activity ledger;
- a doctor surface for loaded/unused/silent capability paths;
- a release receipt index;
- no-op and refusal reasons; and
- a repeated-failure scoreboard that can create a work-item predicate.

Do not add another memory store. Learning is complete only when evidence changes
the next action.

### R9 — Reduce delivery fragmentation where it has a measured cost

**Status:** deferred until R4  
**Heritage:** the current modular package/plugin family and disabled suite  
**Cost:** potentially high migration for uncertain benefit

Do not consolidate packages merely to improve the package count. First use R4
to identify actual install, version-skew, startup, or operator costs. Preserve
separate capability ownership where modular delivery is working.

### S1 — First `apps/sigil` Gonk slice

**Status:** gated by Sigil M4 and M5  
**Heritage:** Fabric Release B's Sigil Chat proof and Sigil's shared capability
contracts  
**Cost:** medium after the product gates; premature before them

After Sigil closes its strict web M4 receipt and its M5 three-client batches,
select one ordinary narrow Gonk capability. Prove the public capability
boundary, authorization, durable receipt, cancellation, denial, and normalized
web/iOS/macOS outcome.

Fabric remains a server-side transport choice. Sigil must not gain a second
runtime or capability registry.

## Provider-worker disposition

The current provider worker remains in the llm-service lineage and implements
Gonk execution contracts. Do not create a new sibling repository until a second
real product shows that the deployment code has an independent owner and a
literal shared seam.

## Explicit non-goals

- New Fabric feature breadth before R4.
- A cross-project conformance matrix in Core, Extensions, or Mirk.
- Moving product acceptance into Gonk.
- Moving artifact identity or bytes out of Mirk.
- Deleting Store compatibility APIs before consumer receipts.
- Public publishing, pushing, or external deployment without the separate
  outward decision.

## Adoption gate

This roadmap remains proposed until:

1. an immutable candidate revision is independently reviewed;
2. review findings are resolved or explicitly accepted;
3. an adoption change records the reviewed candidate and adoption date; and
4. the current release-set snapshot is refreshed from immutable source
   revisions.

Implementation work already completed remains evidence. It does not silently
adopt the roadmap.

## Next move

1. Complete R4's exact installed modular-plugin receipt.
2. Complete GS-05 host and external-consumer migration evidence.
3. Execute GS-06 as the breaking Store cleanup.
4. Add R8 operating legibility.
5. Reconsider package consolidation and the first Sigil slice only at their
   stated gates.
