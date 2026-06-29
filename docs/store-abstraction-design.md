# Store abstraction — design

> Status: **implemented.** Shipped as `@gonk/store` (core, `0.0.10`; `KvStore.entries()` added `0.0.11`)
> and consumed by the capabilities built on it. All three implementation
> tiers in §7 landed; §4.2's relational extraction was built **in full** (memory triples + sessions,
> knowledge, traces — each behind a capability-local interface with sqlite as the default impl and a
> non-sqlite in-memory second impl proving the seam). §5's three-question standard and §6's usage
> telemetry remain conventions/roadmap, not yet enforced/built. One behaviour emerged during the
> migration that this design did not anticipate and is worth recording — see the **Migration note** below.
> Scope: a persistence layer in `@gonk/core` (extending scope) + a migration of the
> extension capabilities onto it. Also defines the repo's layer map and the
> three-question description standard, which the repo nowhere spells out today.

> **Migration note (emerged in Tier 3 S2).** Moving memory's KV (`kv.db`) and curated bodies
> (`curated.md`/`user.md`) onto the store changed both the substrate *kind* (`memory` → `store`) and
> the on-disk *format*, so an existing install would silently lose its memory on upgrade. The fix is a
> one-time **legacy carry-forward**: on the first store-handle build per `(tier, home)`, any
> pre-migration data is imported into the new store — idempotent (a `.legacy-imported` marker),
> non-clobbering (a key/blob the new store already holds is never overwritten; post-cutover writes
> win), and litter-free on fresh installs (absent the legacy file it no-ops). The general rule this
> bought, for any future backing move: a layout/format change is **data-loss-on-upgrade** until the
> old data is carried forward (or a tested, documented breaking cutoff is declared). The universal
> `FsStoreBackend` already migrates the `.gonk/` → `.agents/` *path* shift transparently; only a
> *kind-or-format* change needs an explicit importer like this one.

## 1. Why this exists

gonk capabilities persist state by reaching *past* the scope system straight to the
filesystem — opening `better-sqlite3`, writing JSON/JSONL at paths they assemble
themselves. Two problems follow:

1. **Path drift.** A capability that hardcodes a path ignores that scope already
   resolves a canonical, `.agents/`-preferring home (with `.gonk/` kept only as a
   legacy fallback that gets migrated). Concretely: `pi-rlm` writes
   `${env.cwd}/.gonk/rlm/{cache,runs}` (`packages/plugins/pi-rlm/src/index.ts:197,206,391`)
   while its own sibling `workspace-root.ts` correctly resolves through
   `@gonk/scope`'s `resolveSessionHome`. The result is rogue `.gonk/` directories
   sitting next to the `.agents/` the system actually recognizes.
2. **Backing lock-in.** A capability that opens `better-sqlite3` directly *is* its
   storage decision — it cannot move to a different backing (a remote db, an
   in-memory store for tests, a managed vector index) without rewriting the
   capability.

One rule fixes both: **capabilities persist through a store the foundation
provides, never through a path they assemble.** The store owns *where*
(scope-tier, `.agents`-preferring) and *what backing* (fs today, swappable later);
the capability owns only its data and its access pattern.

## 2. The persistence surface (audit)

Across the ~20 state-writing packages there are exactly five backing shapes:

| Shape | Who needs it | Abstracts cleanly? |
| --- | --- | --- |
| **KV** — keyed records, get/put/patch/list, optional TTL | jobs, work-items, rlm-cache, persona self-model, reflector + self-model-reflector state, memory-kv, skill-creator manifests | yes |
| **Blob** — opaque files (portraits, reports, supporting files) | persona, curator, reflectors, skill-creator, memory-curated | yes (scope already has blob) |
| **Append-log** — JSONL append + scan/filter/read-at | curator audit, self-model-reflector audit, traces records, rlm traces, memory sessions | yes |
| **Vector-KNN** — upsert + similarity search | memory (session embeddings) | yes (pluggable backend) |
| **Document / SQL** — indexed WHERE, FTS5 BM25, bitemporal, supersession | memory (triples + session FTS), knowledge (FTS5 + supersession), traces (index), insights | **no — resists a thin abstraction** |

