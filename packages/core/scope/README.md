# @gonk/scope

Five-tier scope abstraction for the gonk harness. Multi-root, symlink-aware, with blob storage and ambient-document scanning.

## Tiers

```
session > directory > project > persona > global
```

Resolution walks **most → least specific** when the tier isn't specified.

## Roots within a tier

Each tier has a *home directory*. Inside the home, multiple known roots are scanned in **broad → narrow** order; last-found wins:

```
agents/, .agents/  →  .pi/  →  .claude/  →  .codex/  →  .gemini/  →  .cursor/
.windsurf/  →  .opencode/  →  .aider/  →  .gonk/
```

Symlinks are resolved via `realpath` and deduped by canonical path.

## Ambient documents

Auto-scans for `AGENTS.md` (case-insensitive), `CLAUDE.md`, `GEMINI.md`, `SOUL.md`, `PERSONA.md`, `AGENT.md`, `.cursorrules` at every scope home and within bound roots. `SOUL.md` / `PERSONA.md` / `AGENT.md` are **persona-bearing**; the rest are **context-bearing**.

## Entry points

```ts
// Full bundle
import { FsScopeStore, MemoryScopeStore } from "@gonk/scope";

// Types only — zero runtime cost
import type { ScopeStore, ScopeName } from "@gonk/scope/types";

// Just the in-memory store (testing) — no node:fs / yaml deps
import { MemoryScopeStore } from "@gonk/scope/memory";

// Filesystem store + YAML root adapter
import { FsScopeStore, YamlRootAdapter } from "@gonk/scope/fs";

// Just the discovery helpers
import { findProjectRoot, scanDocuments, bindRoots } from "@gonk/scope/resolver";
```

## Quick example

```ts
import { FsScopeStore } from "@gonk/scope/fs";

const scope = new FsScopeStore({ cwd: process.cwd() });

// Read with chain walk (returns most-specific match)
const provider = scope.get("tts.provider");

// Inspect the full chain
const all = scope.resolve("tts.provider");
// → [{ scope: "session", root: "...", value: "..." }, ...]

// Set explicitly
scope.set("tts.provider", "mlx-cloning", "persona", { kind: ".claude" });

// Documents
const docs = scope.documents();   // ambient AGENTS.md, CLAUDE.md, etc.
```
