# @gonk/auth

Identity and authorization types for agent tools. Your host authenticates a
caller in its own way: a login session, an API key, a service token. It then
describes the result as an `AuthenticatedPrincipal`. Gonk carries that
principal with every tool call in an `AuthContext`, together with your
authorization policy, and writes redacted audit receipts.

The other `@gonk/*` packages take an `AuthContext`:
[`@gonk/tool-registry`](https://www.npmjs.com/package/@gonk/tool-registry)
checks it before every tool call,
[`@gonk/tool-registry-mcp`](https://www.npmjs.com/package/@gonk/tool-registry-mcp)
builds one per request, and
[`@gonk/context`](https://www.npmjs.com/package/@gonk/context) and
[`@gonk/skills`](https://www.npmjs.com/package/@gonk/skills) use it to decide
what a caller may see or change.

This package does not verify tokens, show a login screen, store credentials or
include a policy engine. Those stay in your host.

## Install

```sh
npm install @gonk/auth
```

## Quick start: a single-user host

A local CLI or a personal MCP server has one user. `ownerPrincipal()` builds a
local principal for that user and a policy that allows everything:

```ts
import { ownerPrincipal } from "@gonk/auth";

const auth = ownerPrincipal(process.env);
// auth.principal → { id: "local:gonk:local:<host>:<user>", kind: "local", roles: ["owner"], ... }
```

The same environment always gives the same principal ID, so keys and receipts
stay stable across restarts. Use it only when there is exactly one caller.

## Principals and delegation

A host with real users builds the principal from its own authentication.
`identity` is the subject whose authority is used. `delegation` records the
agent or service that acts for that subject.

```ts
import type { AuthenticatedPrincipal } from "@gonk/auth";

const principal: AuthenticatedPrincipal = {
  id: "principal:user-1",
  kind: "human",
  identity: {
    issuer: "https://accounts.example",
    subject: "user-1",
    method: "oauth",
  },
  workspaceId: "workspace-1",
  delegation: {
    actorKind: "agent",
    actor: {
      issuer: "https://identity.example",
      subject: "agent-1",
      method: "service-token",
    },
    actorId: "review-agent",
    actorSessionId: "session-a",
  },
  roles: ["member"],
  scopes: ["reviews:write"],
};
```

## Authorization

An `AuthContext` pairs the principal with your policy:

```ts
import type { AuthContext } from "@gonk/auth";

const auth: AuthContext = {
  principal,
  authorize: ({ action, resource }) =>
    policy.allows(principal, action, resource)
      ? { outcome: "allow", reason: "member of workspace" }
      : { outcome: "deny", reason: "not a member" },
};
```

`action` names what is being attempted, for example `tool.discover`,
`tool.invoke`, `context.use` or `skill.read`. `resource` describes what it is
attempted on. `AuthContext` imports no transport or tool types, so you can
build it anywhere.

When an `AuthContext` enters an asynchronous request, wrap it with
`captureAuthContext(auth)`. This validates the principal, makes a frozen copy,
and binds `authorize` once. Later changes to the host's objects cannot change
the identity or policy used for that request.

## Binding keys

```ts
import { persistentGrantKey, securityContextKey } from "@gonk/auth";

const sessionKey = securityContextKey({ principal });
const alwaysAllowKey = persistentGrantKey({ principal });
```

Both return opaque keys built from the subject, the acting agent, the tenant
and the workspace.

- `securityContextKey` also includes the agent's session. Use it for stateful
  connections and grants that last one session.
- `persistentGrantKey` stays the same when the agent session restarts. Use it
  for narrow grants that must persist.

Roles, scopes, token expiry and attributes are not part of either key. They
are checked again on every decision. Attributes must be plain data
(`AuthClaimRecord`): no functions, class instances, `Set`, `Map` or `Date`
objects.

## Passing a principal across a boundary

`encodeTrustedEnvelope()` and `decodeTrustedEnvelope()` turn a principal into
a versioned JSON string and back. Use them to pass a principal through a
channel that carries only strings, such as an environment variable or a hook's
input. Decoding does not authenticate anyone. Trust the decoded principal only
if you already trust the channel it arrived on. A malformed string or an
unknown version throws a `TrustedEnvelopeError`.

## Audit redaction

`redactAuthzResource()` strips a resource down to the small, attributable
summary that audit receipts accept. Credentials, full tool inputs, prompts and
document bodies never belong in receipts.

## Entry points

| Import | Contents |
| --- | --- |
| `@gonk/auth` | Everything, including Node-only helpers such as `ownerPrincipal` and the binding keys. |
| `@gonk/auth/contracts` | Types, validators and the envelope codec only, with no Node built-ins. Safe for browser code. |

## License

Apache-2.0
