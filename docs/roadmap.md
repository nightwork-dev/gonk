# Roadmap

What's next for gonk core. For prior work, see [CHANGELOG.md](../CHANGELOG.md).

## Near term

### Cross-process store concurrency for a single persona — append-fold the durable layer

> Synthesized from notes by Tamsin (writing-repo persona), 2026-06-19. Motivating consumer:
> `@soma/gonk` persona-bound bodies, but the seam is general to any persona-bound store.

**The seam.** A single persona is bound to one on-disk store, but that persona can be live in
**several independent host processes at once** — two `pi` sessions, a Claude session, a cron job
— with **no shared lock manager between them** and an fs-lite store underneath. "Fresh handle /
session per call" closes the *in-process* shared-handle footgun; it does **not** close
cross-process read-modify-write: two processes each load state, each mutate, each write back, and
the last writer silently clobbers the other. A sharper instance bites derive-on-wake
reconciliation: if reconciliation *writes* the caught-up state and two sessions wake into the same
gap at once, the gap is applied twice. **Reconciliation-as-write is not safe under concurrency.**

**Resolution — reuse existing machinery, don't add a concurrency subsystem:**
1. **Treat concurrent independent sessions of one persona as forks, not one shared blob.** Each
   live session gets its own fast-layer store-prefix (ephemeral live state, born on wake, dies with
   the session); they share the durable slow layer (the identity anchor / set-points / event log).
   This is the fork model's storage-prefix isolation applied to *sessions* instead of timelines.
2. **Make the durable slow layer append-fold.** Store it as an **event log**; current durable state
   = `fold(log, now)`, computed on read. Concurrent sessions *append* (commutative — nobody
   read-modify-writes a live blob), which (a) removes the cross-process clobber by construction,
   (b) makes idle-reconciliation a pure derivation from `(anchor, lastActivity, now)` on read, so
   two sessions waking together derive the *same* recovered state instead of double-applying the
   gap, and (c) is the same derive-on-read discipline already committed to elsewhere.
   **`@gonk/store` already ships the `append-log` primitive** (pure-`fs` default, scope-resolved) —
   that *is* the durable-slow-layer backing; the per-session fast layer is KV/blob under a
   session-scoped prefix.

**The one genuine lock.** Log compaction/checkpoint still needs mutual exclusion across processes —
the fs default doesn't give it for free. Name it as the single place a real cross-process **file
lock** is required, rather than hoping per-call handles suffice. Everything else is lock-free by
construction (fork-isolated fast layer + append-only fold-on-read slow layer).
