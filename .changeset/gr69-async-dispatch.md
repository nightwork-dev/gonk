---
"@gonk/tool-registry": minor
---

Add `dispatchDetachedWithWait` (`@gonk/tool-registry/async-dispatch`), a tool-layer
detach-by-default / wait-opt-in combinator for heavy tools: dispatch a detached worker
and return a job handle by default; the caller opts into blocking with `wait`/`sync`.
Consumers own both render branches (`renderAsync` generic). GR-69.
