# core

The gonk foundation — a typed tool registry, a five-tier scope system, and host adapters (CLI / MCP / Pi). Extracted from [gonk](https://github.com/nightwork-dev/gonk) for public release.

## Packages

| Package | What it is |
| --- | --- |
| `@gonk/scope` | Five-tier scoped key/value resolution (`session > directory > project > persona > global`). |
| `@gonk/tool-registry` | Typed tool definitions + registry, Standard Schema I/O, metrics sinks. |
| `@gonk/tool-orchestrator` | Semantic tool selection / ranking over a registry. |
| `@gonk/core` | A barrel over `@gonk/scope` + `@gonk/tool-registry` — one import for the common surface. |
| `@gonk/tool-registry-cli` | Expose a registry/orchestrator over a CLI. |
| `@gonk/tool-registry-mcp` | Expose a registry/orchestrator over the Model Context Protocol (stdio + `./http`). |
| `@gonk/tool-registry-pi` | Adapt registry tools to `@earendil-works/pi-agent-core` AgentTools. |

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
