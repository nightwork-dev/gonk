# Gonk host setup — binding a principal

Every Gonk host binds a principal before it can invoke a tool: `ToolContext.auth`
is required, and core refuses to invoke without one. There is no "assume owner"
fallback inside Gonk — a host that forgets to bind fails loudly (`AUTH_REQUIRED`)
rather than silently acting as owner.

Binding a principal is only half the setup. A registry's approval-tier gate is a
separate, second decision — see [Approval posture](#approval-posture-the-required-second-step)
below. Skipping it is the most common way a new host's first tool call fails.

## Which shape am I?

| Host shape | Example | Recipe |
| --- | --- | --- |
| Single-owner, in-process | a Pi extension, a script | [In-process](#single-owner-in-process) |
| Single-owner, out-of-process | a CLI binary | [Out-of-process (CLI)](#single-owner-out-of-process-cli) |
| Per-turn, multiple principals | an MCP server serving more than one caller | [Per-turn multi-principal](#per-turn-multi-principal-mcp) |

## Single-owner: in-process

Bind once at startup, then invoke through the bound handle. Downstream call
sites never thread `auth` per call.

```ts
import { ownerPrincipal } from "@gonk/auth";
import { ToolRegistry } from "@gonk/tool-registry";

const registry = new ToolRegistry({ security: { approvalMode: "bypass" } });
registry.register(searchNotesTool);

const bound = registry.withPrincipal(ownerPrincipal(process.env));

for await (const event of bound.invoke("notes.search", { query: "x" }, {
  signal: new AbortController().signal,
  log: console,
  cwd: process.cwd(),
  env: process.env,
})) {
  // ...
}
```

`ownerPrincipal(env)` derives a deterministic local principal from the
environment: subject from `env.USER`/`env.USERNAME`, falling back to the OS
user, then `"owner"`; issuer from `gonk:local:<host>`, where `<host>` is
`env.HOSTNAME`/`env.COMPUTERNAME`, falling back to the OS hostname, then
`"local"`. Same `env` in, same principal id out — security-context keys and
receipts stay stable across restarts. Its `authorize()` allows everything: it
is the single-owner boundary constructor, not a policy engine.

There is deliberately no default inside `@gonk/tool-registry` itself. A host
that wants an owner principal has to say so — `ownerPrincipal(env)` — every
time; Gonk never fabricates one for a caller that left `auth` off.

## Single-owner: out-of-process (CLI)

The CLI adapter takes the same principal as a required option and threads it
into every invocation for you:

```ts
import { ownerPrincipal } from "@gonk/auth";
import { ToolRegistry } from "@gonk/tool-registry";
import { createCli } from "@gonk/tool-registry-cli";

const registry = new ToolRegistry({ security: { approvalMode: "bypass" } });
registry.register([searchNotesTool, renameNoteTool]);

const cli = createCli({
  binaryName: "notes",
  source: registry,
  auth: ownerPrincipal(process.env),
});

await cli.run(process.argv.slice(2));
```

The Pi adapter (`registerGonkTools`) and `@gonk/extension-spec-pi`'s
`registerSpecExtension` take the same required `auth` option, same pattern.

## Approval posture — the required second step

Binding a principal turns on authorization. It does **not** turn on approval —
that is a separate registry-construction-time decision, and skipping it is
the trap: `notes.rename` above declares `approval: "write"`; the moment a real
`auth` flows through, an unconfigured registry denies it with
`APPROVAL_DENIED: "Approval provider not configured"`. **That error is the
system working, not a bug** — a write/exec tool fails closed by design until
you tell the registry what "approved" means for this host.

Pick one, deliberately, at `new ToolRegistry({ security: {...} })`:

- **`approvalMode: "bypass"`** — this host is itself the trust boundary (a
  script, a CLI you run by hand, a test). Every authenticated call is
  pre-approved. This is what both recipes above use.
- **`approvalProvider: { decide(...) }`** — a real approval gate: prompt a
  human, check a policy service, consult a grant store. Use this for any host
  where "the process is running" isn't sufficient trust for a write/exec tool.
- **Configure neither** — the default. Every authenticated `"write"`/`"exec"`
  tool call is denied until you pick one of the two options above; `"read"`
  tier tools are unaffected. Fine for a host that genuinely has no write
  tools yet; wrong the moment it registers one.

## Per-turn multi-principal (MCP)

A host with more than one caller — an MCP server other agents connect to —
does not bind one principal at startup. It resolves a fresh `AuthContext` per
request, from whatever the transport already authenticated:

```ts
import { ownerPrincipal, type AuthContext } from "@gonk/auth";
import { ToolRegistry } from "@gonk/tool-registry";
import { createMcpServer } from "@gonk/tool-registry-mcp";

const registry = new ToolRegistry();
registry.register(searchNotesTool);

createMcpServer({
  serverName: "notes",
  serverVersion: "1.0.0",
  source: registry,
  makeAuthContext: async (extra): Promise<AuthContext> => {
    // Resolve from the transport-authenticated caller — never a fixed
    // owner. A single-caller MCP server (a local plugin server with no
    // external callers) can still legitimately return ownerPrincipal(...)
    // here; the point is that a MULTI-caller server resolves per request.
    return principalForRequest(extra);
  },
});
```

`McpAdapterOptions.makeAuthContext` is required for exactly this reason: MCP
is the "per-turn principal" host shape, so there is no single bound handle to
reach for.

## Crossing a string-only seam: the trusted envelope

When a principal has to cross a seam that only carries strings — an
attribute bag, an environment variable, a hook's stdin — use the trusted
envelope codec (`@gonk/auth`, client-safe subpath `@gonk/auth/contracts`)
instead of hand-rolling JSON:

```ts
import { encodeTrustedEnvelope, decodeTrustedEnvelope } from "@gonk/auth/contracts";

const raw = encodeTrustedEnvelope({ principal: owner.principal });
// ...crosses the seam as a plain string...
const envelope = decodeTrustedEnvelope(raw);
```

The codec is a **transport, not a trust source**. `decodeTrustedEnvelope`
reconstructs principal data and never constructs an `authorize()` — the host
on the receiving end must already trust the channel the string arrived on
before treating the decoded principal as real. Handing a decoded envelope
straight to `registry.withPrincipal(...)` without that upstream trust check
is the ambient-owner problem again, one layer up.
