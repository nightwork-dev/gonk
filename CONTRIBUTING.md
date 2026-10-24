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
  early review. None are active now; the MCP 2.0.0 exemption ended when MCP
  moved to 2.3.0 under the normal seven-day quarantine.

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

## Python

The Python workspace requires uv `>=0.13.5` so the managed CPython 3.12.15
runtime is selected. The repository pins that runtime in `python/.python-version`
and CI sets `UV_MANAGED_PYTHON=true`; use the same managed interpreter locally.

Set up the Python workspace from the repository root:

```bash
pnpm install --frozen-lockfile
uv sync --project python --locked --all-packages --all-extras --group dev
pnpm build
```

Run the Python package checks:

```bash
pnpm check:python
pnpm check:python-wheels
```

`check:python` runs tests, strict type checks, and lint for each Python
distribution. `check:python-wheels` builds all three distributions, installs
the wheels in a temporary environment, and invokes a Python MCP tool through
the TypeScript importer.

### Python conformance

The TypeScript auth and registry suites generate the checked-in cases under
`conformance/`. Regenerate them after a deliberate shared-contract change:

```bash
node --experimental-transform-types scripts/python-auth-conformance.ts --write
node --experimental-transform-types scripts/python-registry-conformance.ts
```

Review the generated differences before you accept them. The scripts derive
the expected values from the TypeScript implementations. Add shared acceptance
and rejection cases for regex dialects or custom validation when they affect
both languages.

### Python and Mirk integration proof

The optional [artifact example](python/examples/artifact_documents.py) uses
host-owned Mirk storage. Build the TypeScript packages that the proof imports.
Install the Mirk store and artifact wheels in the same environment as the Gonk
wheels. The Mirk checkout must contain built TypeScript store and artifact
packages.

Run the proof with the Python executable and Mirk checkout paths:

```bash
node scripts/python-artifact-smoke.mjs /path/to/venv/bin/python /path/to/mirk
```

The proof creates a document through MCP, restarts the Python server, reopens
the document, and verifies the persisted artifact through TypeScript Mirk.