Two findings shape everything below:

- **Path resolution is ~90% already correct.** memory, knowledge, curator, persona,
  reflectors and skill-creator resolve through scope (`substrateDir` /
  `scopeStateHome` / `resolveTierHomes`) and already prefer `.agents/`. The outliers
  are `pi-rlm` (hardcoded `.gonk/rlm`) and the `root`-parameter takers (jobs,
  work-items, traces) whose plugin must resolve that param through scope. The rogue
  `.gonk/` problem is small and surgical, not systemic.
- **`insights` already solves the hard case.** It stores nothing — it declares an
  abstract `InsightsDb` interface ("sessions since T", "tool counts since T") and the
  host implements it. That is dependency inversion, and it is the answer for every
  Document/SQL shape: the capability declares the narrow query interface it needs;
  a backend implements it.

## 3. Layer model

The repo has four layers; only the names need tightening (`framework/` → `platform/`,
because `extension-spec` — now in core — *is* the framework you author against, so a
sibling dir called `framework/` is actively confusing).

```
core         scope · tool-registry · tool-orchestrator · adapters · extension-spec
               + the store (this doc)                     ← the foundation + authoring framework
  ↑
platform     persona · store-backed services · scheduler · provider-gate · pi-aux-client
               shared services the capabilities are built on (NOT features)
  ↑
capabilities rlm · memory · knowledge · traces · embedding · curator · reflector · …
               host-agnostic features: what the agent can DO
  ↑
plugins      pi-* · claude-* · cli
               host adapters: wire a capability into one host's tools/commands
```

- **`persona` moves `capabilities/` → `platform/`.** It is not a feature — it is
  infrastructure the features orbit (memory resolves "the active persona's tier"
  through scope's injected `resolvePersonaHome`, which persona supplies). Same
  category as `scheduler` / `provider-gate`.
- **The store's universal primitives live in `core`, extending scope** (decided):
  scope already does blob + KV with `.agents`-preferring resolution; the store
  generalizes exactly that. A typed scoped store is reusable outside the gonk domain,
  which is core's bar.

## 4. The store

### 4.1 Universal primitives (in `@gonk/core`, extending scope)

Four backing-agnostic interfaces, each obtained from a factory keyed by
`(scope-tier, namespace)`. The factory resolves the location through scope's
substrate resolution (prefers `.agents/`, falls back to legacy `.gonk/`, migrates) —
**the capability never sees a path.**

```ts
const kv   = store.kv<T>(tier, namespace);     // get/set/patch/delete/list, optional ttl
const blob = store.blob(tier, namespace);      // put/get/delete/list (generalizes scope blob)
const log  = store.log<R>(tier, namespace);    // append/scan(filter)/readAt — JSONL today
const vec  = store.vector(tier, namespace);    // upsert/search(vector,k,filter)/delete
```

Each store type delegates to a **backend SPI** — a `StoreBackend` interface with a
default `FsStoreBackend` that reproduces today's behavior (atomic temp+rename writes,
JSONL append, sqlite-vec for vectors). A future `SqliteStoreBackend` /
`RemoteStoreBackend` implements the same SPI; "swappable backing" for the universal
shapes is delivered by substituting the backend, with no capability change.

### 4.2 Relational domains (capability-local interfaces)

The Document/SQL shapes are **not** forced into the universal store. Each capability
declares the narrow query interface it needs — the `InsightsDb` pattern — and ships a
default implementation; the capability depends on the *interface*.

```ts
// in @gonk/knowledge
interface KnowledgeIndex {
  upsert(page: Page): void;
  searchByText(q: string, k: number): RankedPage[];   // BM25
  byCategory(cat: string): Page[];
  supersede(id: string, next: Page): void;             // keep history, mark superseded
}
// in @gonk/memory
interface TripleStore {
  assert(t: Triple): void;            // inserts + invalidates priors
  invalidate(match: TripleKey): void;
  asOf(subject: string, t: number): Triple[];          // bitemporal point-in-time
}
// in @gonk/traces  → TraceIndex: queryByFilter(persona, session, tool?, range, label?)
```

