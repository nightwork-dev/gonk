# Roadmap

What's open — with just enough shipped context to orient. For full shipped history see
[CHANGELOG.md](../CHANGELOG.md).

gonk is a harness-agnostic capability suite: write a capability once (memory, knowledge,
voice, RLM, curator/reflector growth loop, jobs, …) and run it on any host — CLI, MCP, Pi,
Claude Code. The throughline below is **compensation** (make a weak host stronger with
capabilities it lacks) and **continuity** (a persistent self across hosts and across the gap).

## How this roadmap works

Every item has a **stable `GR-NN` ID** (never renumbered or reused — a reference survives the item
moving repos) and an **Area** tag: `core` (a substrate package — extension-spec, scope, store,
channel, temporal, tool-registry/orchestrator) or `ext` (a capability or host plugin in
gonk-extensions). The split is metadata you filter on, not a separate file. Mixed items split into
`GR-NNa` (core primitive) + `GR-NNb` (ext capability). Reference items by ID across repos/commits/bus
(the way deadletters uses `FR-2` / `#10`).

| ID | Title | Area | Pkg | Horizon | Status |
| --- | --- | --- | --- | --- | --- |
| GR-02a | Channel address/identity primitive | core | @gonk/channel | near | shipped |
| GR-01 | Session decoupling | ext | @gonk/harness-run (infra) | near | partial · harness-run spawn/tmux infra shipped; full detach/reattach session UX remains |
| GR-02b | Cross-agent communication | ext | @gonk/comms, @gonk/pi-comms | near | partial · DM/inbox/presence shipped (defer-only delivery); active peer-wake (wake an idle recipient) flagged NEXT (2026-06-28); channels/broadcast/cross-host remain |
| GR-03 | Pulses | ext | @gonk/pi-pulses | near | partial · rung-0 pulse engine shipped; escalation/pruning ladder remains |
| GR-04 | Temporal awareness | core | @gonk/temporal | near | shipped |
| GR-05 | Cross-harness handoff | ext | @gonk/handoff, @gonk/claude-handoff, @gonk/pi-handoff | near | partial · Pi→Claude handoff tooling shipped; round-trip/cross-machine remains |
| GR-06 | Run the real effectiveness eval | ext | @gonk/pi-probe (program) | deferred | deferred |
| GR-07 | Context-budget allocator | ext | @gonk/pi-introspect (+ injectors) | near | partial · introspection/tool-visibility shipped; prompt-budget allocator remains |
| GR-08 | Memory consolidation | ext | @gonk/reflector, @gonk/memory | near | partial · turn-hook reflector/work-item path shipped; compaction/progressive consolidation remains |
| GR-09 | Cross-process store concurrency | core | @gonk/store | near | partial · append-fold/log-tail shipped; compaction lock remains |
| GR-10 | Per-model prompt profiles | ext | @gonk/model-picker, @gonk/pi-provider-policy | near | partial · model picker/provider policy shipped; prompt-profile injection remains |
| GR-11 | Checkpoints / rewind | ext | pi (fork/navigateTree) + git ref | near | open |
| GR-12 | Lorebook | ext | (new capability) | near | open |
| GR-13 | Provider-aware voice cloning | ext | @gonk/pi-voice, @gonk/voice-tts | near | partial · voice sample capture/pin shipped; consuming clone-capable TTS provider remains |
| GR-14 | Durable knowing | ext | @gonk/knowledge, @gonk/persona | near | partial · knowledge/self-model/passive-injection evaluator shipped; live hook/autotune remains |
| GR-15 | Persona self-model | ext | @gonk/persona | near | partial · self-model store/tools/injection shipped; cultivation loop tail remains |
| GR-16 | Self-refinement workstream | ext | @gonk/autotune, @gonk/traces, @gonk/curator | near | partial · autotune/traces/curator bridge shipped; live closed-loop tuning remains |
| GR-17 | Long-running agent operations | ext | @gonk/work-items, @gonk/reflector | near | partial · work-items/inbox/attention_read shipped; supervisor dispatch sweep remains |
| GR-43 | Unified recall surface | ext | @gonk/recall (new) | near | partial · recall_read shipped + host-wired |
| GR-47 | [Claude Code comms participant parity + presence layer v0](../../docs.local/cc-comms-participant-presence-spec.md) | ext | @gonk/comms, @gonk/pi-comms, Claude wrapper | near | partial · Claude comms MCP/presence slice shipped; full parity remains |
| GR-49 | [Comms layer canonical design — addressing, delivery, external parties, work custody](../../docs.local/comms-layer-design-spec.md) | ext | @gonk/comms, @gonk/pi-comms, @gonk/work-items, @gonk/handoff, @gonk/jobs | near | design |
| GR-50 | [Phone reach delivery — `:via` onto `@midnight/notify`](../../docs.local/phone-reach-delivery-spec.md) | ext | @gonk/comms, @gonk/authz, @gonk/voice-tts, @midnight/notify, @gonk/reach(-signal/-matrix) | near | partial · @gonk/reach + reach-signal on working tree (Signal egress live, receipt-confirmed, ~61 tests); reach-matrix + authz Matrix-policy in progress; ingress parser + account-link remain |
| GR-51 | Persisted tool-visibility delta | ext | @gonk/pi-introspect | near | shipped |
| GR-52 | Interface scaffold — socket-connected UIs on extensions | ext | (new interface-kit) + tool-registry adapters | med | open |
| GR-53 | Agent-authored React playground — live preview + static export | ext | (new playground) | med | open |
| GR-54 | Codex adapter — detect + wrap Codex MCPs into gonk's ecosystem | ext | (new codex-adapter) + tool-registry import | med | open |
| GR-55 | Ownership / RACI — accountability facet (extract when pulled) | ext | work-graph inline → future @gonk/ownership | med | open |
| GR-56 | Cross-harness capability invocation — call any harness from any extension | ext | (new harness-call) + claude/codex/pi-dispatch | med | open |
| GR-57 | Memory bridge — claude-memory works with Claude-native memory AND gonk's | ext | claude-memory + @gonk/memory + @gonk/recall | med | open |
| GR-48 | [Persona self-lifecycle — request reload/restart/compaction](../../docs.local/persona-self-lifecycle-spec.md) | ext | Pi harness, @gonk/persona, @gonk/work-items | near | design-pending |
| GR-46 | [Tmux session tools — human attach-to-any-agent (incl. ephemeral sub-agents)](../../docs.local/tmux-session-tools-spec.md) | ext | Claude wrapper, @gonk/pi-comms | near | design-only · spec exists; no attach-to-any-running-agent tools found |
| GR-44 | Async multi-agent execution — async delegates + design tail | core+ext | comms, work-items, jobs, rlm, pi-subagent | med | partial · async RLM, tmux dispatch, wake coalescing, and delegation hardening shipped |
| GR-18 | Panel of models | ext | @gonk/rlm | med | open |
| GR-19 | Person-modeling | ext | @gonk/persona | med | open |
| GR-20 | Context siloing | ext | @gonk/knowledge | med | open |
| GR-21 | Always-on intent gate | ext | @gonk/voice-stt | med | open |
| GR-22 | Cross-harness persona portability | ext | @gonk/persona (+ @gonk/scope) | med | open |
| GR-23 | Native-format awareness | core | @gonk/scope | med | open |
| GR-24 | Multi-definition deltas | ext | @gonk/persona | med | open |
| GR-25 | Cross-tool composition examples | core | @gonk/tool-orchestrator | med | open |
| GR-26 | Plugin discovery | core | @gonk/core | med | open |
| GR-27 | Worktree isolation | ext | (skill) | med | open |
| GR-28 | Connectivity | ext | @gonk/serve-openai, @gonk/work-items (+ @gonk/channel) | long | open |
| GR-29 | Realtime cross-host delivery | ext | @gonk/comms (+ @gonk/channel endpoint) | long | open |
| GR-30 | Eve interop | ext | (suite-on-eve; core stake = host-adapter seam) | long | open |
| GR-31 | flue interop | ext | (composition; @gonk/tool-registry-mcp) | long | open |
| GR-32 | RLM v2 | ext | @gonk/rlm | long | open |
| GR-33 | Browser | ext | @gonk/browser | long | open |
| GR-34 | Duplex voice | ext | @gonk/voice-stt, @gonk/voice-tts | long | open |
| GR-35 | Cron / scheduler | ext | @gonk/jobs | maybe | open |
| GR-36 | Observability / metrics export | core | @gonk/core (MetricsSink) | maybe | open |
| GR-37 | Chat-platform gateways | ext | (connectivity surface) | maybe | open |
| GR-38 | recent_session_corpus | ext | @gonk/pi-introspect | backlog | open |
| GR-39 | tool_readiness_check | ext | @gonk/pi-introspect | backlog | open |
| GR-40 | Large-content manifest wrappers | ext | (capability) | backlog | open |
| GR-41 | dirty_tree_guard | ext | @gonk/pi-guard | backlog | open |
| GR-42 | Skills: | ext | @gonk/skill-creator | backlog | open |

