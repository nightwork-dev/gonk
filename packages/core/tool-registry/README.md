# @gonk/tool-registry

Core tool definition shape, registry, and dispatch path. Harness-agnostic — the same `ToolDefinition` runs through CLI / MCP / Pi adapters without modification.

## ToolDefinition

```ts
interface ToolDefinition<I, O> {
  name: string;
  description: string;
  category?: string;
  visibility?: "always" | "on-demand";
  input: StandardSchemaV1<unknown, I>;
  output?: StandardSchemaV1<unknown, O>;
  inputJsonSchema?: Record<string, unknown>;     // for MCP advertisement / CLI help
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
import { dispatchDetachedWithWait } from "@gonk/tool-registry/async-dispatch";
```

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

### WS authorization model — transitive authority (read this)

`makeWsHandler` takes a host-injected `authorize(tool, caller, input)` policy checked
**before dispatch** (declared-in-core / enforced-in-host, same split as `approval`).

**`authorize` gates ENTRY to the requested op only.** If that op's handler composes
another tool via `ctx.invoke(...)`, the composed call runs at the entered tool's
authority and is **NOT re-authorized against the caller** — the registry dispatches
composition auth-agnostically (exactly as `approval` is not re-checked on compose). So
entering a tool grants its **transitive** authority.

**Contract:** do not expose (via `authorize`) a tool whose handler composes an operation
the caller must not reach directly. The direct entry gate always holds — a caller cannot
invoke an unauthorized op straight — the caveat is only the indirect internal-compose
path. A stronger guarantee (re-authorizing every composed call against the original
caller) needs a registry-level authorize hook and is intentionally not built until a
consumer composes across trust boundaries.

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
