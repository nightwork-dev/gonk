# @gonk/tool-orchestrator

Composes one or more `ToolRegistry` instances into a single catalog with discovery, ranking, and pin lifecycle. Auto-registers meta-tools the model can use to find and load on-demand tools.

## What it does

- **Composes registries** — multiple sources unioned into one dispatch surface.
- **Search & recommend** — keyword/tag-based ranker by default, fully pluggable.
- **Per-adapter visibility** — reads `hints.{mcp,pi}.visibility` to override `def.visibility` per scope.
- **Pin lifecycle** — `pin()` and `unpin()` queue; `commitPins()` flushes at adapter-chosen boundaries (turn boundary / compaction). Append-only with tombstones for prompt-cache stability.
- **Meta-tools** auto-registered (visibility: `always`):
  - `list_tools` — list all known tools, filterable by category/tag/visibility
  - `find_tools` — keyword search across name, description, tags, keywords
  - `get_tool` — full schema + metadata for a specific tool
  - `load_tool` — pin a tool for the rest of the session
  - `unload_tool` — unpin

## Search & ranking

`find_tools` uses BM25 with weighted fields: name (3×), category (2×), description/tags/keywords (1×). Constants: k1=1.2, b=0.75. The default ranker (`bm25Search`) is exported and pluggable — pass a custom `search` function to `createOrchestrator` to replace it. `legacySubstringSearch` is exported as a fallback for callers that need simple substring matching.

## Active set semantics

```
activeSet() = { always tools, sorted by name } ∪ { committed pins, in pin order }
```

Deterministic, byte-stable between commits — meant to be safe to put in the prompt prefix without busting cache.

## Entry points

```ts
import { createOrchestrator } from "@gonk/tool-orchestrator";
import type { Orchestrator } from "@gonk/tool-orchestrator/types";
import { metaTools } from "@gonk/tool-orchestrator/meta-tools";
```

## Example

```ts
import { ToolRegistry } from "@gonk/tool-registry";
import { createOrchestrator } from "@gonk/tool-orchestrator";

const r = new ToolRegistry();
r.register([/* ...your tools... */]);

const orch = createOrchestrator({
  registries: [r],
  scope: "pi",                // resolves per-adapter visibility hints
  pinStore: { load, save },   // optional persistence — Pi: session-scoped; MCP: ephemeral
});

orch.search("audio");                 // → ranked tools
orch.activeSet();                     // → tools to expose to the model right now
orch.pin("watch-todos");
await orch.commitPins();              // narrow→broad active-set rebuild
```