---

## Near term

> **The persistent-presence cluster.** The first five entries cohere into one goal — an agent that
> *lives persistently* rather than only existing during a user turn. The spine: a session
> independent of both the process that launched it and the harness it runs on — reachable,
> self-acting, and time-aware. `@gonk/store` (durable, backing-agnostic, cross-host-mirrored) is the
> substrate underneath all of them.

### GR-01 · Session decoupling from the terminal process

**Area:** ext · **Pkg:** @gonk/harness-run (infra) · **Horizon:** near · **Status:** partial · harness-run spawn/tmux infra shipped; full detach/reattach session UX remains

**Behavior.** A session keeps running and stays resumable after the launching terminal/process
closes; you can detach and reattach from anywhere.
**Why.** Nothing else in the cluster is possible if a session dies with its terminal — you can't
reach, wake, or resume an agent that's gone. It is the floor for persistence.
**Done.** A terminal-launched session survives closing its terminal and is reattached intact from a
different shell; the same detach/reattach works for at least one non-terminal entry point.

### GR-02b · Cross-agent communication — inbox · DM · channel

**Area:** ext · **Pkg:** @gonk/comms, @gonk/pi-comms · **Horizon:** near · **Status:** partial · DM/inbox/presence shipped (defer-only delivery); active peer-wake (wake an idle recipient) flagged NEXT (2026-06-28); channels/broadcast/cross-host remain · **Depends:** GR-02a

**Split — core primitive `GR-02a` (the `@gonk/channel` address/identity layer, stays in core) + this entry `GR-02b` (the inbox/DM/channel *behavior* over it, extensions).**

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

