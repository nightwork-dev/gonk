# @gonk/tool-registry-mcp

MCP adapter — exposes a `ToolRegistry` or `Orchestrator` over the Model Context Protocol via the official MCP TypeScript SDK v2 packages.

## Usage

```ts
import { serveMcpStdio } from "@gonk/tool-registry-mcp/stdio";

serveMcpStdio({
  serverName: "todo",
  serverVersion: "0.1.0",
  source: orchestrator,
  instructions: "List open tasks before changing their status.",
  writeToolPolicy: "warn", // | "require-allowlist" | "permissive"
  allowlist: ["safe-write-tool"], // only used with require-allowlist
  makeAuthContext: (request) =>
    policy.authContextFor(request.http?.authInfo),
});

```

`serveMcpStdio`, `createHttpMcpServer`, and `createWebMcpHandler` serve the
stateless `2026-07-28` revision and the earlier `initialize` handshake on the
same entry point. Legacy HTTP sessions stay bound to the caller's security
context. In the newer revision, HTTP authenticates every request independently
and serves principal-filtered tool discovery with private cache hints. Object
outputs remain structured on both revisions. The newer revision also carries
scalar and array outputs as structured content.

Use `instructions` for short guidance shared by all callers. When the source
defines instructions, MCP and JSON HTTP use that text by default. An explicit
MCP adapter option overrides it for those routes. Clients read the guidance
from `initialize`, `server/discover`, or the JSON discovery response. Keep
longer workflows in bundled usage skills.

The low-level adapter remains available for hosts that own their transport.
Use `serveMcpStdio` to serve both revisions from a stdio process.

## Serve packaged skills

Load a trusted application bundle at startup and register the returned tools.
Pass the same bundle to the MCP adapter to offer native MCP Skills alongside
`skill_list` and `skill_get`.

```ts
import { ToolRegistry } from "@gonk/tool-registry";
import { createBundledSkillToolDefinitions } from "@gonk/skills/bundled";
import { loadMcpBundledSkills } from "@gonk/tool-registry-mcp";

const source = new ToolRegistry({
  instructions: "Use the bundled skills for multi-step workflows.",
});
const bundledSkills = await loadMcpBundledSkills({
  root: new URL("./skills/", import.meta.url),
  createTools: createBundledSkillToolDefinitions,
});
source.register(bundledSkills.tools);
// Pass { source, bundledSkills, ... } to the MCP server options.
```

Each skill is an immediate child directory containing `SKILL.md` and any files
it references. Native clients discover the bundle with `skills/list` and
`skills/get`, then read the manifest and supporting files with `resources/read`.
Native requests run through the registered tools' Gonk authorization. The
catalog records file digests at startup and rejects reads of changed files.
Reload the application after changing a bundle.

