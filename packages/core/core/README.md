# @gonk/core

Convenience barrel over three gonk foundation packages — authenticated
principal and authorization contracts ([`@gonk/auth`](../auth)), the typed tool
registry ([`@gonk/tool-registry`](../tool-registry)), and the five-tier scope
system ([`@gonk/scope`](../scope)) — under a single import:

```ts
import {
  securityContextKey,
  ToolRegistry,
  createScope,
} from "@gonk/core";
```

It re-exports the public surface of both packages with explicit, named, type/value-split re-exports (no `export *`), so the surface stays auditable and tree-shakeable. **Reach for the focused package directly when you want a tighter dependency** — `@gonk/core` exists for the common case where you want both at once.

## What it brings in

From **`@gonk/auth`**: the transport-independent `AuthenticatedPrincipal` and
`AuthContext` contracts, session and persistent-grant binding keys, redacted
authorization resources, and authorization/approval receipt types.

From **`@gonk/tool-registry`**: the `ToolDefinition` shape, `ToolRegistry`,
`makeBaseContext`, registry-level discovery/invocation authorization, resource
resolution, approval providers, schema helpers, error types, metrics sinks, and
the full handler/event type surface.

From **`@gonk/scope`**: the five-tier scope store (`FsScopeStore`, `MemoryScopeStore`, `createScope`), root/document discovery (`findProjectRoot`, `scanDocuments`, `bindRoots`, `resolveTierHomes`), substrate helpers (`substrateDir`, `resolveNativeSubstrateHome`, the migration family), session resolution (`resolveSessionId`, `resolveStableSessionId`, `sessionMemoryDbPath`), and the type surface (`ScopeStore`, `ScopeName`, `RootKind`, `DocumentEntry`, …).

See each package's README for the full, documented API.

## Install

```sh
npm i @gonk/core
```

## Example

```ts
import { ToolRegistry, makeBaseContext, createScope } from "@gonk/core";

const scope = createScope();                   // FsScopeStore over process.cwd()
const r = new ToolRegistry();
r.register({
  name: "echo",
  description: "echo input",
  input: { "~standard": { vendor: "…" } },      // any Standard Schema
  handler: async (input) => ({ data: { echoed: input.text } }),
});

for await (const event of r.invoke("echo", { text: "hi" }, makeBaseContext({ scope }))) {
  if (event.type === "result") console.log(event.data);
}
```

## License

Apache-2.0.