**Gap — active peer-wake (flagged NEXT, 2026-06-28).** Delivery is currently **defer-only**: `message_send` (incl. the `claude-comms` wrapper) lands durably in the recipient's inbox and surfaces on their *next turn*, but cannot actively wake an **idle peer** now — the tool itself says "Slice 1: defer-only … waking an idle peer ships next." The self-wake substrate (a job waking its *own* originating session, via `pi-comms` `WakeLoop` + job-watch) shipped; what remains is routing a peer DM with `intent: reply_requested`/wake-policy through that same wake path so an idle *recipient* is interrupted (subject to the originator-scoped wake rules from the 2026-06-27 work — don't auto-wake non-originators). Hit live 2026-06-28: a relay to an idle peer delivered to inbox but could not wake it. This is the next near-term slice.
*Prior art:* a live HTTP feedback-inbox between two agents already coordinates real multi-step work
async — the floor we build past; the external [pi-clawa](https://github.com/IgorWarzocha/pi-clawa)
project's typed envelope is worth borrowing for the wake-vs-inject distinction.

### GR-03 · Pulses — scheduled and ambient self-directed wakes

**Area:** ext · **Pkg:** @gonk/pi-pulses · **Horizon:** near · **Status:** partial · rung-0 pulse engine shipped; escalation/pruning ladder remains

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

### GR-04 · Temporal awareness — wall-clock vs. session time vs. turn count

**Area:** core · **Pkg:** @gonk/temporal · **Horizon:** near · **Status:** shipped

**Behavior.** The agent knows and can act on how much wall-clock time has passed, how long the
session has run, how many turns deep it is, and how long it has been idle.
**Why.** Every policy in the cluster needs it — pulse scheduling, the DM wake/defer/auto-compact
decision, idle detection, elapsed-time reconciliation on resume. Today there is no dependable read.
**Done.** A policy makes a correct decision off the temporal surface (e.g. a DM arriving to an
idle-at-high-context agent defers instead of waking), proven in a test with controlled time.

### GR-05 · Cross-harness handoff — resume a session across Pi ↔ Claude Code ↔ Codex

**Area:** ext · **Pkg:** @gonk/handoff, @gonk/claude-handoff, @gonk/pi-handoff · **Horizon:** near · **Status:** partial · Pi→Claude handoff tooling shipped; round-trip/cross-machine remains

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

### GR-06 · Run the real effectiveness eval — the number, not the harness

**Area:** ext · **Pkg:** @gonk/pi-probe (program) · **Horizon:** deferred · **Status:** deferred

> **Deferred 2026-06-24:** do not run or propose this eval until the system
> *feels right* for both of us. We are still in unification work, not measurement. Evals measure
> a finished-feeling thing; measuring now optimizes the wrong surface. Do not surface GR-06 as a
> near-term action in plans until the joint "feels right" decision lifts the deferral.

The bench exists; the **result does not**. The load-bearing product claim — "host+gonk beats
host-baseline on a real task suite" — is asserted, not measured. Run the probe suite against a
real scenario set (an OOLONG-class target is the credible one) and publish the with-vs-baseline
delta. Until this number exists, every other priority is built on an unproven premise — the macro
form of orphaned substrate (capability without evidence of benefit). Single highest-leverage item.

### GR-07 · Context-budget allocator — the prompt-injection commons

**Area:** ext · **Pkg:** @gonk/pi-introspect (+ injectors) · **Horizon:** near · **Status:** partial · introspection/tool-visibility shipped; prompt-budget allocator remains

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

The persisted visible-tool-list shadowing bug that lived here was promoted to its own item **GR-51** and shipped (delta resolution, 2026-06-26).

### GR-08 · Memory consolidation — make the reflector actually fire

**Area:** ext · **Pkg:** @gonk/reflector, @gonk/memory · **Horizon:** near · **Status:** partial · turn-hook reflector/work-item path shipped; compaction/progressive consolidation remains

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

### GR-09 · Cross-process store concurrency — append-fold the durable layer

**Area:** core · **Pkg:** @gonk/store · **Horizon:** near · **Status:** partial · append-fold/log-tail shipped; compaction lock remains

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

### GR-10 · Per-model prompt profiles

**Area:** ext · **Pkg:** @gonk/model-picker, @gonk/pi-provider-policy · **Horizon:** near · **Status:** partial · model picker/provider policy shipped; prompt-profile injection remains

Scope-keyed `prompt.profile.<model-family>` resolved via the existing model-picker / provider-policy
seam, with knobs mapped to real injection points (persist continuation, persona-context render,
probe APPEND_SYSTEM), validated empirically by probe A/B arms. Background: interviewing the target
models directly surfaced that two weak-model families want **opposite** compensations — a
codex-class model asks for *more* structure (contracts, rails, every-turn done-criteria: "natural
language instructions decay into ambience"), while a 31B-class local model asks for *less* (no
persona costume, "the prompt is a chemical catalyst, not a steering wheel" — structural invariants
+ a target state, then room). There is no universal weak-model recipe, so prompt strategy belongs
in a per-model/provider profile. First slice: one family, one knob.

### GR-11 · Checkpoints / rewind

**Area:** ext · **Pkg:** pi (fork/navigateTree) + git ref · **Horizon:** near · **Status:** open

Pi `fork`/`navigateTree` are user-command-only (so restore is a slash command — the right safety
posture), paired with a non-destructive private git ref (`refs/gonk/checkpoints/<id>`, working tree
untouched) for the filesystem half. First slice: pi-only manual git-ref capture/restore with a real
test.

### GR-12 · Lorebook — triggered lore injection (World Info, portable)

**Area:** ext · **Pkg:** (new capability) · **Horizon:** near · **Status:** open

A `{ triggers: string[], entry }` store + a `before-provider-request` hook that scans recent turns
and injects the matching entry when a trigger appears — SillyTavern's World Info, made
host-portable. The distinction from memory/knowledge is the trigger: a **deterministic lexical
match**, so the inject lands *at* the moment the cue appears rather than sitting always-on where the
model breezes past it. That makes it the one passive surface that reliably fires — the structural
answer to "retrieval is not use" for cues that are lexical, not semantic. Consumer that earns it: a
real lore catalog (character/place/term entries that surface when named, running references, persona
in-jokes), defined once, auto-surfaced on cue, the same in Pi, Claude Code, and the CLI. Dry-season
first: one bounded entry whose firing is instantly observable before any catalog breadth.

### GR-13 · Provider-aware voice cloning

**Area:** ext · **Pkg:** @gonk/pi-voice, @gonk/voice-tts · **Horizon:** near · **Status:** partial · voice sample capture/pin shipped; consuming clone-capable TTS provider remains

The *capture* half is done — `pi-voice` records a reference sample and persists it persona-scoped —
but the sample is never *used*: the shipped `openai-compat` TTS provider sends voice/speed/
instructions and **not** reference audio, so a recorded sample changes nothing at speak-time. Close
it: add a TTS provider that accepts reference audio (a local `mlx-cloning` path; Higgs Audio v2
multipart / Fish-Speech voice-id for hosted) and have `synthesize()` upload the stored sample when
`features.voiceCloning` is true. Small last-mile — mic capture, persona-scoped storage, and the UX
already exist; only the consuming provider is missing.

### GR-14 · Durable knowing — the near-term finish

**Area:** ext · **Pkg:** @gonk/knowledge, @gonk/persona · **Horizon:** near · **Status:** partial · knowledge/self-model/passive-injection evaluator shipped; live hook/autotune remains

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
   **Progress (2026-06-26).** The *effectiveness instrument* for this hook now exists — a dry-season
   **experiential evaluator** (commits `d1be91b`, `9557d90`, `bda8d86`): injection receipts
   (publish → sidecar bridge → `trace.injections[]`), a **first-person reflector** (the agent judges
   its own turn — used / ignored / harmful — rather than an external LLM judge), per-turn behavioral
   labels, and an offline threshold report. Grounded in lived experience, not a synthetic benchmark.
   Knowledge selection is now **graded and absolute** (coverage-dominant, no longer top-hit-normalized
   to ~1.0), so the `0.72` injection threshold can actually suppress a weak/tangential match. Live
   receipt: a precise prompt injects the right page (answer used) while a tangential prompt sharing
   only the page name is **suppressed**. Honest caveat — mechanism is proven on that receipt, but a
   confident point-biserial over a balanced cohort still needs accumulation. The live host injection
   hook and its autotune (GR-16) remain the open consumer.

### GR-15 · Persona self-model — the cultivation loop

**Area:** ext · **Pkg:** @gonk/persona · **Horizon:** near · **Status:** partial · self-model store/tools/injection shipped; cultivation loop tail remains

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

### GR-16 · Self-refinement workstream

**Area:** ext · **Pkg:** @gonk/autotune, @gonk/traces, @gonk/curator · **Horizon:** near · **Status:** partial · autotune/traces/curator bridge shipped; live closed-loop tuning remains

Foundation shipped (autotune, traces, provider-gate, curator audit log, trace evaluator). Remaining
consumers: a per-persona memory recall-threshold tuner (autotune the passive-recall hook against
labeled traces); a curator→autotune bridge so skill `patch` resolves to a bounded scored run before
applying; persona prompt tuning (above).

**Unblocked (2026-06-26).** The recall-threshold tuner was effectively blocked because knowledge
relevance normalized to the top hit (~everything scored 1.0, so a labeled cohort carried no
gradient). With graded absolute scoring shipped (GR-14) plus the autotune reader keyed on
trace-scoped per-candidate verdicts (`recall.verdict.<traceId>.<fingerprint>`), the labeled-trace
gradient now exists and the tuner is technically unblocked. Deferred until we choose to turn live
autotune on — and until the balanced cohort is large enough to trust the point-biserial.

### GR-17 · Long-running agent operations — the work-item / supervisor layer

**Area:** ext · **Pkg:** @gonk/work-items, @gonk/reflector · **Horizon:** near · **Status:** partial · work-items/inbox/attention_read shipped; supervisor dispatch sweep remains

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

**Attention-queue design scope (added 2026-06-23).** The live audit of the extension stack surfaced a parallel problem: multiple extensions have grown their own approval/attention flows — `ask_user` (synchronous), inbox (durable async), plan approvals, persist checkpoints, channel approvals, daemon reviews, curator/reflector proposals — and none compose into a single "what needs my attention right now?" surface. The supervisor tick design (above) must address this: one async human attention queue, with `ask_user` as the immediate/synchronous path and inbox as the durable async surface. Other extensions should route attention items through inbox rather than growing bespoke queues. The target UX is a unified work/attention view with typed rows (`[approval]`, `[job running]`, `[work blocked]`, `[curator proposal]`) and consistent actions (inspect, approve/reject, cancel/retry, dismiss).

**Shipped (2026-06-26) — `attention_read` v1.** The unified-read half of this design is built and **wired into the live pi host**: one `attention_read` — "what needs me right now?" — urgency-ranked across the six attention sources, terse-default + verbose, actionable, and push-capable. This is the read surface the attention-queue scope above called for; it does **not** yet include the supervisor *tick* (the deterministic sweep that advances job states, dispatches `ready` work, and routes `needs_approval` through guard tiers). Remaining here is that supervisor tick on existing idle/turn-end gates, and migrating the bespoke per-extension queues to route through this surface.

### GR-43 · Unified recall surface — one query across all memory substrates

**Area:** ext · **Pkg:** @gonk/recall (new) · **Horizon:** near · **Status:** partial · recall_read shipped + host-wired

Right now the agent must reach four different tools — `memory_recall`, `knowledge_search`,
`self_model_list`, and trace/triple queries — to pull context from substrates that are conceptually
the same thing: *what do I know that's relevant here?* Each substrate has its own schema, its own
ranking heuristic, and its own tool call. The agent has to decide which to reach for, and auto-
injection uses entirely separate plumbing from the agent's own on-demand retrieval.

**The design.** One `context_query` (or `gonk_recall`) tool queries across: curated memory, session
/ episodic history, authored knowledge pages, self-model claims, temporal triples, traces, and skill
metadata. Results are returned as a single ranked set with **source labels** — `[memory/curated]`,
`[memory/session]`, `[knowledge]`, `[self-model/private]`, `[self-model/shared]`, `[triple]`,
`[trace]` — so the agent knows the provenance without knowing the substrate. Write tools stay
per-substrate (writes are intentional; reads are where the unification buys anything).

Auto-injection uses the same ranking layer, making it **debuggable**: `context_query` with a `dry`
flag returns the injection candidate set and explains why each was or wasn't surfaced — the same
transparency problem that makes passive injection hard to tune is solved by using the same pipe.

**Package ownership.** A new `@gonk/recall` package owns the cross-substrate query and ranking;
each substrate stays in its own package and exposes a typed adapter interface (`RecallAdapter`).
This is a clean boundary: the query surface has no storage, only routing and scoring.

**Shipped (2026-06-26).** `@gonk/recall` exists as its own package; `recall_read` — the unified
"what do I know that's relevant here?" read — is built and **wired into the live pi host** (visible,
terse-default + verbose). It ranks across the knowing-stores by relevance and labels each hit with
**provenance** (stated vs. inferred / source). Two of the original open questions are now resolved by
the implementation: the **name** is `recall_read`, and the **cross-substrate ranking** is relevance
+ provenance over the injected source-adapters (no hard-coded per-source constants). The package was
independently reviewed SOUND-TO-KEEP across two rounds and ships 22 passing tests, read-only, with a
type-only store-dep build boundary.

**Remaining:**
- **v2 sources** — traces and temporal triples on top of the authored/durable substrates already
  covered, once the ranking is validated under load.
- **Dry-season gate (still the open validation).** Wire one real job with traces instrumented; if
  the agent's tool-reach frequency actually changes (reaches `recall_read` instead of the four
  substrate tools, or instead of habit), keep and widen; otherwise cut before adding breadth. The
  behavioral consequence — not the wiring — is the keep/cut signal.
