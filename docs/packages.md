# Gonk Core package index

This index is a living map of the Core publishable surface. Core currently has
20 publishable packages. Package presence is not publication, installation, or
runtime proof; release evidence is tracked separately.

| Package | Path | Role |
| --- | --- | --- |
| `@gonk/auth` | `packages/core/auth` | identity, delegation, authorization |
| `@gonk/channel` | `packages/core/channel` | transport-neutral address/envelope |
| `@gonk/context` | `packages/core/context` | authorized context compilation |
| `@gonk/core` | `packages/core/core` | convenience common-surface barrel |
| `@gonk/retrieval` | `packages/core/retrieval` | authorized deterministic retrieval |
| `@gonk/scope` | `packages/core/scope` | five-tier scoped configuration |
| `@gonk/skills` | `packages/core/skills` | managed skill lifecycle and policy |
| `@gonk/store` | `packages/core/store` | scope-bound state over Mirk ports; host storage leases; migration bridge |
| `@gonk/temporal` | `packages/core/temporal` | time, activity, and scheduling policy |
| `@gonk/tool-orchestrator` | `packages/core/tool-orchestrator` | semantic registry selection |
| `@gonk/tool-registry` | `packages/core/tool-registry` | capability schema, invocation, result, lifecycle |
| `@gonk/tool-registry-cli` | `packages/adapters/tool-registry-cli` | CLI projection |
| `@gonk/tool-registry-mcp` | `packages/adapters/tool-registry-mcp` | MCP/HTTP projection |
| `@gonk/tool-registry-pi` | `packages/adapters/tool-registry-pi` | Pi projection |
| `@gonk/utils` | `packages/core/utils` | code-split filesystem safety helpers |
| `@gonk/extension-spec` | `packages/framework/extension-spec` | host-neutral extension declaration |
| `@gonk/extension-spec-cli` | `packages/framework/extension-spec-cli` | CLI materializer |
| `@gonk/extension-spec-claude` | `packages/framework/extension-spec-claude` | Claude Code materializer |
| `@gonk/extension-spec-codex` | `packages/framework/extension-spec-codex` | Codex materializer and host storage binding |
| `@gonk/extension-spec-pi` | `packages/framework/extension-spec-pi` | Pi materializer and host storage binding (`./storage`; see [Pi storage](pi-storage.md)) |

This index describes package ownership only. It does not adopt the proposed
roadmap or imply publication, installation, or runtime proof.
