# @gonk/store

## 0.0.12

### Patch Changes

- Add `FoldStore` — durable state as an append-only log with fold-on-read, over the existing `LogStore`. Concurrent writers append (no read-modify-write of a state blob), so independent handles over the same backing don't clobber; derive-on-wake reconciliation is a pure read, and `dedupeKey` makes a re-applied reconciliation event idempotent. `compact()` is a documented throwing stub pending a cross-process lock.

- Updated dependencies []:
  - @gonk/scope@0.0.12
