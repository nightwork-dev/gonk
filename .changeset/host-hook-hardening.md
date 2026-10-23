---
"@gonk/extension-spec-claude": patch
"@gonk/extension-spec-codex": patch
"@gonk/extension-spec-pi": patch
---

Claude: reject spec ids that are not kebab-case and single-quote the spec id and event in generated hook commands, so spec data cannot run shell commands. Codex: a placed hook whose payload omits `hook_event_name` runs side-effect-only instead of being skipped. Pi: `tool_complete` fires only for model-issued tool calls, not for calls a tool makes through `ctx.executeTool()`.