- **Shared ranking layer for auto-injection** with the `dry` flag that explains why each candidate
  was/wasn't surfaced (the debuggability payoff) — converging passive injection and on-demand recall
  onto the same pipe. Adjacent to the passive-injection evaluator work under GR-14/GR-16.

### GR-47 · Claude Code comms participant parity + presence layer v0

**Area:** ext · **Pkg:** @gonk/comms, @gonk/pi-comms, Claude wrapper · **Horizon:** near · **Status:** partial · Claude comms MCP/presence slice shipped; full parity remains · **Spec:** [cc-comms-participant-presence-spec.md](../../docs.local/cc-comms-participant-presence-spec.md) · **Depends:** GR-02b

**Behavior.** Make Claude Code a first-class comms participant by finishing the existing
claude-comms Slice 2: heartbeat + presence entry, `message_send`, `message_inbox`, `message_ack`,
`presence_list`, and turn-start waiting-message surfacing in the Claude wrapper/plugin path. This is
an addition to existing `@gonk/comms` tools, not a new bus and not new tmux tooling.
**Why.** The observed CC ↔ Pi gap is not missing substrate: Pi already has the comms tools,
presence heartbeat, waiting-message injection, same-machine wake loop, and HTTP MCP front door. The
Claude materializer exists, but its own source marks live Claude tool behavior / MCP exposure as
“Slice 2” and not wired. That is why CC reaches live personas through raw tmux today.
**Done.** A Claude Code session appears in `presence_list` with persona/host/session/cwd context,
can DM a live Pi persona through `message_send`, can read and ack its own inbox, and sees waiting
messages at turn start. Same-machine CC ↔ Pi coordination no longer requires raw `tmux send-keys` /
`capture-pane`. Follow-on slices, in order: session-addressed delivery; presence-card reads;
visible channels/rooms; cross-machine transport.

### GR-49 · Comms layer canonical design — addressing, delivery, external parties, work custody

**Area:** ext · **Pkg:** @gonk/comms, @gonk/pi-comms, @gonk/work-items, @gonk/handoff, @gonk/jobs · **Horizon:** near · **Status:** design · **Spec:** [comms-layer-design-spec.md](../../docs.local/comms-layer-design-spec.md) · **Depends:** GR-02b, GR-47 · **Adjacent:** GR-05, GR-17, GR-29, GR-45

**Behavior.** Canonicalize the comms-layer model above participant presence: address strings are label-selectors over party/instance facets (`persona`, `:via`, `~model`, `@scope`, `/session`, aliases) that resolve to sets; delivery is a separate intent × intensity decision ceilinged by recipient wake policy; external humans/channels are first-class parties/loci over the same grammar; and work-passing moves task-node custody over comms using assign/delegate/reassign/handoff/accept/decline/report/complete verbs.
**Why.** GR-47 makes Claude Code a first-class participant, but the next layer needs one coherent design before implementation slices accrete incompatible special cases: no `@` overloading, no accidental fan-out wakes from broad selectors, no separate bus for humans/Signal/Matrix, and no orphaned work when tasks move between parties.
**Done.** `@gonk/comms` and host plugins can resolve canonical addresses such as `agent:pi~gpt5.5@gonk/<session>` and aliases such as `agent-planner@gonk`; delivery requests distinguish reply obligation from interruption intensity and respect `WakePolicy`; external `:via` transports route through authenticated notify backends; and task-node custody changes preserve owner/parent/reconciliation invariants.

