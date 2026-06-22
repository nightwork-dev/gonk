---
"@gonk/channel": minor
"@gonk/temporal": minor
---

Promote two connectivity/time primitives into core.

- **`@gonk/channel`** — the transport *contract* (`IChannel`/`BaseChannel`,
  `ConnectAddress`, the address-on-the-message `Message`, `ChannelRegistry`,
  `InternalChannel`, `ReconnectionManager`) moves from gonk-extensions into core.
  It's a contract parallel to `@gonk/tool-registry`; an external consumer wanting
  the addressing/message contract should get it from core, not pull extensions.
- **`@gonk/temporal`** — now subsumes the former **`@gonk/scheduler`**. Temporal
  computes the idle/activity reading (`computeTemporal`) that the periodic-run
  decision (`shouldRun`) consumes, so the two halves of "given time + activity,
  should something happen now" live in one package. `@gonk/scheduler` is retired;
  import `shouldRun` / `defaultSchedulerState` from `@gonk/temporal`.

(Extensions repoints its importers and drops its local copies in a follow-up.)
