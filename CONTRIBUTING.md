# Contributing to gonk

```bash
pnpm install --frozen-lockfile   # replays the committed lockfile
pnpm -r build
pnpm -r typecheck
pnpm test
```

## Maintaining the lockfile

A 7-day supply-chain cooldown (`minimumReleaseAge` in `pnpm-workspace.yaml`) refuses any dependency version published less than a week ago. It is a *verification* gate — pnpm does not auto-downgrade — so a plain `pnpm install` that re-resolves a just-published transitive dep will fail. The existing escape hatches are deliberately narrow:

- **Excludes** for the pi/build-chain transitive surface core never ships (`@aws-sdk/*`, `@smithy/*`, `@google/*`, `protobufjs`, `@rollup/*`, `rollup`).
- **Exact-version excludes** for dependency trains that received an explicit
  early review. The MCP v2 migration uses this only for
  `@modelcontextprotocol/{client,core,server}@2.0.0`; later MCP versions return
  to the normal seven-day quarantine.

To regenerate the lockfile after an ordinary dependency bump, wait for the
cooldown and run:

```bash
pnpm install
pnpm install --frozen-lockfile
```

Do not disable `minimumReleaseAge` as a routine workflow. A new exact-version
exclude requires an explicit review decision recorded beside the selector.
The committed lockfile must always pass the frozen install. Frozen installs
(CI, consumers) replay the reviewed lockfile.
