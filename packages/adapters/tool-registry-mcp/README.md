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

## Running it over HTTP (local vs. remote)

The same registry can be served over HTTP — `createHttpMcpServer(...)`, or the
`gonk-mcp-http` command. **How you run it depends on who needs to reach it.**

### Just this computer — the default, no setup

Out of the box it listens on `127.0.0.1` (also called *loopback* or
*localhost*) — an address that **only programs on this same computer** can reach.
Nothing else on your network or the internet can see it, so no password is
needed.

```bash
gonk-mcp-http                      # → http://127.0.0.1:8808/mcp
```

### From somewhere else — remote (another laptop, your phone, a server, a Tailscale network)

To reach the server from anything other than this computer, you have to bind it
to a *network address* (commonly `0.0.0.0`, meaning "every address this machine
has"). The moment you do that, **anyone who can reach the port could run your
tools** — so the server will not start that way silently. You make two choices:

**1. How do callers prove they're allowed in?** Pick one:

- **Set a key (recommended).** Callers must send `Authorization: Bearer <key>`.

  ```bash
  gonk-mcp-http --host 0.0.0.0 --api-key "$(openssl rand -hex 32)" \
    --allowed-hosts "my-box.tailnet.ts.net:8808"
  ```

- **Or declare the network itself trusted** with `--allow-insecure` — e.g. a
  private Tailscale network where you trust everyone on it. No key; anyone who
  can reach the port can run tools. Use it deliberately.

  ```bash
  gonk-mcp-http --host 0.0.0.0 --allow-insecure
  ```

If you bind to a network address with **neither**, the server refuses to start
instead of exposing your tools to the world unauthenticated.

**2. What address will callers dial?** When a key is set, a safety check
(*DNS-rebinding protection* — it stops a malicious web page from quietly driving
a server on your machine) stays on. It can't guess your machine's public name,
and `0.0.0.0` is never what a caller actually types, so you must list the
name(s) callers use with `--allowed-hosts` (e.g. the machine's hostname and
port). Omit it on a remote, keyed bind and the server refuses to start — because
otherwise it would accept connections but reject every request, looking alive
while answering nothing. The `--allow-insecure` trusted-network mode turns this
check off, so you don't pass `--allowed-hosts` there.

### The whole thing in three lines

| You want… | Run |
| --- | --- |
| Local only | `gonk-mcp-http` |
| Remote, with a password | `gonk-mcp-http --host 0.0.0.0 --api-key <key> --allowed-hosts <name:port>` |
| Remote, on a trusted private network | `gonk-mcp-http --host 0.0.0.0 --allow-insecure` |

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
