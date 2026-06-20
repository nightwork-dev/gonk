# Contributing to gonk

```bash
pnpm install --frozen-lockfile   # replays the committed lockfile
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
