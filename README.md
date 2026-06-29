# gonk

> **Write an agent capability once. Run it in every host.** The lingua franca that ends the rewrite — define a tool against a small set of host-agnostic primitives, and surface it natively through the CLI, an MCP server, a Pi agent, or Claude Code.

![License](https://img.shields.io/badge/license-Apache--2.0-blue) ![Status](https://img.shields.io/badge/status-pre--1.0-orange) ![Stack](https://img.shields.io/badge/TypeScript-pnpm%20%C2%B7%20vitest-3178c6)

## Why

If you build agent tools, you write them against whatever host you're in — a Claude Code plugin, a Pi extension, an MCP server — and then rewrite them when you move. gonk ends that. Define a tool once against a typed registry; expose it through a CLI, an MCP server, or a Pi agent **without changing a line**; and let it read and write config through one scope chain that resolves the same way everywhere. Build a capability on these primitives and it ships once, runs everywhere.

Every harness has grown strengths the others lack — [Hermes](https://github.com/nousresearch/hermes-agent)'s session-surviving memory, [Pi](https://github.com/earendil-works/pi)'s clean extension model, Claude Code's plugins, Codex's sandboxed loop — and reusing any of them today means porting it by hand to the next host. gonk is the lingua franca that makes a capability portable instead.

This repo is the foundation — the registry, the scope, the host adapters, and the persistence store beneath them. The capabilities built on top (memory, persona, self-model, RLM, voice, the background curator) live in [gonk-extensions](https://github.com/nightwork-dev/gonk-extensions).

## Architecture

<p align="center"><img src="assets/architecture.svg" alt="Hosts (CLI, MCP client, Pi agent, Claude Code) sit on the adapter and extension-spec surface, which sits on the foundation packages: tool-registry, tool-orchestrator, scope, and store." width="880"></p>

The foundation primitives, each its own package, plus an authoring layer on top of them:

- **Tool definitions** — [`@gonk/tool-registry`](packages/core/tool-registry). A tool is a typed handler with Standard Schema I/O and a self-declared approval tier (`read` / `write` / `exec`). Define it once; every adapter below can surface it.
- **Scope** — [`@gonk/scope`](packages/core/scope). One resolution chain, five tiers, multi-root and symlink-aware. Tools never invent their own config storage; they read and write namespaced keys through scope and inherit the resolution for free.
- **Persistence** — [`@gonk/store`](packages/core/store). The same idea for *data* that scope is for *config*: KV, blob, append-log, and vector-KNN primitives a capability reads and writes without knowing — or caring — whether the backing is the filesystem, a database, or a vector index. Pure-`fs` by default, swappable underneath without touching a caller. See [docs/store-abstraction-design.md](docs/store-abstraction-design.md).
- **Connectivity address & identity** — [`@gonk/channel`](packages/core/channel). The transport-agnostic message contract underneath cross-agent comms and the remote front doors: an address-on-the-message envelope (`persona@host#scope`), a channel registry, and a loopback reference impl.
- **Time & activity** — [`@gonk/temporal`](packages/core/temporal). The temporal-awareness surface (wall-clock, session elapsed, turn index, idle) plus the periodic-run scheduler and persistent-presence wake/defer policy that every "should this fire now?" decision reads.
- **Adapters** — [`@gonk/tool-registry-{cli,mcp,pi}`](packages/adapters). Each exposes the *same* registry + orchestrator to a different host, so a capability ships once and surfaces everywhere.
- **Extension authoring** — [`@gonk/extension-spec`](packages/framework/extension-spec) (+ `-cli` / `-pi` / `-claude`). Declare a whole extension — slash commands, settings UIs, presets, and tools — as host-agnostic data, then materialize it into a CLI extension, a Pi extension, or a Claude Code plugin tree. Built on the registry and scope primitives above.

`@gonk/tool-orchestrator` sits on top of the registry for semantic selection (`find_tools`, `load_tool`, …) when a host carries more tools than it wants visible at once.

## Scope resolution

Every tool you write inherits config resolution for free — no config-file plumbing, no per-host storage code. A read with no tier named walks **most → least specific** and returns the first match; a write always names its tier. The same five tiers resolve identically across CLI, MCP, and Pi.

<p align="center"><img src="assets/scope-resolution.svg" alt="A read walks the five tiers session, directory, project, persona, global from most to least specific and returns the first match; a write always names its tier." width="880"></p>

A worked example — Gimble, the example persona, keeps a voice preference at the persona tier, and a session override wins without erasing it:

```ts
import { FsScopeStore } from "@gonk/scope/fs";

const scope = new FsScopeStore({ cwd: process.cwd() });

scope.set("tts.provider", "mlx-cloning", "persona");  // a standing preference
scope.set("tts.provider", "openai", "session");        // a one-off override

scope.get("tts.provider");      // → "openai"  (session is most specific)
scope.resolve("tts.provider");  // → every tier where it is set, most → least specific
```

> The `persona`-tier value travels with the agent across hosts; the `session` override stays temporary and local.

## Package reference

New here? The two you'll touch first are **`@gonk/tool-registry`** (define a tool) and **`@gonk/scope`** (read and write its config). The rest layer on as you need them.

| Package | What it is |
| --- | --- |
| `@gonk/utils` | Zero-dependency fs-safety primitives (`safeJoin`, atomic writes), code-split per concern (`@gonk/utils/fs`) so unbundled consumers load only what they import. |
| `@gonk/scope` | Five-tier scoped key/value resolution (`session > directory > project > persona > global`). |
| `@gonk/store` | Backing-agnostic persistence primitives (KV / blob / append-log / vector-KNN) over a `StoreBackend` SPI; pure-`fs` default, scope-resolved locations. |
| `@gonk/channel` | Transport-agnostic connectivity primitives — the message/address contract (`persona@host#scope`), channel registry, loopback reference impl. |
| `@gonk/temporal` | Temporal-awareness surface (wall-clock, session elapsed, turn index, idle) + periodic-run scheduler and persistent-presence wake/defer policy. |
| `@gonk/tool-registry` | Typed tool definitions + registry, Standard Schema I/O, metrics sinks. |
| `@gonk/tool-orchestrator` | Semantic tool selection / ranking over a registry. |
| `@gonk/core` | A barrel over `@gonk/scope` + `@gonk/tool-registry` — one import for the common surface. |
| `@gonk/tool-registry-cli` | Expose a registry/orchestrator over a CLI. |
| `@gonk/tool-registry-mcp` | Expose a registry/orchestrator over the Model Context Protocol (stdio + `./http`). |
| `@gonk/tool-registry-pi` | Adapt registry tools to `@earendil-works/pi-agent-core` AgentTools. |
| `@gonk/extension-spec` | Declarative, host-agnostic extension spec — slash commands, settings, presets, and tools as data. |
| `@gonk/extension-spec-cli` | Materialize an ExtensionSpec into a CLI extension (subcommands, settings prompts, presets). |
| `@gonk/extension-spec-pi` | Materialize an ExtensionSpec into a Pi extension (tools, slash command, settings TUI). |
| `@gonk/extension-spec-claude` | Materialize an ExtensionSpec into a Claude Code plugin tree (plugin.json, commands, hooks). |

## Develop

```bash
pnpm install --frozen-lockfile   # replays the committed lockfile
pnpm -r build && pnpm -r typecheck && pnpm test
```

The committed lockfile enforces a 7-day supply-chain cooldown. See [CONTRIBUTING.md](CONTRIBUTING.md) to regenerate it after a dependency bump.
