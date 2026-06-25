---
"@gonk/store": patch
---

Add an fs-backed log tail helper used by the self-wake critical path.

- New `tailLog` utility for reading newly-appended log entries from an offset.
- Covered by regression tests for offset advancement and malformed/truncated rows.
