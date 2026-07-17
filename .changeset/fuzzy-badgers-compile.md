---
"@gonk/context": minor
"@gonk/auth": patch
"@gonk/tool-registry": patch
---

Add authorized deterministic context compilation with closed Standard Schema
boundaries, in-process contributors, discovery/use authorization gates,
canonical deduplication, token budgeting, blocked required-context outcomes,
and redacted domain receipts. Add shared request-bound `AuthContext` capture so
context compilation and tool dispatch use immutable principal snapshots and a
once-bound authorization policy.
