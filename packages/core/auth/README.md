# @gonk/auth

Transport-independent security contracts for Gonk hosts, registries, and
adapters. Hosts authenticate callers using their native mechanism and normalize
the result into an `AuthenticatedPrincipal`; Gonk carries that principal through
an `AuthContext` and records redacted authorization and approval receipts.

This package does not verify JWTs, host login UI, store credentials, depend on
MCP, or implement a policy engine.

## Principal and delegation

`identity` is the effective subject whose authority is being exercised.
`delegation` records the verified immediate agent or service acting for that
subject.

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
      issuer: "sigil:eve",
      subject: "agent-1",
      method: "service-token",
    },
    actorId: "eve-agent-1",
    actorSessionId: "session-a",
  },
  roles: ["member"],
  scopes: ["reviews:write"],
};
```

## Binding keys

```ts
import { persistentGrantKey, securityContextKey } from "@gonk/auth";

const sessionKey = securityContextKey({ principal });
const alwaysAllowKey = persistentGrantKey({ principal });
```

Both opaque keys bind subject, actor identity/id, tenant, and workspace.
`securityContextKey` also binds the delegated actor session and is used for
stateful transports, one-call assertions, and session grants.
`persistentGrantKey` deliberately survives an agent-session restart and is used
for tightly constrained persistent grants.

Roles, scopes, token expiry, and host attributes are revalidated policy inputs;
they are not key material. Attributes use the exported recursive
`AuthClaimRecord` plain-data contract—no functions, class instances, `Set`,
`Map`, or mutable date objects cross the authorization boundary.

## Authorization

```ts
import type { AuthContext } from "@gonk/auth";

const auth: AuthContext = {
  principal,
  authorize: ({ action, resource }) =>
    policy.authorize(principal, action, resource),
};
```

`AuthContext` is generic and imports no tool-registry or transport types.

### Request-bound capture

Use `captureAuthContext(auth)` when an authorization context crosses into an
asynchronous request lifecycle. It validates, clones, and deeply freezes the
principal, then binds `authorize` once. Later mutation of the host's principal
object or replacement of its policy method cannot change the identity or
policy function captured for that request. Class-based policy receivers remain
supported.

## Audit redaction

`redactAuthzResource()` removes resource metadata and returns the small
attributable projection accepted by security receipts. Credentials,
complete tool inputs, prompts, and document bodies do not belong in receipts.

## Install

```sh
npm i @gonk/auth
```

## License

Apache-2.0.
