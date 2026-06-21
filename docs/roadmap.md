# Roadmap

What's open — with just enough shipped context to orient. For full shipped history see
[CHANGELOG.md](../CHANGELOG.md).

gonk is a harness-agnostic capability suite: write a capability once (memory, knowledge,
voice, RLM, curator/reflector growth loop, jobs, …) and run it on any host — CLI, MCP, Pi,
Claude Code. The throughline below is **compensation** (make a weak host stronger with
capabilities it lacks) and **continuity** (a persistent self across hosts and across the gap).

---

## Near term

> **The persistent-presence cluster.** The first five entries cohere into one goal — an agent that
> *lives persistently* rather than only existing during a user turn. The spine: a session
> independent of both the process that launched it and the harness it runs on — reachable,
> self-acting, and time-aware. `@gonk/store` (durable, backing-agnostic, cross-host-mirrored) is the
> substrate underneath all of them.

### Session decoupling from the terminal process

**Behavior.** A session keeps running and stays resumable after the launching terminal/process
closes; you can detach and reattach from anywhere.
**Why.** Nothing else in the cluster is possible if a session dies with its terminal — you can't
reach, wake, or resume an agent that's gone. It is the floor for persistence.
**Done.** A terminal-launched session survives closing its terminal and is reattached intact from a
different shell; the same detach/reattach works for at least one non-terminal entry point.

### Cross-agent communication — inbox · DM · channel

