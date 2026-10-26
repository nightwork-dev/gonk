# Gonk Core roadmap

Core has one objective: define an agent capability once and expose it through
multiple hosts. This roadmap covers the shared contracts, host adapters, and
state bindings that serve that objective.

The [package index](packages.md) describes the current public surface. This
roadmap describes planned work. Package versions and changes belong in package
manifests and changelogs.

## Scope

Core owns identity and authorization contracts, context compilation, authorized
retrieval, scoped configuration, managed skills, tool registration, host
projection, and scope-bound state access.

Hosts own authentication, persistence adapters, credentials, and adapter
lifecycle. Capability implementations and applications own their domain
behavior, background execution, and acceptance of results. Generic persistence
and artifact storage belong to Mirk.

## Priorities

### R4 — Bind the installed release

Verify the supported Core entry points through packages installed outside the
workspace. Cover CLI and MCP adapters and the Pi, Claude Code, and Codex host
bindings.

For each supported path:

1. Build and pack from an identified source revision.
2. Record the package version and artifact integrity.
3. Install the artifact in a clean consumer project.
4. Exercise tool discovery, invocation, authorization, and lifecycle behavior.
5. Verify host-owned state access and cleanup where the binding provides it.

Repository tests and builds remain useful checks. A clean consumer install
also verifies package exports, dependencies, and host integration.

### R7 — Remove the Store compatibility architecture

The scope-and-namespace binding over caller-provided Mirk ports is implemented.
The deprecated Store facade is a one-release migration bridge. Plan its removal
in the next breaking release once consumer migration is verified.

#### GS-05 — Complete migration evidence

Before removing the facade:

1. Pack the migration release and install it outside the workspace.
2. Exercise supported host bindings through the installed packages.
3. Check maintained consumers for deprecated Store imports.
4. Verify each remaining consumer's migration through its own integration path.

The production import check prevents new legacy imports inside Core. Consumer
checks establish whether external callers are ready for removal.

#### GS-06 — Delete the legacy surface

After migration verification, remove the compatibility exports, tests, and
documentation in a breaking release. This includes:

- `StoreBackend`, `BackendFactory`, and `FsStoreBackend`;
- `createStore`, `resolveStoreDir`, and backend-selection factories;
- `Backed*Store`, `FoldStore`, tail/vector helpers, and duplicate vector types;
- `MirkStoreBackend` and private adapter access; and
- the legacy filesystem persistence surface.

Retain scope and namespace policy over caller-provided Mirk ports, explicit
migration tools needed by consumers, and the shared host storage lifecycle.
Review native dependencies against those retained host storage exports before
removing them.

If consumers still require the facade, defer removal until their migration is
verified.

### R9 — Reduce delivery fragmentation where it has a measured cost

Use installed-package checks to identify installation failures, version skew,
startup costs, or duplicated host integration work. Consolidate packages where
that makes delivery simpler while preserving clear ownership and focused
imports.

Package count alone is not a reason to merge packages. Evaluate distribution
changes after the installed-package checks in R4 establish the actual costs.