The native extension works with both supported MCP lifecycles. Clients can
continue to use the portable tools over MCP, JSON HTTP, CLI, and Pi.
The [MCP Skills extension](https://skills.extensions.modelcontextprotocol.io/)
is in beta.

## Running it over HTTP (local vs. remote)

The same registry can be served over HTTP — `createHttpMcpServer(...)`, or the
`gonk-mcp-http` command. **How you run it depends on who needs to reach it.**

### Just this computer — the default, no setup

Out of the box it listens on `127.0.0.1` (also called _loopback_ or
_localhost_) — an address that **only programs on this same computer** can reach.
Nothing else on your network or the internet can see it, so no password is
needed.

```bash
gonk-mcp-http                      # → http://127.0.0.1:8808/mcp
```

### From somewhere else — remote (another laptop, your phone, a server, a Tailscale network)

To reach the server from anything other than this computer, you have to bind it
to a _network address_ (commonly `0.0.0.0`, meaning "every address this machine
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
(_DNS-rebinding protection_ — it stops a malicious web page from quietly driving
a server on your machine) stays on. It can't guess your machine's public name,
and `0.0.0.0` is never what a caller actually types, so you must list the
name(s) callers use with `--allowed-hosts` (e.g. the machine's hostname and
port). Omit it on a remote, keyed bind and the server refuses to start — because
otherwise it would accept connections but reject every request, looking alive
while answering nothing. The `--allow-insecure` trusted-network mode turns this
check off, so you don't pass `--allowed-hosts` there.

### The whole thing in three lines

| You want…                            | Run                                                                        |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Local only                           | `gonk-mcp-http`                                                            |
| Remote, with a password              | `gonk-mcp-http --host 0.0.0.0 --api-key <key> --allowed-hosts <name:port>` |
| Remote, on a trusted private network | `gonk-mcp-http --host 0.0.0.0 --allow-insecure`                            |

### Mount inside an existing web application

Applications that already own their HTTP server should mount MCP in that
framework instead of starting a second listener. `createWebMcpHandler` accepts
and returns Web-standard request objects, so it works directly in TanStack
Start, Hono, Bun, and similar Node-compatible routers:

```ts
import { GONK_AUTH_INFO_PRINCIPAL } from "@gonk/tool-registry-mcp";
import { createWebMcpHandler } from "@gonk/tool-registry-mcp/http";

const mcp = createWebMcpHandler({
  source: registry,
  serverName: "my-app",
  serverVersion: "0.1.0",
  authenticate: async (request) => {
    const session = await appAuth.verify(request);
    if (!session) return null;
    const principal = principalForSession(session);
    return {
      token: session.accessToken,
      clientId: session.clientId,
      scopes: [...principal.scopes],
      expiresAt: principal.expiresAt,
      extra: {
        [GONK_AUTH_INFO_PRINCIPAL]: principal,
      },
    };
  },
  makeAuthContext: (request) =>
    appPolicy.authContextFor(
      request.http?.authInfo?.extra?.[GONK_AUTH_INFO_PRINCIPAL]
    ),
  makeContext: () => ({
    host: { invoker: "agent", profileId: "automation" },
  }),
});

// TanStack Start server route
export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => mcp.handle(request),
      POST: ({ request }) => mcp.handle(request),
      DELETE: ({ request }) => mcp.handle(request),
    },
  },
});
```

The host owns credential/session/JWT validation. Its SDK `AuthInfo.extra`
carries the already-normalized `AuthenticatedPrincipal`; the adapter validates
that shape, builds the registry auth context, filters discovery, and pins each
stateful MCP session to `securityContextKey(principal)`. Refreshed roles, scopes,
or expiry may continue on the same session, while a changed effective subject,
delegated actor, tenant/workspace, or delegated actor session gets the same
unknown-session response as a missing session and cannot disturb the legitimate
session.

Do not authenticate an agent-only MCP route with an ambient browser cookie.
Use an Eve/audience-bound bearer or equivalent credential that browser
JavaScript cannot silently reuse. Direct browser chat routes and agent MCP
routes are separate security audiences.

Set `sessionAuditSink` to receive a redacted `session-binding` security receipt
when a valid credential attempts to reuse a session under a different security
context. The receipt identifies only the attempted principal and opaque key; it
does not expose the MCP session id or the legitimate session owner.

`makeAuthContext` is the sole authorization seam. `makeContext` remains the
invocation-only place for non-security host data such as an invoker profile;
returning `auth` from it is rejected before discovery. Caller identity must
never be accepted from tool input.

For simple deployments, `apiKey` remains supported and synthesizes a stable
service principal. A custom `authenticate` callback must return a structurally
valid Gonk principal in `AuthInfo.extra`. Delegated principals must carry
`actorSessionId` before they can initialize or reuse a stateful MCP session.

The mountable handler does not infer listener safety: credential-free use
requires explicit `allowInsecure: true`. `makeAuthContext` is the authenticated
policy seam; omitting it requires explicit `allowUnrestrictedTools: true`.
Those two flags are deliberate trusted-development/service modes, not defaults.
Gonk does not synthesize an identity for an older callback shape:
authenticated discovery and invocation must share a real principal and
`AuthContext`.

### Plain JSON discovery and invocation

Set `jsonPath` to expose the same tools beside MCP. The default leaves these
routes disabled. Both HTTP constructors accept this option:

```ts
const server = createHttpMcpServer({
  source: registry,
  serverName: "my-app",
  serverVersion: "0.1.0",
  jsonPath: "/tools",
  apiKey: process.env.TOOL_API_KEY,
  makeAuthContext: (request) => appPolicy.authContextFor(request.http?.authInfo),
});
await server.start();
```

- `GET /tools` returns `{ tools: [...] }` with advertised names, descriptions,
  input schemas, and annotations. Input schemas retain the registry's raw type.
- `POST /tools/:name` accepts raw JSON input with `Content-Type: application/json`.
  Encode the advertised tool name as one URL segment. No MCP session is needed.
- Invocation returns the registry's collected `ToolOutcome`: `{ ok: true, data,
  display?, metadata?, receipt? }` or `{ ok: false, code, message, details? }`.
  Dispatched outcomes use HTTP 200. Missing or hidden tools use HTTP 404.
  Authentication, request protection, malformed input, and oversized bodies use
  the existing HTTP error responses and their non-success status codes.

JSON routes use the same authentication, authorization context, discovery filter,
write policy, and registry invocation as MCP. A caller cannot select its identity
through tool input. Request cancellation and handler shutdown abort invocation.
`makeAuthContext` and `makeContext` receive the original request in `http.req`.
MCP client callbacks such as sampling and elicitation are unavailable on JSON
routes and fail explicitly if a host context callback tries to use them.

For `createWebMcpHandler`, mount the configured JSON path and its `/:name` route
alongside the MCP path, and pass each request to the same handler's `handle`.

## What it advertises

- With an `Orchestrator`, only `activeSet()` tools (always + committed pins).
- With a raw `ToolRegistry`, all tools.
- Either way, **duplex tools are filtered** — MCP is request/response.
- With an auth context, `tools/list` includes only tools allowed by
  `tool.discover`; direct calls to hidden tools look like missing tools.
- Write policy recognizes write/network capabilities and `write`/`exec`
  approval declarations. Input-dependent approval functions are treated
  conservatively as writes for allowlisting.

`hints.mcp.mcpName` overrides the advertised name. `hints.mcp.annotations` are mapped to MCP's `*Hint` fields (`readOnly` → `readOnlyHint`, etc.).

## Import a remote MCP server

The client direction lives in this same adapter. It connects with the official
SDK, discovers a reviewed subset of remote tools, and atomically replaces that
server's source-owned catalog in a `ToolRegistry`. The coordinator-owned package
metadata must expose the `./client` subpath before this import works from a
published package.

```ts
import { createMcpToolImporter } from "@gonk/tool-registry-mcp/client";

const inbound = createMcpToolImporter({
  registry,
  serverId: "docs",
  endpoint: "https://mcp.example.com/mcp",
  allowedOrigins: ["https://mcp.example.com"],
  selection: { allow: ["search", "fetch"] },
  authorization: { requiredRole: "docs-reader" },
  approval: "read",
  resolveHeaders: async () => ({
    Authorization: `Bearer ${await hostSecrets.require("docs-mcp-token")}`,
  }),
  overrides: {
    search: { description: "Search the reviewed documentation source" },
  },
});

await inbound.connect();
```

The endpoint and selection are configuration-owned authority. Credentials are
resolved by the host at connect/reconnect time and never appear in tool input or
provenance. Remote descriptions, annotations, and instructions are untrusted:
the importer uses a local description, `on-demand` visibility, and `exec`
approval unless reviewed local configuration overrides them. Registry
authorization runs before the proxy handler, so a denied caller produces no
upstream `tools/call`.

The importer tries `2026-07-28` first and falls back to the initialization
handshake with older servers. It supports paginated discovery, `tools/list_changed`, explicit
refresh/reconnect/close, cancellation, and request timeouts. A failed schema
compile or refresh retains the prior complete catalog. Its deliberately small
JSON Schema 2020-12 subset supports object/array/scalar types, properties,
required fields, closed objects, items, enum/const, and basic length/range
limits; unsupported keywords fail the whole candidate catalog closed.

## Development switchboard: one MCP registration, many worktrees

The switchboard uses the initialization handshake to pin each client to one
worktree. Clients that try the stateless revision first can fall back to this
handshake.

`@gonk/tool-registry-mcp/dev` adds a deliberately small **local** router for
development. Point Codex, Claude Code, or another MCP client at the router once;
then change which worktree answers _new_ MCP sessions without reinstalling a
plugin or editing host configuration.

```json
{
  "version": 1,
  "active": "app-review",
  "environments": [
    {
      "id": "app-main",
      "repo": "./apps/example",
      "branch": "main",
      "endpoint": "http://127.0.0.1:4173/mcp",
      "database": "./.data/example.db"
    },
    {
      "id": "app-review",
      "repo": "./worktrees/example-review",
      "branch": "feat/story-review",
      "endpoint": "http://127.0.0.1:4179/mcp",
      "database": "./.data/example-review.db"
    }
  ]
}
```

Run the switchboard and register this one stable URL with a host:

```bash
gonk-mcp-dev serve --config ~/.config/gonk/dev-mcp.json --port 8810
# host configuration: http://127.0.0.1:8810/mcp

gonk-mcp-dev list
gonk-mcp-dev current
gonk-mcp-dev use app-main
```

The router reads the manifest at every **new** MCP initialization. Existing MCP
sessions stay pinned to their original target, even after `use`, so a reconnect
is explicit and safe rather than silently moving a live agent across code or
data. Every proxied response carries `X-Gonk-Dev-*` identity headers. Tool
descriptions and results for anything not declared `readOnlyHint` also include
the active code checkout, branch, and database target. This is intentionally
conservative: a tool with no read-only declaration is treated as potentially
write-capable.

The switchboard does not run app code itself. Each environment must first expose
its own Gonk `ToolRegistry` through `createHttpMcpServer`; this keeps the
transport reusable across applications while
keeping code target and data target separate in the manifest.

## Tool input schema

Pulled from `resolveInputJsonSchema(tool)`: an explicit
`tool.inputJsonSchema` override wins, otherwise the adapter reads the JSON
Schema annotation attached by `withJsonSchema(schema, jsonSchema)` or
`shape(check, message, jsonSchema)`. When no projection is present, the adapter
advertises `{ type: "object", additionalProperties: true }`.

Prefer an annotated Standard Schema input so the runtime validator and MCP
advertisement stay next to each other:

```ts
import { shape } from "@gonk/tool-registry";

const input = shape<{ query: string }>(
  (value): value is { query: string } =>
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { query?: unknown }).query === "string",
  "expected { query: string }",
  {
    type: "object",
    properties: { query: { type: "string", minLength: 1 } },
    required: ["query"],
    additionalProperties: false,
  }
);
```

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
