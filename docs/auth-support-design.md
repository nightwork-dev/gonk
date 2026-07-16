# Gonk authentication and authorization support

Status: **implemented for core Slices 0–3**

This document records the shipped Gonk Core security boundary. It is the
repository-level companion to the larger product integration specification:
Gonk owns transport-independent principal, authorization, approval, audit, and
session-binding contracts; applications and transport adapters own credential
verification and product policy.

## Center of the design

Authentication is not an MCP feature.

A host proves identity using its native mechanism—application session, OAuth,
JWT, service token, mTLS, tailnet identity, transport account, or an explicit
local identity—and normalizes the result into `AuthenticatedPrincipal`. Gonk
then carries an `AuthContext` through discovery and dispatch:

```text
credential / host session
        |
        v
host authenticator
        |
        v
AuthenticatedPrincipal + AuthContext
        |
        +--> adapter discovery filtering
        |
        +--> ToolRegistry authorization / resource resolution / approval
        |
        +--> redacted authorization and approval receipts
```

MCP is one adapter over this model. Plain HTTP, WebSocket, comms transports, and
local hosts can use the same contracts without importing MCP types.

## Package boundaries

### `@gonk/auth`

Owns:

- effective-subject and verified delegation types;
- `AuthContext` and authorization request/decision contracts;
- `securityContextKey()` for stateful transports, one-call assertions, and
  session grants;
- `persistentGrantKey()` for constrained grants that survive an agent-session
  restart;
- redacted authorization and approval receipt types.

It imports neither the tool registry nor an authentication-provider SDK.

Core-owned authentication methods, authorization actions, resource kinds, and
scopes are closed unions. Application-specific extensions use an explicit
`custom:*` or `application:*` namespace; resource metadata is `unknown` until
the owning package validates it with its runtime schema rather than an
unvalidated record bag.

### `@gonk/tool-registry`

Owns:

- enforcement at the common dispatch boundary;
- authoritative application-resource resolution;
- approval-provider integration;
- separate authorization and approval receipts;
- structured non-suspending approval-required outcomes;
- propagation and reauthorization across `ctx.invoke()`.

### `@gonk/tool-orchestrator`

Owns principal-aware filtering for every catalog/meta-tool surface. Hidden tool
names, descriptions, schemas, rankings, and pin operations are not exposed.

### `@gonk/tool-registry-mcp`

Owns:

- translation from SDK `AuthInfo.extra` to the typed Gonk principal;
- principal-filtered MCP discovery;
- registry auth-context propagation;
- stateful streamable-HTTP session binding.

## Principal model

`AuthenticatedPrincipal.identity` is the effective subject whose authority is
being exercised. `delegation` records the verified immediate agent or service
acting for that subject.

The two identities are deliberately not interchangeable. A delegated agent
does not replace the human/application subject, and tool input is never an
authoritative source for either identity.

Tenant and workspace are selected and verified by trusted host state. Roles,
scopes, expiry, and attributes are current claims used by policy; they are not
stable identity. Attributes are recursively plain `AuthClaimRecord` data so the
registry can expose an immutable snapshot to handlers without mutable `Set`,
`Map`, date, class-instance, or function escape hatches.

## Binding keys

Both opaque keys bind:

- effective-subject issuer, subject, and principal kind;
- tenant and active workspace;
- delegation actor issuer, subject, kind, and actor id.

`securityContextKey()` additionally binds `actorSessionId`.

That separation gives the intended product semantics:

- token refresh or changed roles/scopes may continue on the same transport
  session;
- a changed subject, actor, tenant, workspace, or actor session cannot reuse a
  stateful session;
- an “Allow for Session” grant expires with the actor session;
- a tightly constrained “Always Allow” grant may survive an actor-session
  restart while remaining bound to the same subject and actor identity.

Credentials, raw tokens, roles, scopes, and expiry are never key material.

## Registry enforcement order

For authenticated root invocation:

1. resolve the registered tool;
2. authorize `tool.discover`;
3. if hidden, return the same `TOOL_NOT_FOUND` event as a missing tool;
4. validate input;
5. resolve any required authoritative application resource;
6. authorize `tool.invoke` against the canonical tool resource and resolved
   related resources;
7. write the authorization receipt;
8. resolve approval and write a separate approval receipt;
9. invoke the handler.

This ordering prevents validation errors and application-resource lookups from
becoming hidden-tool oracles.

Required resource resolution fails closed. The resolver receives trusted
principal, validated input, tool definition, and call stack; policy does not
trust caller-supplied tenant/workspace/resource claims.

Every composed `ctx.invoke()` child retains the original principal, request id,
and security-context key and is independently authorized. Root discovery is not
repeated for child calls, but invocation authorization, resource resolution,
approval, and receipts are.