This is the honest line: KV/blob/log/vector get one real universal store; bitemporal
WHERE + FTS5 BM25 + supersession get injectable interfaces, because a key-value store
cannot also be a temporal query engine without exposing SQL (then it is not
backing-agnostic) or forcing every caller to load-all-and-filter-in-JS (a slow,
index-less database reinvented per extension).

## 5. The three-question description standard

Every **capability** and **plugin** README (the agent-facing layers) must answer:

1. **What it is in plain English, and why it deserves to exist** — the problem it
   solves that nothing else does.
2. **Who interacts with it and how** — and *if it is the agent, how it is made
   visible to them*: which tool surfaces it, visible-by-default vs on-demand
   (`find_tools`), which skill teaches it, what persona-context mentions it.
3. **How frequently it is meant to be used** — every turn / on a trigger / once per
   session / rarely-on-demand.

This is the knowing-layer principle turned into a required description *shape*: you
can audit orphaning from the README alone — is it justified (Q1), can the agent reach
it (Q2), does it actually fire (Q3). Platform/core packages answer a code-facing
variant (who = which capabilities depend on it; how often = on every X). Candidate
for a lint (`description must answer Q1–Q3`), same spirit as `pnpm dead-substrate`.

## 6. Roadmap: usage telemetry → curator

The empirical counterpart to §5. The three-question standard is the *declared*
cadence; usage telemetry is the *observed* cadence; the curator comparing them makes
gonk's recurring failure — orphaned-by-trigger / retrieval-is-not-use —
**auto-detectable** ("you declared this fires every turn; it has fired zero times in
200 sessions").

A separate, local-first capability — never phones home; the operator's lens, not the
agent's.

It is **not** a pure rollup/static-analysis over `traces`. A trace log is
tool-call-centric, but the orphan we most want to catch is *orphaned-by-trigger*, and
a trigger that never fires (an idle reflector, a session-end curator pass, a passive
injection) leaves **no tool-call to roll up**. So telemetry needs a thin
**instrumentation surface other extensions integrate with** — each emits a
firing/skip signal at its trigger points ("trigger evaluated → fired / skipped, with
reason") — which a static read of `traces` cannot reconstruct. Two complementary
signals feed the curator: the `traces`/`insights` rollup for *tool* usage, and the
opt-in firing instrumentation for the *trigger/lifecycle* surface. Read-before-design
still holds for the tool half — do not duplicate what `traces` already records — but
the trigger half is a genuinely new signal, which is why this is its own extension
with an integration point rather than a dashboard.

## 7. Implementation tiers (after sign-off)

1. **Path fixes (no new abstraction).** Route `pi-rlm`'s `.gonk/rlm/{cache,runs}`
   through scope; confirm jobs/work-items/traces' plugins resolve their `root` param
   via scope. Stops the rogue `.gonk/` dirs immediately.
2. **Store primitives in core.** Implement KV/blob/log/vector + the `StoreBackend`
   SPI + the `FsStoreBackend` default, extending scope's resolution. Real tests on
   real disk.
3. **Migrate capabilities.** Move each KV/blob/log/vector user onto the store; lift
   the Document/SQL users behind their capability-local interfaces (default impls
   unchanged, just inverted). Backfill the §5 three-question descriptions as we go —
   any package whose Q2/Q3 can't be answered is a real orphan finding.

## Decisions on the open questions

- **`platform/` absorbing `jobs` / `work-items`** — leave both in `capabilities/` for
  now; do not reorganize on speculation. `jobs` is the platform candidate to watch
  (it is background-execution infra other capabilities already lean on — e.g. pi-rlm's
  detached-query runner); promote it only when a *second* capability clearly depends
  on it. `work-items` is more feature-shaped (operator-facing durable work + inbox) and
  stays a capability.
- **Three-question standard as a lint** — convention first, lint later. The lint can't
  enforce descriptions that don't exist yet; the migration (§7.3) writes them, then a
  `description must answer Q1–Q3` check enforces them, same spirit as
  `pnpm dead-substrate`.
- **Telemetry shape** — settled in §6: an instrumentation surface extensions integrate
  with (firing/skip signals) *plus* a `traces` rollup for tool usage, not a static
  rollup alone. The trigger/lifecycle half is a new signal, so it earns its own
  extension.
