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