Trusted internal invocation may deliberately omit `ctx.auth`. That path
preserves compatibility and does not emit receipts claiming a human actor.

## Approval behavior

Authorization and approval are separate decisions:

- authorization answers whether the principal may perform the action;
- approval answers whether the allowed action has the required user/operator
  consent.

An approval provider may return `approved`, `denied`, or `required`.
`required` completes the invocation without starting the handler and emits:

```ts
{
  type: "error",
  code: "APPROVAL_REQUIRED",
  message: "Approval required",
  details: {
    requestId,
    approvalRequestId,
    toolName,
    approvalTier,
    reason,
    resource,
    relatedResources?,
    expiresAt?,
  },
}
```

The details are structured and redacted. They contain no raw credential,
complete tool input, prompt, or document body. The application may persist the
request, prompt the user, and retry; the registry does not hold an MCP or HTTP
request open.

Authenticated dispatch treats a missing or malformed approval declaration as
`exec`. Write and exec tiers fail closed when no `ApprovalProvider` is
installed. Trusted hosts may deliberately opt out with
`approvalMode: "bypass"`; omission never implies bypass. Read-tier tools may run
without a provider, while an installed provider may still make an explicit
read decision.

## MCP and Web authentication

For custom Web MCP authentication:

1. the host `authenticate(request)` verifies the credential;
2. it returns SDK `AuthInfo`;
3. `AuthInfo.extra[GONK_AUTH_INFO_PRINCIPAL]` carries the normalized principal;
4. the adapter validates that principal;
5. `makeAuthContext` supplies product policy for the same principal;
6. discovery and invocation use that context.

Static bearer mode synthesizes a stable service principal. Credential-free Web
mounting requires explicit `allowInsecure: true` and synthesizes a visibly
development-only local principal. The standalone HTTP server may infer this
credential posture only from an actual loopback bind.

Authenticated Web mounting requires `makeAuthContext` unless the host explicitly
selects `allowUnrestrictedTools: true` trusted-service mode. Authentication does
not silently become authorization.

`makeAuthContext` is the only authenticated MCP policy seam. The earlier
top-level `authorize({ tool, input, request, approval })` callback was removed:
it had no typed principal or discovery contract and required a fabricated
identity to participate in registry enforcement.

`makeContext` carries non-security host data only. Returning `auth` from it is
rejected before `tools/list` can advertise the catalog, preventing an
invocation-only policy from creating a discovery side channel.

## Stateful Web MCP sessions

The Web handler stores:

```ts
Mcp-Session-Id -> {
  transport,
  securityContextKey,
}
```

Every POST, GET, and DELETE is authenticated again. The current key must equal
the initializing key before the request reaches the transport.

A mismatch:

- returns the same unknown-session response as a missing session;
- does not execute a tool;
- emits a redacted `session-binding` receipt when the host configures
  `sessionAuditSink`;
- does not close or mutate the legitimate principal's session.

The request's current revalidated claims are still passed to MCP handling when
the key matches, so refreshed roles, scopes, membership, and expiry can affect
the next authorization decision.

## Compatibility

- `ToolContext.auth` is optional.
- Registry construction without security options preserves trusted local
  behavior.
- Static bearer and explicit keyless loopback development remain supported.
- Published `collectToolOutcome` and input-schema projection behavior remain
  available.
- Existing tools do not need to import `@gonk/auth`.

## Security invariants covered by tests

- hidden root tools are checked before validation;
- hidden and missing MCP tools are indistinguishable;
- discovery and invocation share the same principal policy;
- required resources fail closed and cannot trust spoofed input scope;
- nested tool calls retain the original principal and reauthorize;
- authorization and approval receipts are separate and redacted;
- approval-required is structured, completed, and non-executing;
- all orchestrator catalog/meta-tools filter hidden tools before disclosure,
  ranking, or pin mutation;
- authenticated write/exec approval fails closed without a provider and
  missing or malformed declarations default to `exec`;
- `load_tool` and `unload_tool` are write-tier operations covered by approval
  and MCP write allowlisting;
- Alice's MCP session cannot be reused by Bob;
- token/claim refresh for Alice continues when the security key is unchanged;
- changing delegated actor session invalidates transport reuse;
- a mismatch preserves Alice's valid session;
- static bearer and explicit keyless local modes have synthetic principals;
- delegated Web MCP principals require an actor-session binding.

## Deferred product work

The following are application/integration slices, not missing Gonk Core
enforcement:

- Sigil/Eve policy and grant persistence;
- user approval UI and durable resume flow;
- one-call signed approval assertions;
- connection-store authorization and credential references;
- comms ingress/read policy integration;
- browser/session route policy;
- grant inspection and revocation UI.

Those consumers should build on the shipped principal, binding-key,
authorization, approval, receipt, and adapter seams rather than creating an
MCP-specific identity model.
