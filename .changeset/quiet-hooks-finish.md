---
"@gonk/extension-spec-claude": patch
---

Invoke `turn_complete` and `session_end` handlers through Claude Code's `Stop`
and `SessionEnd` hooks instead of silently skipping them. Session-end handlers
remain side-effect-only because Claude does not accept context output there.
