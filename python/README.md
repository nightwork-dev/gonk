# Python Gonk

The Python workspace provides native auth, tool registration, and a stdio MCP
adapter through the Gonk contract. It contains three distributions:

| Distribution | Import | Surface |
| --- | --- | --- |
| [gonk-auth](auth/README.md) | `gonk.auth` | principal validation, envelopes, snapshots, and identity keys |
| [gonk-tool-registry](tool-registry/README.md) | `gonk.tool_registry` | registered handlers, validation, auth, approval, events, and cancellation |
| [gonk-tool-registry-mcp](mcp/README.md) | `gonk.mcp` | stdio MCP server through the official SDK |

Python 3.12 or newer is required.
These packages share the PEP 420 `gonk` namespace.
Auth and registry code do not require Mirk or a running service.
The MCP package supplies protocol transport, while the host supplies the
principal and authorization policy.

## Boundaries

The host provides an `AuthContext` with an authenticated principal and an authorization callback.
Each root invocation captures a fresh immutable principal snapshot.
Nested invocations reuse that snapshot and apply the same authorization path.
Envelope decoding reconstructs data and does not authenticate a caller.

The callback receives a mapping with `action`, `resource`, optional
`relatedResources`, `input`, and `callStack`. Root calls use `tool.discover`;
invocations use `tool.invoke`. Resource mappings use `kind` and can include
`target`, `scope`, `tenantId`, `workspaceId`, and `metadata`. Return a mapping
with `outcome` set to `allow` or `deny` and a string `reason`. An awaitable
return is also valid.

Tool handlers can return values, await results, or yield events through asynchronous generators.
Cancellation interrupts awaitable or async-generator work and closes an active
generator. A synchronous handler runs inline and is not interruptible.
Cancellation does not reverse external effects that the handler already completed.

A tool's JSON Schema declaration describes its portable input.
Its injected validator controls native validation.
Use `json_schema_validator` when both surfaces must use the same JSON Schema rules.
Generated conformance cases cover their declared schemas, not every validator or
schema dialect.

Context compilation, retrieval, skills, scope resolution, and TypeScript host
adapters are not included in this Python slice. See the [registry README](tool-registry/README.md)
for its unsupported TypeScript dispatch features.

Gonk does not own generic persistence or artifact bytes. A host can provide
those capabilities through Mirk.
