# @gonk/tool-registry

Core tool definition shape, registry, and dispatch path. Harness-agnostic — the same `ToolDefinition` runs through CLI / MCP / Pi adapters without modification.

## Short path

Use one Standard Schema value for runtime validation and attach the JSON Schema
projection adapters advertise from that same value.

```ts
import { ToolRegistry, shape } from "@gonk/tool-registry";

const searchNotesInput = shape<{ query: string; limit?: number }>(
  (value): value is { query: string; limit?: number } =>
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { query?: unknown }).query === "string",
  "expected { query: string; limit?: number }",
  {
    type: "object",
    properties: {
      query: { type: "string", minLength: 1 },
      limit: { type: "number", minimum: 1, maximum: 20 },
    },
    required: ["query"],
    additionalProperties: false,
  }
);

const registry = new ToolRegistry();
registry.register({
  name: "notes.search",
  description: "Search notes visible to the authenticated principal.",
  input: searchNotesInput,
  approval: "read",
  capabilities: { readsFs: true, idempotent: true },
  hints: { mcp: { annotations: { readOnly: true, idempotent: true } } },
  handler: async (input, ctx) => {
    const workspaceId = ctx.auth?.principal.workspaceId;
    return { data: await searchNotes(workspaceId, input.query, input.limit) };
  },
});
```

Use `withJsonSchema(schema, jsonSchema)` when your schema library already
implements Standard Schema (Zod, Valibot, ArkType). Use
`shape(check, message, jsonSchema)` only when a small hand-written guard is
enough. Avoid maintaining `input` and `inputJsonSchema` as parallel sources
unless you are intentionally overriding an adapter surface.

See [../../docs/tool-authoring.md](../../docs/tool-authoring.md) for registry
composition, authenticated writes, and embedded MCP routes.

## ToolDefinition

```ts
interface ToolDefinition<I, O> {
  name: string;
  description: string;
  category?: string;
  visibility?: "always" | "on-demand";
  input: StandardSchemaV1<unknown, I>;
  output?: StandardSchemaV1<unknown, O>;
  inputJsonSchema?: Record<string, unknown>;     // adapter override; prefer an annotated input schema
  validateOutput?: "off" | "lax" | "strict";
  handler: (input: I, ctx: ToolContext) => Promise<ToolResult<O>> | AsyncIterable<ToolEvent<O>>;
  capabilities?: { readsFs?, writesFs?, network?, longRunning?, idempotent?, duplex? };
  tags?, keywords?, relatedTo?;
  hints?: { cli, mcp, pi };
}
```

## ToolContext

What the handler gets:

- `signal: AbortSignal` — cancellation, wired by the adapter
- `log: Logger` — structured logger; tools should never write stdout/stderr directly
- `cwd: string`, `env: Readonly<...>`
- `scope?: ScopeStore` — five-tier scope (from `@gonk/scope`), bound by adapters that support it
- `auth?: AuthContext` — trusted effective subject/delegation and the policy
  callback enforced for discovery, root invocation, and every composed child
- `invoke(name, input)` — cross-tool composition, cycle-detected, runs through the same dispatch path
- `callStack: readonly string[]` — names of tools currently on the call stack
- `input?: AsyncIterable<InputChunk>` — bidirectional stream for duplex tools (audio, interactive sessions)

## Streaming + non-streaming

A handler can return either `Promise<ToolResult>` (simple case) or `AsyncIterable<ToolEvent>` (streaming). Adapters consume the registry's invoke stream uniformly:

```ts
type ToolEvent =
  | { type: "log"; level: ...; message: string; meta?: unknown }
  | { type: "progress"; percent?, message? }
  | { type: "data"; chunk: unknown }
  | { type: "result"; data: T; display?: Display }
  | { type: "error"; code: string; message: string; details? };
```

## Entry points

```ts
import { ToolRegistry } from "@gonk/tool-registry";
import type { ToolDefinition } from "@gonk/tool-registry/types";   // types only
import { ToolRegistry } from "@gonk/tool-registry/registry";
import { ToolError } from "@gonk/tool-registry/errors";
import { inMemorySink, consoleSink } from "@gonk/tool-registry/metrics";
import { resolveApproval } from "@gonk/tool-registry/approval";
import { withJsonSchema } from "@gonk/tool-registry/json-schema";
import { dispatchDetachedWithWait } from "@gonk/tool-registry/async-dispatch";
import { collectToolOutcome } from "@gonk/tool-registry/outcome";
import type {
  ToolResourceResolver,
  ApprovalProvider,
} from "@gonk/tool-registry/security";
```

## Authenticated dispatch

Authentication stays outside the registry. A host or adapter validates its
credential, builds an `AuthenticatedPrincipal` and `AuthContext`, then supplies
that context to `makeBaseContext({ auth })`.

When `ctx.auth` is present, dispatch:

1. authorizes `tool.discover` before input validation, so hidden and missing
   root tools have the same result;
2. validates input;
3. resolves any declared authoritative application resource through the
   registry's `ToolResourceResolver`;
4. authorizes `tool.invoke`;
5. normalizes missing or malformed approval declarations to `exec`, then
   resolves write/exec approval through the configured `ApprovalProvider`;
