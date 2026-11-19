---
"@gonk/tool-registry-mcp": patch
---

Enforce the body size limit while reading MCP and JSON HTTP requests. Return HTTP 413 as soon as the upload exceeds the limit.
