# Changelog

All notable changes to the `@gonk/*` core packages. Versions are kept in lockstep across the workspace; this file records what changed at each bump. Format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.0.11] — 2026-06-19

### Added
- `@gonk/store`: `KvStore.entries(prefix?)` — returns `{ key, value }` pairs from a single backend read, so `list` + `entries` no longer pay a `get` per key. Backend SPI gains `kvEntries()` (replaces `kvList`).

## [0.0.10] — 2026-06-19

### Added
- `@gonk/store` — backing-agnostic persistence primitives (KV / blob / append-log / vector-KNN), each obtained from `createStore(scope).{kv,blob,log,vector}(tier, namespace)`. A `StoreBackend` SPI with a pure-`fs` default (`FsStoreBackend`: atomic temp+rename writes, JSONL logs, JS-cosine vectors) — **zero native dependencies in core**, swappable for sqlite/remote without touching a caller. Locations resolve through scope's substrate dir, so all five tiers work identically and the capability never assembles a path. See [`docs/store-abstraction-design.md`](docs/store-abstraction-design.md).
- `@gonk/scope`: `store` added to the substrate kinds, so a tier's store dir resolves alongside `memory` / `knowledge` / `sessions` under the same `.agents`-preferring policy.

## [0.0.9] — 2026-06-19

Initial public extraction of the gonk foundation from the development monorepo.

### Added
- The three primitives as standalone packages: `@gonk/scope` (five-tier resolution), `@gonk/tool-registry` (typed tool definitions, Standard Schema I/O), `@gonk/tool-orchestrator` (semantic selection), plus `@gonk/core` (a barrel over scope + registry).
- Host adapters: `@gonk/tool-registry-{cli,mcp,pi}` — expose the same registry to a CLI, an MCP server (stdio + streamable-HTTP), or a Pi agent.
- The extension-authoring SDK promoted **into** core: `@gonk/extension-spec` (+ `-cli` / `-pi` / `-claude`) — declare an extension once as host-agnostic data, materialize it per host.
- nx for dep-ordered, cached task orchestration; a 7-day supply-chain cooldown (`minimumReleaseAge`) on the committed lockfile.