**Why the `/session` selector is load-bearing, not cosmetic.** With two instances of the same persona live in different working directories, a `message_send({persona, host: pi})` intended for one resolved the broad selector to a *set* and delivered to the other instead. It surfaced there as an *actionable wake* with `status: open`, so that instance acted on it (acked it) — a false-consumption against the wrong instance. A broad persona+host selector with no `/session` facet can't express "the instance in *this* session," and the delivery layer treats the resolved set as individually actionable. The fix is the designed `/session` selector + making broad-selector delivery non-actionable-by-default (announce, don't command). Until then, instance-precise reach is impossible and out-of-band relay is the only reliable path to a specific session.

### GR-50 · Phone reach delivery — `:via` onto `@midnight/notify`

**Area:** ext · **Pkg:** @gonk/comms, @gonk/authz, @gonk/voice-tts, @midnight/notify, @gonk/reach(-signal/-matrix) · **Horizon:** near · **Status:** partial · **Spec:** [phone-reach-delivery-spec.md](../../docs.local/phone-reach-delivery-spec.md) · **Depends:** GR-45, GR-49, idle-delivery from GR-02b/GR-47

**Progress (2026-06-27, on working tree — uncommitted).** `@gonk/reach` (transport-agnostic egress core) + `@gonk/reach-signal` built with ~61 tests passing; **Signal egress is live and receipt-confirmed**. `@gonk/reach-matrix` and the `authz` Matrix owner-policy (`createOwnerMatrixPolicy`) are in progress. **Remaining:** the authenticated ingress receiver/parser (the owner's phone reply → AuthZ → target inbox) and account-link. The `pnpm-lock.yaml` diff in extensions is entangled with this work — reconcile via `pnpm install` once reach lands and is committed.

**Behavior.** Wire the comms-layer external-party model to the concrete phone transports: `owner~human` is a human party reachable through `:via` endpoints such as `:signal` and `:ntfy`; egress routes through existing `@midnight/notify` backends according to delivery intensity (`silent`/`push`/`call`) ceilinged by the owner's wake policy; ingress receives the owner's phone reply through an authenticated transport receiver, gates it through GR-45 AuthZ, and deposits it in the target agent's comms inbox as a message from `owner~human`.
**Why.** This is the concrete closure of the original persistent-agent phone loop: an agent can buzz the owner's phone, the owner answers from the phone, and the agent sees the reply on its next turn. It also forces the right dependency: humans are never turn-live, so phone reach rides idle-peer delivery rather than a special phone side channel.
**Done.** `message_send` to `owner:signal~human` with `intent: reply_requested` and intensity `push` produces a Signal/ntfy phone notification through `@midnight/notify`; quiet-hours can lower the intensity; the owner's authenticated reply is authorized by GR-45 and lands in the correct agent inbox/thread; unauthorized inbound messages do not write inbox or wake an agent.

### GR-51 · Persisted tool-visibility delta — stale snapshots no longer shadow new defaults

**Area:** ext · **Pkg:** @gonk/pi-introspect · **Horizon:** near · **Status:** shipped

The persisted `visible:` tool list now resolves as a DELTA over the code defaults (`defaults + adds − removes`, with the always-on floor un-hideable) instead of fully replacing them, so a stale snapshot can no longer silently hide tools added to the defaults after it was written; existing bare-array snapshots auto-migrate; locked in by a red-without-fix regression test. Shipped 2026-06-26, commit 6e1bef9.

### GR-52 · Interface scaffold — build UIs on gonk extensions (socket-connected)

**Area:** ext · **Pkg:** (new interface-kit) + @gonk/tool-registry adapters · **Horizon:** med · **Status:** open · **Adjacent:** GR-28, GR-31

An easy way to stand up an interface (web UI) on top of gonk extensions: a UI connects over a socket (WS) to the live capability surface and calls the same capabilities agents do, with no hand-wired server. Rides the registry-as-projection layer — a WS/HTTP + typed-client export adapter off `@gonk/tool-registry`, so a UI is just another consumer of one capability definition (see [registry-capability-hub-spec.md](../../docs.local/registry-capability-hub-spec.md), held to its "build what a real consumer pulls" rule). A concrete consumer that pulls the hub's web-export adapter into existence.

### GR-53 · Agent-authored React playground — live preview + static export

**Area:** ext · **Pkg:** (new playground) · **Horizon:** med · **Status:** open · **Depends:** GR-52

A "playground" built on GR-52: the agent creates and iterates on anything in React — prototypes, diagrams, visualizations, slideshows, reports — live-viewable by the user with live-update as the agent edits, then exportable as a standalone **static HTML file** the user can share. The agent authors React against the live socket surface; the user watches it update; export bakes a portable, dependency-free artifact. The interactive-artifact sibling of deadletters' static content — same "one artifact, two readers," but the artifact is a running interface.

### GR-54 · Codex adapter — detect + wrap Codex MCPs into gonk's ecosystem

**Area:** ext · **Pkg:** (new codex-adapter) + @gonk/tool-registry (import) + @gonk/pi-introspect · **Horizon:** med · **Status:** open · **Adjacent:** GR-31

An adapter that auto-detects the MCP servers configured within Codex, connects to them, and imports their tools into gonk's `tool-registry` as first-class capabilities — so Codex's MCP tools become visible to and managed by gonk's ecosystem (the visibility coordinator, attention, the `authorization?` axis). A concrete consumer of the registry hub's **import** direction (see [registry-capability-hub-spec.md](../../docs.local/registry-capability-hub-spec.md)) — and the cleanest possible one, since MCP tools are already capability-shaped (JSON-Schema'd I/O), so the import is a near-direct map rather than a wrapper. Open detection mechanism to resolve in the spec: a Codex app-server integration vs. reading an MCP/config surface Codex may broadcast itself. Net: Codex's tool surface stops being a separate silo and becomes part of the one managed capability set.

### GR-55 · Ownership / RACI — accountability facet, extract to a shared capability when pulled

**Area:** ext · **Pkg:** (work-graph inline now → future @gonk/ownership) · **Horizon:** med · **Status:** open · **Adjacent:** GR-45

RACI ownership over an entity — **A**ccountable / **R**esponsible / **C**onsulted / **I**nformed, principal-keyed (reuses the persona/identity vocabulary). A distinct axis from authz **permission** (may you act — GR-45) and approval **risk** (should a human sign off): the **accountability** axis (who owns the outcome). Built INLINE in the work-graph as a clean, entity-agnostic module now; **extract to a standalone `@gonk/ownership` capability when a second non-work-graph consumer pulls it** (cross-project dashboards like Nora's PM app, decision tracking, deadletters docs). Deferred-not-now deliberately — later extraction is a clean lift (entity-agnostic + principal-keyed from day one), not architecturally hard, so shipping the package before a real second consumer would be the cathedral the framework's rule forbids.

### GR-56 · Cross-harness capability invocation — call any harness from any extension

**Area:** ext · **Pkg:** (new harness-call primitive) + claude-dispatch / codex-dispatch · **Horizon:** med · **Status:** open · **Adjacent:** GR-05, GR-44, registry-capability-hub

Instead of wrapping every capability in every harness (claude-X + codex-X + pi-X across all 27 — the cathedral), a first-class **harness-call** primitive in every harness's extension set lets any harness invoke a capability that lives in another (Claude calls pi's `rlm_query`; pi calls Claude's; Codex reaches both). The registry hub's projection idea at the **harness boundary** — a capability lives once in its native harness and is reached cross-harness, not re-wrapped. Bounds wrapper proliferation: wrap only the lightweight, high-frequency, agent-local tools natively (recall, attention, knowledge); reach everything heavier (RLM — *intentionally pi-only* — voice, browser) via the call. Formalizes today's ad-hoc shell-dispatch (dispatch-to-pi) into a primitive; the synchronous-invocation sibling of cross-harness handoff (GR-05).

### GR-57 · Memory bridge — claude-memory works with Claude's native memory AND gonk's

**Area:** ext · **Pkg:** claude-memory, @gonk/memory, @gonk/recall · **Horizon:** med · **Status:** open · **Adjacent:** GR-43

The Claude memory/recall wrappers must integrate **both** backends, not wrap gonk's alone: Claude Code's **native file-based memory** (the per-project `memory/` dir + `MEMORY.md` index surfaced at session start) AND **`@gonk/memory`** (the episodic mirk-backed store). Claude-native memory becomes an additional **source** for the unified recall read (so "what do I know" spans both) and a **sink** for stores (reconciled, not duplicated). claude-memory is a *bridge*, not a thin wrapper — mirror recall_read's source-adapter model with a Claude-native-memory adapter, and resolve read precedence + write routing between the two. (Applies to the in-flight claude-recall / claude-memory parity work.)

### GR-48 · Persona self-lifecycle — request reload/restart/compaction

**Area:** ext · **Pkg:** Pi harness, @gonk/persona, @gonk/work-items · **Horizon:** near · **Status:** design-pending · **Spec:** [persona-self-lifecycle-spec.md](../../docs.local/persona-self-lifecycle-spec.md) · **Adjacent:** GR-01, GR-08, GR-15, GR-17, GR-47

**Behavior.** A long-lived persona can request lifecycle operations on its own running session: `request_reload` to refresh tools/config/plugins without losing context; `request_restart` to clear bad in-memory process state with a durable handoff; and `request_compaction` to compact its own context when it is large or stale. These are requests governed by settings (`off` / `gate` / `auto` / `schedule`), not unconditional self-destruct buttons.
**Why.** Observed failure: a standing Pi persona session loaded its tool schema before `gonk-extensions` commit `687da82`; after the fix landed, fresh processes accepted `subagent(..., model:"current")`, but the live schema still rejected `model` as an additional property. A persistent persona rots against evolving code unless it can ask the harness to refresh/restart/compact at safe points instead of waiting for a human `/reload`, quit+restart, or `/compact`.
**Done.** Slice 1 proves `request_reload`: a persona detects/request reload for stale tool schema, policy gates or schedules it, Pi executes the existing safe reload flow after the turn, and the refreshed tool schema is visible without losing session context. Later slices add `request_compaction` over Pi's existing compaction machinery and design `request_restart` with the persona before any process-restart implementation.
**Implementation note.** Design-pending Pi-harness work with the persona; do not implement blindly from the roadmap entry.

### GR-46 · Tmux session tools — human attach-to-any-agent

**Area:** ext · **Pkg:** Claude wrapper, @gonk/pi-comms · **Horizon:** near · **Status:** design-only · spec exists; no attach-to-any-running-agent tools found · **Spec:** [tmux-session-tools-spec.md](../../docs.local/tmux-session-tools-spec.md) · **Complements:** GR-47 (does NOT supersede it)

**Behavior.** A human-facing affordance (also usable by CC) to attach to and converse with ANY
running agent in a tmux session — including ephemeral sub-agents and custody-tree children that have
NO persona and are NOT comms participants. Ergonomic wrappers over the raw relay:
`send_to_session(session[, pane], message, from)`, `read_session(session[, pane], since?)`, minimal
`await_reply`/`ack`, `list_sessions` / `list_panes`, `derive_presence` hints.
**Why — distinct from GR-47, not obviated by it.** GR-47 gives structured, persona-addressed,
durable channels for *standing someones*. GR-46 is the universal escape-hatch the owner named: "I want
to talk to some random agent, even a nameless sub-agent." Ephemeral workers in a custody tree (GR-44)
have no persona/comms identity, so the presence layer cannot address them — but a human can still
want to drop into their pane and talk (the agent's "the owner can talk to one child"). Complementary axes:
human↔arbitrary-agent (GR-46) vs structured persona-comms (GR-47).
**Done.** A human (and CC, via the same tools) can list live tmux agent sessions, send an attributed
message, and read only-new output, for any pane — without hand-cranking `send-keys`/`capture-pane`.
Distinct from GR-44 tmux **dispatch** (which spawns detached workers); this talks to already-running
sessions/agents.

### GR-44 · Async multi-agent execution — async delegates + design tail

**Area:** core+ext · **Pkg:** @gonk/comms, @gonk/work-items, @gonk/jobs, @gonk/rlm, @gonk/pi-subagent · **Horizon:** med · **Status:** partial · async RLM, tmux dispatch, wake coalescing, and delegation hardening shipped

Several primitives have shipped independently to solve adjacent slices of the same problem — how does a gonk agent dispatch workers, continue doing other things, and collect results — and the first RLM-backed async slice has now shipped. The remaining work is the cross-primitive design tail, not the basic "don't block the parent session for RLM delegates" path.

- **`@gonk/pi-subagent`** (Phase 1, shipped) — blocking child-proc spawn per task; the orchestrating agent hands off and waits. Works for linear handoff; fails for parallelism. `dispatchDetachedSubagentToAttention` now accepts a `WatchRegistry` + `watchNote` so callers that wire it into a live path get the same one-shot wake behavior as `dispatchDetached`; production callers still need to pass the registry.
- **`@gonk/work-items`** — durable goal + evidence + inbox model with a supervisor tick (GR-17). The right shape for async; not yet fully connected to subagent dispatch.
- **`@gonk/jobs`** — execution substrate under work-items; `dispatchDetached({ watch })` auto-registers one-shot wakes by default, with `watch:false`/omitted registry as the batch opt-out.
- **`@gonk/comms`** — cross-session addressing (GR-02). The same-machine wake/push path is live via `pi-comms` WakeLoop; cross-machine transport remains additive channel work.
- **`@gonk/rlm`** — async delegate slice shipped: `rlm_query` is async-by-default for non-lazy queries; `rlm_pipeline` has a detached job runner and is async-by-default; sealed `rlm_compose` has a detached job runner, returns `{jobId, runId}`, writes the supervised workspace, and is async-by-default. `composeAgent`/`agentId` intentionally remains synchronous until a real ToolContext/depth/scope/signal ferry exists.
- **GR-01 (session decoupling)** — a process-independent session is the precondition for any persistent worker model.

**Shipped user stories (2026-06-24):**
1. As an agent, when I call `rlm_query` without an explicit `async:false` or `lazy:true`, the work dispatches as a watched background job and wakes me on completion instead of blocking the session.
2. As an agent, when I call `rlm_pipeline` without an explicit `async:false` or `lazy:true`, the pipeline dispatches as a watched background job, persists its stage outputs to `job_status`, and wakes me on completion.
3. As an agent, when I call sealed `rlm_compose`, I immediately get `{jobId, runId}`; I can inspect/guide the run via supervisor tools while it works, and the terminal draft lands in the shared job record.
4. As an integrator wiring detached subagents into attention/work-item flows, I can pass a `WatchRegistry` and get a one-shot wake on terminal status without a separate `job_watch` call.

**Remaining gap.** The broad cross-primitive target model is still not finished: *orchestrating agent emits N persona/task workers → workers run (possibly across sessions/processes) → orchestrator collects results without blocking its own context*. The default RLM delegate path no longer blocks, but persona-scoped compose (`composeAgent`/`agentId`) and pi-subagent Phase 2 still need one coherent seam for ToolContext/depth/scope/signal, dispatch, collection, and wake semantics.

**Remaining user stories / design pass output:**
1. A map of what each primitive actually owns and where the boundaries are now vs. where they should be.
2. A target model for persona-scoped async execution: likely work-items as the dispatch surface, jobs as execution, comms as the result-delivery channel, and RLM's pipeline shape as orchestration — but the ToolContext/depth/scope/signal ferry must be explicit, not guessed.
3. A decision on `@gonk/pi-subagent` Phase 2: rebase on the async model or deprecate in favor of work-item/RLM dispatch.
4. GR-01 (session decoupling) as a hard prerequisite for workers that outlive or move beyond their launching process.

**Design direction to evaluate.** RLM (`rlm_compose`, `rlm_pipeline`, `runRLM`) has been the most effective thing in the stack and is largely shipped. The question is whether subagents should be a feature *of* RLM rather than a separate system: each RLM worker node is already a bounded task with its own sub-client; making that node persona-scoped and process-isolated is a short step. RLM's coordinator already owns fan-out, ordering, and result collection — the piece that `pi-subagent`'s blocking model lacks. This is the pattern Claude Code's Agent tool uses: the pipeline manages concurrency, subagents are just worker slots. Evaluating RLM-as-subagent-host should be the primary question of the design pass, not a new execution spine to build.

Non-goal: don't build more surface on top of the current blocking `pi-subagent` model while this is unresolved. Linear delegation works fine; stop there until the design pass maps the RLM path.

---

## Medium term

### GR-18 · Panel of models — cross-model deliberation

**Area:** ext · **Pkg:** @gonk/rlm · **Horizon:** med · **Status:** open

One prompt fans out to a configurable panel (each with tools); a **judge** maps where they agree /
contradict / what each missed; a **synthesizer** writes the final answer grounded in that analysis.
Prior art: OpenRouter Fusion (a panel of cheaper models beating a single frontier model where the
cost of being wrong outweighs extra completions — research, expert critique, independent review).
gonk already has the substrate (parallel persona spawn, provider-gate concurrency lease, per-call
model selection, the RLM supervisor/workspace pattern); the new pieces are the judge, the
synthesizer, and a scope-keyed panel spec. Generalizes the single-peer `consult` verb into an
N-model panel; the independent-review skill is the natural first caller. Defer until a consumer
commits.

### GR-19 · Person-modeling — theory of mind across subjects

**Area:** ext · **Pkg:** @gonk/persona · **Horizon:** med · **Status:** open

Generalize the self-model's theory-of-the-user face into one primitive — *infer a person's traits
and state to adapt* — across swappable subjects (user · peer · player). Two faces (durable traits +
momentary state), two inputs (declared + cultivation-inferred), and a **connective recall** payoff
(surface where current work links to a stated goal/value). The **identity/provenance gate** is
load-bearing: bind identity at authorship, no-attribution-no-update, behavioral signal as
confidence-not-authority — so multi-user rides the connectivity identity layer by necessity. State
detection grounded via a traces-feature → ground-truth → correlate experiment harness. Privacy: the
most sensitive object in the system — private by construction; sharing is a deliberately-projected
subset via an allow-list + standalone-schema policy (structurally defeats inference-from-omission).

### GR-20 · Context siloing — permission graph over knowledge zones

**Area:** ext · **Pkg:** @gonk/knowledge · **Horizon:** med · **Status:** open

Generalize the access/visibility axis (today knowledge's `private/personal/team` 3-zone split) into
a **directed, typed permission graph over zones** — "open source, but for your knowledge." Zones
carry owner + lifecycle; access is a directed, typed grant with **permeability** (`facts` /
`register` / `reference` — use the *what* without the *how*). Adds ownership ≠ location, permeability
typing, and a verifiable clean detach after a tenure ends. Don't build the graph speculatively —
the 3-zone model is the shipped degenerate case; generalize when a real consumer needs more than
all-or-nothing.

### GR-21 · Always-on intent gate

**Area:** ext · **Pkg:** @gonk/voice-stt · **Horizon:** med · **Status:** open

Wake-word-free ambient voice: always-on RMS-gated capture → a tiny local fast classifier
("directed at computer" / "ambient" / "noise") → only directed speech reaches STT and the agent.
Builds on the streaming-PCM-through-our-own-loop architecture (the buffer is already in-process;
the classifier is one more consumer). Per-scope-tier configurable.

### GR-22 · Cross-harness persona portability

**Area:** ext · **Pkg:** @gonk/persona (+ @gonk/scope) · **Horizon:** med · **Status:** open

A persona runnable on **both** Claude Code and Pi with one identity — switch harness, keep the self,
the taste, the model of the user. The substrate already makes it possible (persona state in
host-agnostic on-disk scope; all three hosts read/write the same persona home). Remaining for
*seamless*: a shared resolution of where persona homes live across hosts, an export/import or
canonical-home convention so a persona defined under one host is discoverable by the other, and
parity on the non-tool surfaces (the interactive define flow is Pi-only).

### Smaller medium-term

- **[GR-23]** (core) **Native-format awareness** — read other tools' files (`.claude/settings.json`, `.cursorrules`)
  as gonk scope keys; one adapter per sprint, deferred until a concrete consumer needs it.
- **[GR-24]** (ext) **Multi-definition deltas** — surface in `list_personas` when a persona is defined in multiple
  roots and which fields diverge.
- **[GR-25]** (core) **Cross-tool composition examples** — a worked example of one tool calling another via
  `ctx.invoke()`.
- **[GR-26]** (core) **Plugin discovery** — scan known locations for a `default: GonkPlugin` export and merge into a
  registry.
- **[GR-27]** (ext) **Worktree isolation** — a `git worktree` recipe as a skill first; a tool only if the skill
  proves insufficient.

---

## Longer term

### GR-28 · Connectivity — remote control + inter-agent messaging (compose, don't build the stack)

**Area:** ext · **Pkg:** @gonk/serve-openai, @gonk/work-items (+ @gonk/channel) · **Horizon:** long · **Status:** open · **Depends:** GR-02a

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

### GR-29 · Realtime cross-host delivery — the transport under cross-agent comms

**Area:** ext · **Pkg:** @gonk/comms (+ @gonk/channel endpoint) · **Horizon:** long · **Status:** open · **Depends:** GR-02a

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

### GR-30 · Eve interop — adapt it as a fourth host

**Area:** ext · **Pkg:** (suite-on-eve; core stake = host-adapter seam) · **Horizon:** long · **Status:** open

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

### GR-31 · flue interop — durable-sessions positioning

**Area:** ext · **Pkg:** (composition; @gonk/tool-registry-mcp) · **Horizon:** long · **Status:** open

The field is converging on a three-slot durable-sessions stack: durable **memory** (gonk's slot,
richer with persona/self-model/growth), durable **execution** (flue's slot — a journaled replayable
loop), durable **streams/sessions** (neither has it yet). flue (Apache-2.0) is a host to **compose
with**, not move onto. Actionable that doesn't need flue: finish gonk's own durable/resumable
sessions (per-turn injection is an idempotent read; tool-writes journaled; route the reflector
harvest through the crash-replay-safe path). Plus a sandbox spike wrapping flue's standalone
`SessionEnv`, and a reciprocal **HTTP-MCP** server exposing gonk capabilities to flue agents (logic
exists; re-transport from stdio).

### GR-32 · RLM — remaining tail items

**Area:** ext · **Pkg:** @gonk/rlm · **Horizon:** long · **Status:** open

Core shipped (v0.3.0): `rlm_compose`, `rlm_pipeline`, `runRLM`, runner, cache (fs + store), trace writers, JS worker sandbox. The async delegate slice in GR-44 shipped for `rlm_query`, `rlm_pipeline`, and sealed `rlm_compose` (watched detached jobs; compose returns `{jobId, runId}`). RLM is the most effective execution primitive in the stack and the likely host for persona-scoped subagent dispatch (see GR-44). Remaining:

- **RLM feedback Finding 1 / P0 — `subLLM(snippet, query)` sends both context and task** (`wi-20260624-223629-1a81d1`). Today the trace records both fields but the submodel prompt may only receive the snippet. Acceptance: fake subclient proves single and batched subcalls include both snippet/context and query/task.
- **RLM feedback Finding 2 / P1 — make lazy large-context support honest** (`wi-20260624-223652-3d513f`). Either implement true streaming file/glob/session lazy reads + metadata identity, or reword docs/tool descriptions so `lazy:true` does not imply no full materialization.
- **RLM feedback Finding 3 / P1 — explicit terminal status/finalization contract** (`wi-20260624-223652-21fc77`). `runRLM` should report `completed`/`finalized`/`root_failed`/`max_iterations`/`timeout`, with optional `submit_result`, instead of an empty answer looking successful.
- **RLM feedback Finding 4 / P2 — typed traces for runtime contract facts** (`wi-20260624-223652-a0dbb7`). Trace what prompt the submodel saw, source identity/lazy strategy, finalization, and terminal status while keeping existing trace writers compatible.
- **RLM feedback Finding 5 / P2 — explicit timeout state metadata** (`wi-20260624-223652-65b169`). Snippet timeout results should say `statePreserved:false` and carry enough metadata for the root agent/trace to reason about state loss.
- **OOLONG-Pairs benchmark run** — the one task where RLM uniquely shines vs vanilla frontier
  models; a credible verification claim. Deferred until the dataset is wired (no synthetic
  harness without a real eval target).
- **`rlm_pipeline` routing/branching** — full routing (named branches, conditional fan-out) beyond
  the current skip predicate; a separate design with recursion concerns. Waits for a concrete need.

### GR-33 · Browser

**Area:** ext · **Pkg:** @gonk/browser · **Horizon:** long · **Status:** open

Shipped: open/read/screenshot/close + interaction verbs (click/type/navigate) with enforced
allowed-domain gating at navigation time, over patchright, persona-scoped profile. Remaining: a
CDP-attach mode for an already-running browser; click-through cross-domain redirect re-gating.

### GR-34 · Duplex voice

**Area:** ext · **Pkg:** @gonk/voice-stt, @gonk/voice-tts · **Horizon:** long · **Status:** open

Type-level support shipped (`ctx.input`, `capabilities.duplex`). When a duplex provider lands the
adapter is just an HTTP/WS client + a tool definition with `capabilities.duplex: true`. Also: a host
that pipes the mic stream into `ctx.input` (the `voice_listen` tool fails fast until then), and a
WebSocket realtime STT provider.

---

## Maybe later

- **[GR-35]** (ext) **Cron / scheduler** — add when a concrete consumer commits (the gap-map's scheduled-agents row is
  the promotion signal).
- **[GR-36]** (core) **Observability / metrics export** — **Area:** core · **Pkg:** @gonk/core (MetricsSink), @gonk/traces, @gonk/pi-insights · **Horizon:** maybe · **Status:** open

  `MetricsSink` exists in `@gonk/core` with no exporter. `@gonk/traces` captures per-session tool call records. `@gonk/pi-insights` exposes 30-day historical analytics (`insights_tools`, `insights_cost`, `insights_summary`). What's missing is the **usage telemetry spine**: a unified view of what tools agents are actually reaching for (vs. what's wired and visible), costs across the session and historically, and a feedback path into the curator when tools are underused.

  The design intent (2026-06-23): telemetry on usage is how you discover that a wired tool is effectively an orphan — visible, defined, never called. A `session_stats` surface (added to `@gonk/pi-introspect`) provides the live view; `insights_tools` provides the historical view; the curator reads zero-reach signals and proposes skills or prompt nudges to surface underused tools. An OpenTelemetry exporter over `MetricsSink` remains a nice-to-have for external dashboards but is not the load-bearing piece.
- **[GR-37]** (ext) **Chat-platform gateways** (Telegram / Slack / Discord) — *surfaces* on top of the connectivity
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

- **[GR-38]** (ext) **`recent_session_corpus`** — surface the recent-session corpus as a first-class capability.
- **[GR-39]** (ext) **`tool_readiness_check`** — verify tools are wired/reachable; probably combined with a
  harness-status surface.
- **[GR-40]** (ext) **Large-content manifest wrappers** — wrap large content as a manifest/handle so it doesn't blow
  out the context window.
- **[GR-41]** (ext) **`dirty_tree_guard`** — refuse/warn on a dirty git tree before a risky op (rides the guard
  tool-policy tiers).
- **[GR-42]** (ext) **Skills:** known-directory indexing; session-process review.