6. emits separate redacted authorization and approval receipts;
7. invokes the handler only after every required gate allows.

Composed `ctx.invoke()` calls retain the original principal, request id, and
call stack and are independently re-authorized. A required approval is a
completed non-executing `APPROVAL_REQUIRED` error event with structured,
redacted details; the registry never suspends a transport request while a human
decides.

```ts
import {
  ToolRegistry,
  makeBaseContext,
} from "@gonk/tool-registry";

const registry = new ToolRegistry({
  security: {
    resourceResolver,
    approvalProvider,
    auditSink,
    mandatoryAudit: true,
  },
});

for await (const event of registry.invoke(
  "review.annotate",
  input,
  makeBaseContext({ auth }),
)) {
  // ...
}
```

Trusted internal callers may deliberately omit `ctx.auth`; that legacy path
remains distinguishable from an authenticated human and emits no human
security receipts.

Authenticated write and exec tools fail closed with `APPROVAL_DENIED` when no
provider is configured. A trusted host that intentionally enforces consent
outside Gonk may set `security.approvalMode: "bypass"`; the default is
`"enforce"`. Read-tier tools need no provider unless one is installed and wants
to make an explicit read decision.

## Conditional registration

`ToolDefinition` accepts an optional `requires?: () => boolean` predicate:

```ts
r.register({
  name: "speak",
  requires: () => Boolean(scope.get("voice.tts.providers")),
  // ...
});
```

When `requires` returns `false`, `ToolRegistry.register()` silently skips the tool — it is
never stored, never advertised in the active set, and never invokable. Re-registration after
conditions change requires a new `register()` call. Use this to gate tools on provider
configuration, feature flags, or runtime capability checks.

## Example

```ts
import { ToolRegistry, makeBaseContext } from "@gonk/tool-registry";

const r = new ToolRegistry();
r.register({
  name: "echo",
  description: "echo input",
  input: someSchema,
  handler: async (input) => ({ data: { echoed: input.text } }),
});

for await (const event of r.invoke("echo", { text: "hi" }, makeBaseContext())) {
  if (event.type === "result") console.log(event.data);
}
```

## Projections — one definition, many surfaces

Define an op once as a `ToolDefinition`; project it to whoever asks. All projections
are zero-codegen and transport-agnostic.

- **Typed client** (`createClient`, `mergeToolSets`, `defineTools`) — a client whose
  methods infer input/output off the tool generics, no codegen and no hand-written
  manifest. Requires the ops be carried as a statically-typed `const` tuple; a
  duplicate name, a client-key collision, or a non-camelCase-dotted name throws at
  construction (mirrors `register`).
- **WebSocket** (`makeWsHandler`) — request/reply + mutation broadcast over an injected
  emitter, no ws-library dependency.
- **JSON Schema** (`resolveInputJsonSchema`, `withJsonSchema`) — resolves the schema a
  machine surface advertises (override → attached annotation → `{}`; it is *trusted*,
  not derived from the predicate).

### WS authorization model

`makeWsHandler` takes a host-injected `authorize(tool, caller, input)` policy checked
**before dispatch** (declared-in-core / enforced-in-host, same split as `approval`).

The WebSocket projection's legacy `authorize(tool, caller, input)` callback
still gates only the requested entry operation. Hosts that need the stronger
registry contract should normalize `caller` into an `AuthContext` and dispatch
with `makeBaseContext({ auth })`; registry authorization then covers both the
root tool and every composed `ctx.invoke()` child.

Broadcast fans a succeeded op's result to **all** connected clients regardless of *their*
authorization, so the default broadcasts only *unrestricted* writes; a host that
broadcasts a restricted op must scope the audience at the socket layer.

## Async dispatch — detach-by-default, wait opt-in

`dispatchDetachedWithWait` (from `@gonk/tool-registry/async-dispatch`) is the tool-layer
combinator for heavy (minutes-scale) tools: dispatch a **detached** worker and return a job
handle immediately, unless the caller opts INTO blocking with `wait`/`sync`. It is a pure
combinator over injected closures — it owns no dispatch mechanism (that's `@gonk/jobs`
`dispatchDetached`) and no result shape (the consumer renders both branches):

```ts
handler: async (input, ctx) =>
  dispatchDetachedWithWait({
    input,                                   // { wait?, sync? } — caller's opt-in
    kind: "subagent",
    asyncDispatch: () => launchDetached(...), // → { jobId, ... }; omit ⇒ inline fallback
    runInline: () => runNow(...),             // the blocking path
    renderInline: (r) => ({ data: r }),
    renderAsync: (d) => ({ data: { jobId: d.jobId, workItemId: d.workItemId } }),
  });
```

Detached is the default so a heavy tool never silently blocks the parent; `wait: true` is the
opt-out for a caller that genuinely needs the result inline (e.g. a review gate). When no
`asyncDispatch` is wired the call degrades to inline and flags `ranSyncFallback` to
`renderInline`. Used by the delegation cluster (`subagent`, `consult`) and the heavy-tool
consumers (`image_generate`, `rlm_*`, `harness_dispatch`).
