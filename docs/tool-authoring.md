# Gonk tool authoring

This is the short path for an application or package author who wants one
capability definition to run through MCP, CLI, and other Gonk adapters.

Use `@gonk/core` when you are building an application and want the common
foundation in one import: auth contracts, scope, and the tool registry. Use the
focused packages (`@gonk/tool-registry`, `@gonk/scope`, `@gonk/auth`) when you
are publishing a smaller library or adapter and want the tightest dependency
surface. Both are on the current `0.3.1` release train; `@gonk/core` is a
convenience barrel, not a second API.

## One schema source

`ToolDefinition.input` accepts any Standard Schema. Zod, Valibot, and ArkType
can be used directly. Gonk does not depend on one of them, so a tool that needs
MCP or form-facing JSON Schema attaches that projection to the same schema
value with `withJsonSchema`.

```ts
import { ToolRegistry, withJsonSchema } from "@gonk/tool-registry";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

const searchNotesShape = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
});
const searchNotesInput = withJsonSchema(
  searchNotesShape,
  zodToJsonSchema(searchNotesShape, "SearchNotesInput")
);

const registry = new ToolRegistry();

registry.register({
  name: "notes.search",
  description: "Search notes visible to the authenticated principal.",
  input: searchNotesInput,
  approval: "read",
  capabilities: { readsFs: true, idempotent: true },
  hints: {
    mcp: {
      annotations: {
        readOnly: true,
        idempotent: true,
      },
    },
  },
  handler: async (input, ctx) => {
    const tenant = ctx.auth?.principal.workspaceId;
    const rows = await searchNotesForTenant(tenant, input.query, input.limit);
    return { data: { rows } };
  },
});
```

If a schema library is overkill, use the zero-dependency `shape(check, message,
jsonSchema?)` helper. It returns a Standard Schema and, when the third argument
is present, attaches the JSON Schema projection that MCP advertises.

```ts
import { shape } from "@gonk/tool-registry";

const renameNoteInput = shape<{ noteId: string; title: string }>(
  (value): value is { noteId: string; title: string } =>
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as { noteId?: unknown }).noteId === "string" &&
    typeof (value as { title?: unknown }).title === "string",
  "expected { noteId: string; title: string }",
  {
    type: "object",
    properties: {
      noteId: { type: "string" },
      title: { type: "string", minLength: 1 },
    },
    required: ["noteId", "title"],
    additionalProperties: false,
  }
);
```

Do not keep a runtime schema and a separate `inputJsonSchema` next to each
other unless you are deliberately overriding an adapter surface. Two sources
drift. One annotated Standard Schema is the preferred public authoring path.

## Reads, writes, and approval

Authorization and approval answer different questions.

- `authorization` and `authorizationResource` describe who may discover or
  invoke the tool and which authoritative application resource must be checked.
- `approval` describes how dangerous the action is: `read`, `write`, or `exec`.

Authenticated write and exec tools fail closed unless the registry has an
approval provider or the host deliberately configures `approvalMode: "bypass"`
for a trusted service. Approval-required is a completed tool result, not a
suspended request.

```ts
const registry = new ToolRegistry({
  security: {
    resourceResolver,
    approvalProvider,
    mandatoryAudit: true,
  },
});

registry.register({
  name: "notes.rename",
  description: "Rename a note.",
  input: renameNoteInput,
  approval: "write",
  capabilities: { writesFs: true },
  authorizationResource: {
    required: true,
    kind: "application:note",
    requiredFields: ["target", "workspaceId"],
  },
  handler: async (input, ctx) => {
    await renameNote(input.noteId, input.title, ctx.auth?.principal);
    return { data: { noteId: input.noteId, title: input.title } };
  },
});
```

## Compose registries by feature

Keep feature tools small and merge them at the application boundary.

```ts
import { ToolRegistry } from "@gonk/tool-registry";

export function createReadTools(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register([searchNotesTool, loadNoteTool]);
  return registry;
}

export function createWriteTools(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register([renameNoteTool, archiveNoteTool]);
  return registry;
}

export function createAppTools(): ToolRegistry {
  return createReadTools().merge(createWriteTools());
}
```

Use `merge` for coarse feature modules, `extract` for an allowlisted host
surface, and `filter` when a deployment needs to project a policy-shaped subset.
The handler definitions stay unchanged.

## Mount MCP inside an application server

If your app already owns HTTP, mount the Web handler instead of starting a
second Gonk listener. TanStack Start, Hono, and similar routers can all pass
Web `Request` objects to `createWebMcpHandler`.

```ts
import type { AuthContext, AuthenticatedPrincipal } from "@gonk/auth";
import { GONK_AUTH_INFO_PRINCIPAL } from "@gonk/tool-registry-mcp";
import { createWebMcpHandler } from "@gonk/tool-registry-mcp/http";
import { createFileRoute } from "@tanstack/react-router";
import { createAppTools } from "./tools";

const mcp = createWebMcpHandler({
  source: createAppTools(),
  serverName: "notes",
  serverVersion: "0.1.0",
  authenticate: async (request) => {
    const session = await verifyAgentBearer(request);
    if (!session) return null;
    const principal: AuthenticatedPrincipal = principalForSession(session);
    return {
      token: session.token,
      clientId: principal.id,
      scopes: [...principal.scopes],
      extra: { [GONK_AUTH_INFO_PRINCIPAL]: principal },
    };
  },
  makeAuthContext: (extra): AuthContext =>
    authContextFor(extra.authInfo?.extra?.[GONK_AUTH_INFO_PRINCIPAL]),
  makeContext: () => ({
    host: { invoker: "agent", surface: "mcp" },
  }),
});

export const Route = createFileRoute("/mcp")({
  server: {
    handlers: {
      GET: ({ request }) => mcp.handle(request),
      POST: ({ request }) => mcp.handle(request),
      DELETE: ({ request }) => mcp.handle(request),
    },
  },
});
```

The route credential should be an agent/audience-bound bearer or equivalent
server-side token. Do not rely on an ambient browser cookie for an agent-only
MCP route.
