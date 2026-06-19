# @gonk/tool-registry-pi

Pi adapter — registers `ToolDefinition`s as native Pi-callable tools via `pi.registerTool({...})`.

The adapter declares **structural types** for the Pi extension API. It does not import `@earendil-works/pi-coding-agent` directly, so consumers can install this package without pulling Pi's runtime. The user's real `ExtensionAPI` matches the structural interface at call time.

## Usage

```ts
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";   // user's project
import { registerGonkTools } from "@gonk/tool-registry-pi";

export default function setup(pi: ExtensionAPI) {
  const result = registerGonkTools({
    pi,
    source: orchestrator,
    scope: scopeStore,             // threaded into ctx.scope for every invocation
    filter: (t) => !t.name.startsWith("internal-"),  // optional
  });
  // result.registered, result.skipped[]
}
```

## What it does per tool

Maps `ToolDefinition` → `pi.registerTool({...})`:

| gonk | Pi |
|---|---|
| `name` | `name` (or `hints.pi.piName`) |
| `description` | `description` |
| `inputJsonSchema` | `parameters` (typebox is JSON Schema) |
| `handler` (Promise or AsyncIterable) | `execute(toolCallId, params, signal, onUpdate, ctx)` |
| `progress` events | `onUpdate({ type: "progress", ... })` |
| `data` events | `onUpdate({ type: "data", chunk })` |
| `result.display` | `content[]` (rendered) |
| `result.data` | `details` |
| `error` event | `{ isError: true, content }` |

Duplex tools (`capabilities.duplex`) are filtered out — Pi's `registerTool` is request/response. They appear in `result.skipped[]` for diagnostics.

## What it does NOT do

- It does not register Pi commands (`/foo`). Commands are user-facing; this adapter is agent-facing.
- It does not import `pi-ext-kit` or build a Pi `ExtensionMeta`. That's the job of the consuming Pi extension package (e.g. `@gonk/pi-extension`).
