---
"@gonk/tool-registry-mcp": minor
---

Breaking pre-1 change: migrate the MCP adapter and importer to the split
TypeScript SDK v2 client and server packages. Request hooks now receive the v2
`ServerContext`, with HTTP authentication data under
`context.http?.authInfo`; the adapter deliberately retains legacy-era protocol
negotiation while Gonk's stateful authenticated session model is evaluated
separately for the 2026-07-28 protocol.
