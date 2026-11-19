# @gonk/tool-orchestrator

Combine one or more [`@gonk/tool-registry`](https://www.npmjs.com/package/@gonk/tool-registry)
registries into one catalog, and control which tools the model sees at a time.
Hosts with many tools show a small active set and let the model search for and
load the rest on demand.

The host adapters, such as
[`@gonk/tool-registry-mcp`](https://www.npmjs.com/package/@gonk/tool-registry-mcp),
accept an orchestrator anywhere they accept a registry.

## Install

```sh
npm install @gonk/tool-orchestrator @gonk/tool-registry @gonk/auth
```

## Quick start

```ts
import { ownerPrincipal } from "@gonk/auth";
import { ToolRegistry, collectToolOutcome, makeBaseContext, passthrough } from "@gonk/tool-registry";
import { createOrchestrator } from "@gonk/tool-orchestrator";

const notes = new ToolRegistry();
notes.register([
  {
    name: "notes.search",
    description: "Search saved notes by keyword.",
    tags: ["notes", "search"],
    visibility: "always",
    input: passthrough(),
    approval: "read",
    handler: async () => ({ data: [] }),
  },
  {
    name: "notes.export",
    description: "Export notes as a PDF report.",
    tags: ["notes", "pdf"],
    visibility: "on-demand",
    input: passthrough(),
    approval: "read",
    handler: async () => ({ data: { exported: true } }),
  },
]);

const orch = createOrchestrator({ registries: [notes], scope: "mcp" });

orch.search("pdf report").map((r) => r.tool.name); // → ["notes.export"]
orch.activeSet().map((t) => t.name);                // `always` tools and the meta-tools

orch.pin("notes.export");      // queued
await orch.commitPins();       // applied at a point you choose
orch.activeSet().map((t) => t.name); // now ends with "notes.export"

await collectToolOutcome(
  orch.invoke("notes.export", {}, makeBaseContext({ auth: ownerPrincipal(process.env) })),
);
// → { ok: true, data: { exported: true } }
```

## What it does

- **One catalog.** Tools from several registries are combined into one
  catalog with one `invoke()` path.
- **Active set.** `activeSet()` returns the `always` tools sorted by name, then
  the committed pins in pin order. The list stays the same between commits,
  so a host can keep it in a cached prompt prefix.
- **Pins.** `pin()` and `unpin()` queue changes. `commitPins()` applies them at
  a point the host chooses, such as the end of a turn. `pinStore` can persist
  committed pins.
- **Search.** `search()` ranks tools with BM25 over the name, category,
  description, tags and keywords. The name counts the most. Pass `search` to
  `createOrchestrator` to use your own ranker. `bm25Search` and the simpler
  `legacySubstringSearch` are exported.
- **Per-host visibility.** `scope` names the host (`"mcp"`, `"pi"` or
  `"claude"`). A tool's `hints.mcp.visibility` or `hints.pi.visibility`
  overrides its default visibility for that host.

## Meta-tools

The orchestrator registers these tools in its first registry, so the model
can explore the catalog. Set `registerMetaTools: false` to turn this off.

| Tool | What it does |
| --- | --- |
| `list_tools` | Lists known tools, filtered by category, tag or visibility. |
| `find_tools` | Searches names, descriptions, tags and keywords. |
| `get_tool` | Returns the full schema and metadata of one tool. |
| `load_tool` | Pins a tool for the rest of the session. |
| `unload_tool` | Unpins a tool. |
| `tool_explain` | Returns a structured record of one tool: its description, cost and latency classes, capabilities, hints and input schema. It is `on-demand`. |

These tools check `tool.discover` against the caller's `AuthContext` before
they return names, descriptions, schemas or rankings, or change pins. A tool
the caller may not discover looks the same as a missing tool.

## Entry points

| Import | Contents |
| --- | --- |
| `@gonk/tool-orchestrator` | `createOrchestrator`, `bm25Search`, `legacySubstringSearch`, `metaTools`, `explainTool`. |
| `@gonk/tool-orchestrator/types` | Types only. |
| `@gonk/tool-orchestrator/meta-tools` | `metaTools`. |
| `@gonk/tool-orchestrator/explain` | `explainTool`. |

## License

Apache-2.0
