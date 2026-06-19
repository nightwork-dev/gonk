# @gonk/tool-registry-mcp

MCP adapter — exposes a `ToolRegistry` or `Orchestrator` over the Model Context Protocol via the official `@modelcontextprotocol/sdk`.

## Usage

```ts
import { createMcpServer } from "@gonk/tool-registry-mcp";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const adapter = createMcpServer({
  serverName: "todo",
  serverVersion: "0.1.0",
  source: orchestrator,
  writeToolPolicy: "warn",        // | "require-allowlist" | "permissive"
  allowlist: ["safe-write-tool"], // only used with require-allowlist
});

await adapter.connect(new StdioServerTransport());
```

## What it advertises

- With an `Orchestrator`, only `activeSet()` tools (always + committed pins).
- With a raw `ToolRegistry`, all tools.
- Either way, **duplex tools are filtered** — MCP is request/response.

`hints.mcp.mcpName` overrides the advertised name. `hints.mcp.annotations` are mapped to MCP's `*Hint` fields (`readOnly` → `readOnlyHint`, etc.).

## Tool input schema

Pulled from `tool.inputJsonSchema` (typebox values are valid JSON Schemas). When absent, the adapter advertises `{ type: "object", additionalProperties: true }`.

## Display rendering

- `text` / `markdown` blocks → MCP text content
- `code` → fenced markdown text
- `json` → `JSON.stringify(value, null, 2)`
- `image` → MCP image content (mimeType + base64 data)
- `link` → text content with title + URL

## Write-tool policy

`writeToolPolicy` (default `"warn"`):

- `warn` — log a warning at startup for each tool with `capabilities.writesFs` or `network`; advertise anyway
- `require-allowlist` — refuse to advertise unless the tool's name is in `allowlist`
- `permissive` — silent passthrough