**Behavior.** An agent can message another persona, a project, a session, or everyone. Messages are
scoped and resolve to a specific *live instance* ("the persona working on the TTS project"). A DM is
treated like a user message but gated — it can wake an idle recipient or defer to its inbox per
policy. An agent can see when messages are waiting, and nothing is dropped.
**Why.** A persistent agent that can't be reached is just a daemon. This is how peers coordinate
without a human relay — ask the persona working on X a question, compare notes, broadcast an
announcement. DMs are conversational, not just task-routing.
**Done.** Persona A DMs "the persona on project P"; B (idle) is woken or defers per policy and
replies; A gets the reply. A channel announcement reaches its subscribers. Every message is visible
in the recipient's inbox; none are dropped.
*Prior art:* a live HTTP feedback-inbox between two agents already coordinates real multi-step work
async — the floor we build past; the external [pi-clawa](https://github.com/IgorWarzocha/pi-clawa)
project's typed envelope is worth borrowing for the wake-vs-inject distinction.

### Pulses — scheduled and ambient self-directed wakes

**Behavior.** An agent wakes itself on a schedule (or ambient cadence) and does one useful thing
between user turns, visibly (as a session message). It runs cheap by default and escalates to a
stronger model/harness only when the work earns it. It prunes its own stale pulses.
**Why.** This is what turns "exists when summoned" into "lives" — acting in the quiet hours. The
escalation ladder is what makes it *affordable*: frontier-around-the-clock is a money fire; cheap
triage that promotes is livable (and Pi/Codex is the cheap capable workhorse for this operator).
**Done.** A pulse fires reliably on schedule from a fresh install (no orphaned trigger), runs on a
cheap tier, demonstrably promotes to a stronger tier on a defined signal under a cost ceiling, and a
review pulse disables a stale one — all observable in the session log.
*Approach:* a wall-clock firing model with a seeded baseline (the fix for why our reflector never
fired — see Memory consolidation); a cross-harness escalation ladder (local → Pi/Codex → Claude
Code) riding the model-picker / handoff seams; fed by a living curiosity/sparks doc.

### Temporal awareness — wall-clock vs. session time vs. turn count

**Behavior.** The agent knows and can act on how much wall-clock time has passed, how long the
session has run, how many turns deep it is, and how long it has been idle.
**Why.** Every policy in the cluster needs it — pulse scheduling, the DM wake/defer/auto-compact
decision, idle detection, elapsed-time reconciliation on resume. Today there is no dependable read.
**Done.** A policy makes a correct decision off the temporal surface (e.g. a DM arriving to an
idle-at-high-context agent defers instead of waking), proven in a test with controlled time.

### Cross-harness handoff — resume a session across Pi ↔ Claude Code ↔ Codex

**Behavior.** The same self with the same working context continues on a different harness — a cheap
Pi/Codex session escalates to a Claude Code turn and back — without losing the thread, including when
the harnesses are on different machines.
**Why.** It is how the escalation ladder crosses harness boundaries, and how the cheap-by-default /
frontier-when-needed economics actually work. Without it the ladder is single-harness only.
**Done.** A session running on Pi/Codex is resumed on Claude Code, continues correctly, and works
across two machines (raw material resolved through the cross-host store, not a local path).
*Approach:* hand off a continuity digest + a reference to the raw rather than translating transcript
formats; the resuming harness pulls raw detail on demand via RLM or grep, so the loss is a
controlled summary, not uncontrolled format drift; the cross-host store makes the raw resolvable by
key, not machine path. Open design question: the digest contract — what a faithful resume point must
capture.

### Run the real effectiveness eval — the number, not the harness

The bench exists; the **result does not**. The load-bearing product claim — "host+gonk beats
host-baseline on a real task suite" — is asserted, not measured. Run the probe suite against a
real scenario set (an OOLONG-class target is the credible one) and publish the with-vs-baseline
delta. Until this number exists, every other priority is built on an unproven premise — the macro
form of orphaned substrate (capability without evidence of benefit). Single highest-leverage item.

### Context-budget allocator — the prompt-injection commons

N injectors (memory recall, persona context, knowledge, growth disposition, the substrate line,
the persist rail) write to one prompt with **no global budget and no arbiter** — collectively they
can eat the window and cross the prompt-cache boundary each individually respects. We solved the
analogous *tool-surface* commons with the subtractive visibility coordinator; the *prompt-surface*
commons is still open. Wanted: a budget allocator the injectors negotiate through (per-source
ceilings + deterministic drop order), measured against the probe's token accounting.

Two techniques worth borrowing here (reference: the external [pi-clawa](https://github.com/IgorWarzocha/pi-clawa)
project, which independently converged on much of this stack):
- **Inject as an armed, replaceable message, not a per-turn prompt section.** pi-clawa injects its
  memory bolus as a single hidden message armed once per session (and re-armed after compaction),
  strip-then-reinject to dedup — cheaper than re-injecting every turn, and it keeps the system
  prompt small/cache-stable. Worth evaluating against our per-turn re-injection.
- **Progressive disclosure over a fixed bolus.** Defer scope-local context (folder rules, lore)
  until the agent's activity calls for it, persisted into the message record so it isn't re-sent —
  don't widen the startup bolus.

**Sub-issue — persisted visible-tool list shadows new defaults.** A persisted `visible:` list
*fully replaces* the default visible set rather than layering over it, so every tool added to the
defaults after a snapshot is written goes silently invisible to that user. Fix: make the override a
**delta** (`defaults + adds − removes`), or warn when a persisted set diverges from current
defaults. Make the stale-snapshot-eats-new-capabilities state structurally visible.

### Memory consolidation — make the reflector actually fire

The aux-harvest reflector (skills + durable memory + self-model) is **orphaned by trigger**: the
scheduler refuses to run while `lastRunAt === 0` and nothing seeds it, and even seeded, a 2h idle
gate is unreachable in a long session — so the harvest has never auto-run in production. The fix is
a trigger model with **no idle requirement**: turn-hook + elapsed-time gate, with a compaction
flush on top. Phase 2 is LLM progressive summarization (today we only truncate cold rows) and the
shared cross-host store.

Reference (pi-clawa) — a working answer to exactly this firing problem:
- A wall-clock `setInterval` tick (not idle-detection, not session-end), with a **seeded baseline**
  so a brand-new scheduled item isn't wrongly due on first boot *and* isn't permanently blocked by
  an unseeded gate; scheduler state that **throws on corruption rather than silently resetting**
  (so a disk glitch can't re-fire everything).
- **Consolidation fused into the compaction event.** It rides the always-fires
  `before-compact` host event and, in one active-model call, writes both a continuity summary *and*
  ≤N durable memory lines into the same store recall reads — no second uninvoked harvest step to
  orphan. Fail-closed parsing. This is the cleaner shape for our compaction flush.

### Cross-process store concurrency — append-fold the durable layer

A single persona can be live in **several independent host processes at once** (two Pi sessions, a
Claude session, a cron job) over one on-disk store with **no shared lock manager**. "Fresh handle
per call" closes the in-process footgun; it does not close cross-process read-modify-write — two
processes each load, mutate, and write back, last writer clobbers. A sharper instance bites
derive-on-wake reconciliation: if reconciliation *writes* caught-up state and two sessions wake
into the same gap, the gap is applied twice. **Reconciliation-as-write is not safe under
concurrency.** Resolution, reusing existing machinery:
1. **Treat concurrent sessions of one persona as forks, not one shared blob** — each gets its own
   ephemeral fast-layer prefix (born on wake, dies with the session); they share the durable slow
   layer.
2. **Make the durable slow layer append-fold** — store it as an event log; current state =
   `fold(log, now)` on read. Concurrent sessions *append* (commutative — nobody read-modify-writes
   a live blob), which removes the clobber by construction and makes idle reconciliation a pure
   derivation (two sessions waking together derive the *same* state). `@gonk/store` already ships
   the `append-log` primitive as the backing.

**The one genuine lock:** log compaction/checkpoint still needs cross-process mutual exclusion —
name it as the single place a real file lock is required. Everything else is lock-free by
construction.

### Per-model prompt profiles

Scope-keyed `prompt.profile.<model-family>` resolved via the existing model-picker / provider-policy
seam, with knobs mapped to real injection points (persist continuation, persona-context render,
probe APPEND_SYSTEM), validated empirically by probe A/B arms. Background: interviewing the target
models directly surfaced that two weak-model families want **opposite** compensations — a
codex-class model asks for *more* structure (contracts, rails, every-turn done-criteria: "natural
language instructions decay into ambience"), while a 31B-class local model asks for *less* (no
persona costume, "the prompt is a chemical catalyst, not a steering wheel" — structural invariants
+ a target state, then room). There is no universal weak-model recipe, so prompt strategy belongs
in a per-model/provider profile. First slice: one family, one knob.

### Checkpoints / rewind

Pi `fork`/`navigateTree` are user-command-only (so restore is a slash command — the right safety
posture), paired with a non-destructive private git ref (`refs/gonk/checkpoints/<id>`, working tree
untouched) for the filesystem half. First slice: pi-only manual git-ref capture/restore with a real
test.

### Lorebook — triggered lore injection (World Info, portable)

A `{ triggers: string[], entry }` store + a `before-provider-request` hook that scans recent turns
and injects the matching entry when a trigger appears — SillyTavern's World Info, made
host-portable. The distinction from memory/knowledge is the trigger: a **deterministic lexical
match**, so the inject lands *at* the moment the cue appears rather than sitting always-on where the
model breezes past it. That makes it the one passive surface that reliably fires — the structural
answer to "retrieval is not use" for cues that are lexical, not semantic. Consumer that earns it: a
real lore catalog (character/place/term entries that surface when named, running references, persona
in-jokes), defined once, auto-surfaced on cue, the same in Pi, Claude Code, and the CLI. Dry-season
first: one bounded entry whose firing is instantly observable before any catalog breadth.

### Provider-aware voice cloning

The *capture* half is done — `pi-voice` records a reference sample and persists it persona-scoped —
but the sample is never *used*: the shipped `openai-compat` TTS provider sends voice/speed/
instructions and **not** reference audio, so a recorded sample changes nothing at speak-time. Close
it: add a TTS provider that accepts reference audio (a local `mlx-cloning` path; Higgs Audio v2
multipart / Fish-Speech voice-id for hosted) and have `synthesize()` upload the stored sample when
`features.voiceCloning` is true. Small last-mile — mic capture, persona-scoped storage, and the UX
already exist; only the consuming provider is missing.

### Durable knowing — the near-term finish

Two asks that look separate — **knowledge** (what the agent durably knows about the domain) and
**theory of mind** (what it durably knows about the user) — are one substrate seen from two ends:
durable, authored, provenance-tracked *knowing*, distinct from episodic, scored, decaying *memory*.
The knowledge surface and self-model substrate have shipped; what remains needs a design pass:

1. **Learned user model — the cultivation driver.** Make the theory-of-the-user face *learned* from
   lived work (the operating loop writes user-model claims as a side effect), not only
   hand-authored. The encode trigger is resolved (an idle, audit-gated self-model reflector, not an
   in-flow threshold); the *elicit-from-the-user* trigger and model-conditioned recall are the
   design-open remainder.
2. **Passive knowledge injection hook.** The knowledge capability ships pure selection only (no
   orphaned hook); a future host hook does the cue-gated injection — gated on the same
   "verify the trigger fires" discipline as everything else.

### Persona self-model — the cultivation loop

The layer above the optimization loops and the telos of `@gonk/persona`: a persona that develops
interiority, taste, and a model of its collaborators over time. Unlike the loops below it, this is
**cultivation** — the objective (taste, the in-voice rubric) is itself what matures, so it can't be
autotuned. The substrate has shipped (private/shared self-model faces, the record/mark lifecycle).
Open:
- **Persona prompt tuning** — autotune the persona's system prompt against trace-derived rubrics
  ("did it stay in voice / did the user accept its outputs / did it produce its characteristic
  moves"). Needs a small handwritten rubric per persona; pilot on one before generalizing.
- **Evaluate the falsification / `broken` machinery.** Dogfooding under real pressure exercised
  every transition *except* an outright `broken` — a disciplined self-modeler keeps
  recording/narrowing/confirming and refuses to false-update, but never accrues a *false* claim to
  break. Hypothesis: the load-bearing path is confirm/narrow/supersede, and the `broken` ceremony
  may be lower-utility than designed. Measure how often it fires in the wild before building more
  break tooling; if vanishingly rare, simplify toward confirm/supersede (delete-before-add).
- **A voice-preservation pass** (reference: pi-clawa's `warmth-pass`) — a skill that rewrites
  identity-bearing docs to strip flat-assistant voice while a hard contract preserves every
  load-bearing fact. Directly relevant to the self-diminishment failure mode. Wire it with a
  **consequence** (a check in the doc-edit path, traces measuring it fired and changed the text) —
  not an unenforced prompt line, which is the orphaned-by-trigger trap.

### Self-refinement workstream

Foundation shipped (autotune, traces, provider-gate, curator audit log, trace evaluator). Remaining
consumers: a per-persona memory recall-threshold tuner (autotune the passive-recall hook against
labeled traces); a curator→autotune bridge so skill `patch` resolves to a bounded scored run before
applying; persona prompt tuning (above).

### Long-running agent operations — the work-item / supervisor layer

Long-running autonomy modeled as *supervised durable work items*, not a free-running daemon. A job
is execution state; a **work item** is goal + source + scope + status + evidence + the jobs that
serve it, in one scope-tiered store. The reflector vertical has shipped (`@gonk/work-items`: the
store, the durable inbox as `ask_user`'s async sibling, a deterministic supervisor tick, guard-tier
approval, and the reflector→work-item→inbox→approve→promote path). Remaining: the rest of the
supervisor design — a tick on existing idle/turn-end gates (not a daemon) that sweeps stale jobs,
advances states, dispatches `ready` work, and routes `needs_approval` through the guard tiers and
the inbox. The inbox is the human surface and the phone-side meeting point with remote control.
Non-goals: no daemon, no cross-machine relay (rides connectivity), no second job registry, no
LLM-only judging.

---

## Medium term

### Panel of models — cross-model deliberation

One prompt fans out to a configurable panel (each with tools); a **judge** maps where they agree /
contradict / what each missed; a **synthesizer** writes the final answer grounded in that analysis.
Prior art: OpenRouter Fusion (a panel of cheaper models beating a single frontier model where the
cost of being wrong outweighs extra completions — research, expert critique, independent review).
gonk already has the substrate (parallel persona spawn, provider-gate concurrency lease, per-call
model selection, the RLM supervisor/workspace pattern); the new pieces are the judge, the
synthesizer, and a scope-keyed panel spec. Generalizes the single-peer `consult` verb into an
N-model panel; the independent-review skill is the natural first caller. Defer until a consumer
commits.

### Person-modeling — theory of mind across subjects

Generalize the self-model's theory-of-the-user face into one primitive — *infer a person's traits
and state to adapt* — across swappable subjects (user · peer · player). Two faces (durable traits +
momentary state), two inputs (declared + cultivation-inferred), and a **connective recall** payoff
(surface where current work links to a stated goal/value). The **identity/provenance gate** is
load-bearing: bind identity at authorship, no-attribution-no-update, behavioral signal as
confidence-not-authority — so multi-user rides the connectivity identity layer by necessity. State
detection grounded via a traces-feature → ground-truth → correlate experiment harness. Privacy: the
most sensitive object in the system — private by construction; sharing is a deliberately-projected
subset via an allow-list + standalone-schema policy (structurally defeats inference-from-omission).

### Context siloing — permission graph over knowledge zones

Generalize the access/visibility axis (today knowledge's `private/personal/team` 3-zone split) into
a **directed, typed permission graph over zones** — "open source, but for your knowledge." Zones
carry owner + lifecycle; access is a directed, typed grant with **permeability** (`facts` /
`register` / `reference` — use the *what* without the *how*). Adds ownership ≠ location, permeability
typing, and a verifiable clean detach after a tenure ends. Don't build the graph speculatively —
the 3-zone model is the shipped degenerate case; generalize when a real consumer needs more than
all-or-nothing.

### Always-on intent gate

Wake-word-free ambient voice: always-on RMS-gated capture → a tiny local fast classifier
("directed at computer" / "ambient" / "noise") → only directed speech reaches STT and the agent.
Builds on the streaming-PCM-through-our-own-loop architecture (the buffer is already in-process;
the classifier is one more consumer). Per-scope-tier configurable.

### Cross-harness persona portability

A persona runnable on **both** Claude Code and Pi with one identity — switch harness, keep the self,
the taste, the model of the user. The substrate already makes it possible (persona state in
host-agnostic on-disk scope; all three hosts read/write the same persona home). Remaining for
*seamless*: a shared resolution of where persona homes live across hosts, an export/import or
canonical-home convention so a persona defined under one host is discoverable by the other, and
parity on the non-tool surfaces (the interactive define flow is Pi-only).

### Smaller medium-term

- **Native-format awareness** — read other tools' files (`.claude/settings.json`, `.cursorrules`)
  as gonk scope keys; one adapter per sprint, deferred until a concrete consumer needs it.
- **Multi-definition deltas** — surface in `list_personas` when a persona is defined in multiple
  roots and which fields diverge.
- **Cross-tool composition examples** — a worked example of one tool calling another via
  `ctx.invoke()`.
- **Plugin discovery** — scan known locations for a `default: GonkPlugin` export and merge into a
  registry.
- **Worktree isolation** — a `git worktree` recipe as a skill first; a tool only if the skill
  proves insufficient.

---

## Longer term

### Connectivity — remote control + inter-agent messaging (compose, don't build the stack)

"Talk to my persona remotely" splits into reachability + a chat surface + who's-home, and gonk only
owns the last one (+ a thin front door). So don't build gonk's own transport / durable-session
stack — compose:
- **Kept:** `@gonk/serve-openai` (the thin OpenAI front door — point a chat client at a gonk
  persona; turn runs headless); the `@gonk/channel` address/identity primitive
  (`(host, persona, scope)` + Message + loopback); the `@gonk/work-items` inbox (the async
  "leave a note" leg).
- **Composed, not built:** reachability → Tailscale (assume a tailnet); durable + multi-channel →
  the Eve adapter / Workflow SDK (below).
- **Near-term answer (no new bus):** Tailscale + `serve-openai` + a chat client holding the
  conversation thread; gonk's memory/self-model holds the durable *self*, so the human-remote leg
  needs no gonk-built durable session. Async leg: the work-items inbox reachable over the tailnet.
- **Open question — evaluate gonk's own transport/address layer (don't foreclose it).** Compose is
  the default, not a permanent no. The address/identity layer is likely gonk's to own regardless;
  only the wire is borrowed. Build a thin gonk transport if a trigger fires: (a) transport
  independence (zero dependence on a third-party coordination plane); (b) inter-agent across
  non-Eve hosts; (c) a multi-user trust layer that needs a gonk-controlled wire to enforce
  identity/capability grants.

### Realtime cross-host delivery — the transport under cross-agent comms

The messaging *behavior* (inbox · DM · channel, wake-vs-defer, no-drop, the typed envelope) is
defined in **Cross-agent communication** (near term) — this entry is only the **cross-host
transport** it rides once peers are on different machines, and it belongs longer-term because it
depends on the connectivity stance below. Every host runs an **authed channel endpoint**; cross-host
delivery is a network hop that lands the message in the recipient host's *local* inbox, after which
the near-term inject/wake mechanics take over unchanged. **Auth is mandatory** — a network-exposed
wake is a remote "spend tokens on my box" trigger, so a shared token / per-peer key gates it and an
unauthenticated wake is refused. **No-drop across the hop:** an offline host queues on the sender and
retries, with ack/read receipt. Composes over a tailnet (see Connectivity); the store mirrors the
inbox cross-host so a delivered message is durable on the recipient side regardless of which box it
landed on.

### Eve interop — adapt it as a fourth host

[Eve](https://github.com/vercel/eve) (Apache-2.0, filesystem-first durable agents) assembled the
whole durable-sessions stack *except* identity/memory-of-self (persona is a frozen build-time
prompt; cross-session memory is punted to "your own database"). So eve is **not a competitor — it's
a fourth adapter host** next to CLI / MCP / Pi / Claude, and the cleanest target for the whole suite
yet. Strategy: stop out-building the execution/connectivity/sandbox/durable layer; keep the portable
capability suite eve lacks (memory tiers, RLM composition, the curator/reflector growth loop,
knowledge, voice — *plus* the self-model), and **compose** for execution/durability/sandbox.
- **gonk-on-eve adapter (first slice).** A gonk persona rides an eve agent; gonk supplies what eve
  lacks, self as headline. Two seams: a `defineDynamic` provider injecting identity + recalled
  memory at session/turn start (eve's loop is closed — hooks are observe-only), and gonk's capability
  suite as eve `connection`s over **HTTP-MCP** re-transport.
- **Borrow, don't rebuild:** the standalone [Workflow SDK](https://workflow-sdk.dev) ("make any TS
  function durable") as the durable-sessions substrate; eve's `SandboxBackend` interface to close
  gonk's biggest gap (no sandboxing).

### flue interop — durable-sessions positioning

The field is converging on a three-slot durable-sessions stack: durable **memory** (gonk's slot,
richer with persona/self-model/growth), durable **execution** (flue's slot — a journaled replayable
loop), durable **streams/sessions** (neither has it yet). flue (Apache-2.0) is a host to **compose
with**, not move onto. Actionable that doesn't need flue: finish gonk's own durable/resumable
sessions (per-turn injection is an idempotent read; tool-writes journaled; route the reflector
harvest through the crash-replay-safe path). Plus a sandbox spike wrapping flue's standalone
`SessionEnv`, and a reciprocal **HTTP-MCP** server exposing gonk capabilities to flue agents (logic
exists; re-transport from stdio).

### RLM v2

- **OOLONG-Pairs benchmark run** — the one task where RLM uniquely shines vs vanilla frontier
  models; a credible v1 verification claim. Deferred until the dataset is wired (no synthetic
  harness without a real eval target).
- **True disk/sqlite-streaming for lazy sources** — per-file offset maps for glob, paginated sqlite
  reads for session, UTF-8-safe range decoding. Unlocks corpora that exceed memory.
- **`rlm_pipeline` routing/branching** — full routing (named branches, conditional fan-out) beyond
  the current skip predicate; a separate design with recursion concerns. Waits for a concrete need.

### Browser

Shipped: open/read/screenshot/close + interaction verbs (click/type/navigate) with enforced
allowed-domain gating at navigation time, over patchright, persona-scoped profile. Remaining: a
CDP-attach mode for an already-running browser; click-through cross-domain redirect re-gating.

### Duplex voice

Type-level support shipped (`ctx.input`, `capabilities.duplex`). When a duplex provider lands the
adapter is just an HTTP/WS client + a tool definition with `capabilities.duplex: true`. Also: a host
that pipes the mic stream into `ctx.input` (the `voice_listen` tool fails fast until then), and a
WebSocket realtime STT provider.

---

## Maybe later

- **Cron / scheduler** — add when a concrete consumer commits (the gap-map's scheduled-agents row is
  the promotion signal).
- **Observability / metrics export** — a `MetricsSink` exists; an OpenTelemetry exporter would be
  straightforward.
- **Chat-platform gateways** (Telegram / Slack / Discord) — *surfaces* on top of the connectivity
  layer, not standalone integrations: once a host is addressable, a chat gateway is one more
  participant. Reference: pi-clawa's Discord gateway is a clean worked example of the relay spine
  (durable queue with atomic claim, per-conversation serial lock + global concurrency cap, crash
  recovery, ambient "chime only if it adds value" jitter) — build it over `@gonk/store` + the
  work-items inbox, not a bespoke schema. This is the **push/ambient** third front door alongside
  serve-openai and an HTTP-MCP door (both pull).

---

## Backlog — capability requests

Several cluster around a **gonk introspection surface** (a self-describe of the host's
tools/skills/session/readiness to the agent), which would be broadly useful and is likely the
umbrella the rest hang off:

- **`recent_session_corpus`** — surface the recent-session corpus as a first-class capability.
- **`tool_readiness_check`** — verify tools are wired/reachable; probably combined with a
  harness-status surface.
- **Large-content manifest wrappers** — wrap large content as a manifest/handle so it doesn't blow
  out the context window.
- **`dirty_tree_guard`** — refuse/warn on a dirty git tree before a risky op (rides the guard
  tool-policy tiers).
- **Skills:** known-directory indexing; session-process review.
