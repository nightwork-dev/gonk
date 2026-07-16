---
"@gonk/auth": major
"@gonk/tool-registry": major
"@gonk/tool-orchestrator": major
"@gonk/tool-registry-mcp": major
"@gonk/core": major
---

Add transport-independent authenticated principals, delegation-aware session
and persistent-grant keys, registry-level discovery and invocation
authorization, authoritative resource resolution, approval providers, and
separate redacted authorization/approval receipts.

Secure orchestrator meta-tool discovery and streamable-HTTP MCP sessions,
including principal-filtered tool lists, structured approval-required results,
and session binding across POST, GET, and DELETE.

The short-lived MCP `authorize({ tool, input, request, approval })` callback has
been removed. Authenticated MCP consumers must provide `makeAuthContext`;
consent and risk decisions belong in the registry `ApprovalProvider`.
