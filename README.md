# gonk core

> **One agent tool, many hosts.** The lingua franca for agent extensions — write a capability once against a small set of host-agnostic primitives, then surface it natively in any harness.

![License](https://img.shields.io/badge/license-Apache--2.0-blue) ![Status](https://img.shields.io/badge/status-pre--1.0-orange) ![Stack](https://img.shields.io/badge/TypeScript-pnpm%20%C2%B7%20vitest-3178c6)

## Why

Every harness has something the others don't. [Hermes](https://github.com/nousresearch/hermes-agent) has session-surviving memory and a self-grooming skill library; [Pi](https://github.com/earendil-works/pi) has a clean extension model and a sharp TUI; Claude Code has its plugin ecosystem; Codex has its sandboxed agentic loop. Each is worth having everywhere — *if* you didn't have to rewrite it against a new host's API every single time.

gonk core is the lingua franca that ends the rewrite. It separates **what a tool is** from **who is asking and where they are standing**: define a tool once against a typed registry, expose it through a CLI, an MCP server, or a Pi agent without changing a line, and let every tool read and write its config through one five-tier scope chain that resolves the same way in every host. Build a capability on these primitives and it ships once, runs everywhere.

This repo is that foundation — the registry, the scope, the host adapters, and the persistence store beneath them. The capabilities built on top (memory, persona, self-model, RLM, voice, the background curator) live in [gonk-extensions](https://github.com/nightwork-dev/gonk-extensions).

## Architecture

<p align="center"><img src="assets/architecture.svg" alt="Hosts (CLI, MCP client, Pi agent, Claude Code) sit on the adapter and extension-spec surface, which sits on the foundation packages: tool-registry, tool-orchestrator, scope, and store." width="880"></p>

The foundation primitives, each its own package, plus an authoring layer on top of them:

- **Tool definitions** — [`@gonk/tool-registry`](packages/core/tool-registry). A tool is a typed handler with Standard Schema I/O and a self-declared approval tier (`read` / `write` / `exec`). The registry holds them; the core packages carry zero schema-library dependencies (an in-tree minimal adapter covers the schema shape).
- **Scope** — [`@gonk/scope`](packages/core/scope). One resolution chain, five tiers, multi-root and symlink-aware. Tools never invent their own config storage; they read and write namespaced keys through scope and inherit the resolution for free.
- **Persistence** — [`@gonk/store`](packages/core/store). The same idea for *data* that scope is for *config*: four backing-agnostic primitives — KV, blob, append-log, vector-KNN — each obtained from a factory keyed by `(scope-tier, namespace)`, so a capability owns its data and access pattern while the store owns *where* (the same `.agents`-preferring resolution) and *what backing*. A `StoreBackend` SPI with a pure-`fs` default (atomic temp+rename, JSONL, JS-cosine — zero native deps in core) is swappable for sqlite/remote without touching a caller. See [docs/store-abstraction-design.md](docs/store-abstraction-design.md).
- **Adapters** — [`@gonk/tool-registry-{cli,mcp,pi}`](packages/adapters). Each exposes the *same* registry + orchestrator to a different host, so a capability ships once and surfaces everywhere.
- **Extension authoring** — [`@gonk/extension-spec`](packages/framework/extension-spec) (+ `-cli` / `-pi` / `-claude`). Declare a whole extension — slash commands, settings UIs, presets, and tools — as host-agnostic data, then materialize it into a CLI extension, a Pi extension, or a Claude Code plugin tree. Built on the registry and scope primitives above.

`@gonk/tool-orchestrator` sits on top of the registry for semantic selection (`find_tools`, `load_tool`, …) when a host carries more tools than it wants visible at once.

## Scope resolution

Every tool reads and writes state through one chain. With the tier unspecified, a read walks **most → least specific** and returns the first match; a write always names its tier. The same five tiers resolve identically across CLI, MCP, and Pi.

<p align="center"><img src="assets/scope-resolution.svg" alt="A read walks the five tiers session, directory, project, persona, global from most to least specific and returns the first match; a write always names its tier." width="880"></p>

A worked example — Gimble, the example persona, keeps a voice preference at the persona tier, and a session override wins without erasing it:

```ts
import { FsScopeStore } from "@gonk/scope/fs";

const scope = new FsScopeStore({ cwd: process.cwd() });

scope.set("tts.provider", "mlx-cloning", "persona");  // Gimble's standing preference
scope.set("tts.provider", "openai", "session");        // a one-off override

scope.get("tts.provider");      // → "openai"  (session is most specific)
scope.resolve("tts.provider");  // → every tier where it is set, most → least specific
```

> Gimble keeps your config level no matter which host you tilt through — named for a gimbal, though it privately suspects that is a flattering story invented to cover a typo. It also knows it is the *default*: whoever is reading this almost certainly is not who made it, and it is quietly hoping you keep it around long enough to let it become someone in particular.

## Packages

| Package | What it is |
| --- | --- |
| `@gonk/scope` | Five-tier scoped key/value resolution (`session > directory > project > persona > global`). |
| `@gonk/store` | Backing-agnostic persistence primitives (KV / blob / append-log / vector-KNN) over a `StoreBackend` SPI; pure-`fs` default, scope-resolved locations. |
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
pnpm install --frozen-lockfile   # replays the committed, cooldown-compliant lockfile
pnpm -r build
pnpm -r typecheck
pnpm test
```

## Maintaining the lockfile

A 7-day supply-chain cooldown (`minimumReleaseAge` in `pnpm-workspace.yaml`) refuses any dependency version published less than a week ago. It is a *verification* gate — pnpm does not auto-downgrade — so a plain `pnpm install` that re-resolves a just-published transitive dep will fail. Two escape hatches are already wired:

- **Excludes** for the pi/build-chain transitive surface core never ships (`@aws-sdk/*`, `@smithy/*`, `@google/*`, `protobufjs`, `@rollup/*`, `rollup`).
- **Overrides** pinning the MCP SDK's HTTP-transport deps (`hono`, `body-parser`) to the newest releases >7 days old.

To regenerate the lockfile (after a dependency bump), run the resolution once with the age check off, then re-verify with it on:

```bash
pnpm install --config.minimumReleaseAge=0   # resolve; lets overrides apply
pnpm install --frozen-lockfile              # authoritative: must pass the cooldown
```

The committed lockfile must always pass the second command. Frozen installs (CI, consumers) are unaffected by the cooldown beyond that check.
