import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import type { AuthContext, AuthenticatedPrincipal } from "@gonk/auth";
import { ToolRegistry, shape, type ToolDefinition } from "@gonk/tool-registry";
import { createOrchestrator } from "@gonk/tool-orchestrator";

import {
  createMcpServer,
  type McpAdapterOptions,
} from "../src/index.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

async function pair(
  adapter: ReturnType<typeof createMcpServer>
): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client(
    { name: "test-client", version: "0" },
    { capabilities: {} }
  );
  await Promise.all([client.connect(clientT), adapter.connect(serverT)]);
  return client;
}

function authenticatedPrincipal(): AuthenticatedPrincipal {
  return {
    id: "principal:user-1",
    kind: "human",
    identity: {
      issuer: "https://accounts.example",
      subject: "user-1",
      method: "oauth",
    },
    workspaceId: "workspace-1",
    roles: ["member"],
    scopes: [],
  };
}

function auth(authorize: AuthContext["authorize"]): AuthContext {
  return {
    principal: authenticatedPrincipal(),
    authorize,
  };
}

describe("createMcpServer", () => {
  it("advertises registered tools via listTools", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "echo",
      description: "echo input",
      input: passthrough(),
      inputJsonSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
      handler: async (input: { text: string }) => ({
        data: { echoed: input.text },
      }),
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);

    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.name).toBe("echo");
    expect(result.tools[0]?.inputSchema.type).toBe("object");
  });

  it("advertises JSON Schema attached to the Standard Schema input", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "notes.search",
      description: "search notes",
      input: shape<{ query: string }>(
        (value): value is { query: string } =>
          Boolean(value) &&
          typeof value === "object" &&
          typeof (value as { query?: unknown }).query === "string",
        "expected { query: string }",
        {
          type: "object",
          properties: { query: { type: "string", minLength: 1 } },
          required: ["query"],
          additionalProperties: false,
        }
      ),
      handler: async (input) => ({ data: { query: input.query } }),
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);

    const result = await client.listTools();
    expect(result.tools[0]?.inputSchema).toEqual({
      type: "object",
      properties: { query: { type: "string", minLength: 1 } },
      required: ["query"],
      additionalProperties: false,
    });
  });

  it("dispatches callTool through the registry", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "echo",
      description: "echo",
      input: passthrough(),
      handler: async (input: { text: string }) => ({
        data: { echoed: input.text },
        display: `echoed: ${input.text}`,
      }),
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);

    const result = await client.callTool({
      name: "echo",
      arguments: { text: "hi" },
    });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "echoed: hi" }]);
    expect(result.structuredContent).toEqual({ echoed: "hi" });
  });

  it("returns isError for unknown tool", async () => {
    const r = new ToolRegistry();
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);
    const result = await client.callTool({ name: "ghost", arguments: {} });
    expect(result.isError).toBe(true);
  });

  it("converts tool errors into isError content", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "boom",
      description: "boom",
      input: passthrough(),
      handler: async () => {
        throw new Error("kaboom");
      },
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("kaboom");
  });

  it("respects activeSet when given an Orchestrator (only always tools advertised)", async () => {
    const r = new ToolRegistry();
    r.register([
      {
        name: "a",
        description: "a",
        visibility: "always",
        input: passthrough(),
        handler: async () => ({ data: 1 }),
      },
      {
        name: "b",
        description: "b",
        visibility: "on-demand",
        input: passthrough(),
        handler: async () => ({ data: 2 }),
      },
    ] as ToolDefinition[]);
    const orch = createOrchestrator({
      registries: [r],
      scope: "mcp",
      registerMetaTools: false,
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: orch,
    });
    const client = await pair(adapter);

    const before = await client.listTools();
    expect(before.tools.map((t) => t.name)).toEqual(["a"]);

    orch.pin("b");
    await orch.commitPins();
    const after = await client.listTools();
    expect(after.tools.map((t) => t.name).sort()).toEqual(["a", "b"]);
  });

  it("require-allowlist hides write tools not in allowlist", async () => {
    const r = new ToolRegistry();
    r.register([
      {
        name: "writer-a",
        description: "a",
        input: passthrough(),
        capabilities: { writesFs: true },
        handler: async () => ({ data: 1 }),
      },
      {
        name: "writer-b",
        description: "b",
        input: passthrough(),
        capabilities: { writesFs: true },
        handler: async () => ({ data: 2 }),
      },
      {
        name: "reader",
        description: "r",
        input: passthrough(),
        handler: async () => ({ data: 3 }),
      },
    ] as ToolDefinition[]);
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
      writeToolPolicy: "require-allowlist",
      allowlist: ["writer-a"],
    });
    const client = await pair(adapter);

    const list = await client.listTools();
    expect(list.tools.map((t) => t.name).sort()).toEqual([
      "reader",
      "writer-a",
    ]);

    const blocked = await client.callTool({ name: "writer-b", arguments: {} });
    expect(blocked.isError).toBe(true);
  });

  it("renders rich display blocks as MCP content", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "rich",
      description: "rich",
      input: passthrough(),
      handler: async () => ({
        data: { ok: true },
        display: [
          { type: "markdown" as const, markdown: "# title" },
          { type: "code" as const, language: "ts", code: "x" },
          { type: "image" as const, mimeType: "image/png", data: "AAA" },
        ],
      }),
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);
    const result = await client.callTool({ name: "rich", arguments: {} });
    const content = result.content as Array<{
      type: string;
      text?: string;
      data?: string;
      mimeType?: string;
    }>;
    expect(content[0]).toMatchObject({ type: "text", text: "# title" });
    expect(content[1]).toMatchObject({ type: "text" });
    expect(content[1]?.text).toContain("```ts");
    expect(content[2]).toMatchObject({
      type: "image",
      mimeType: "image/png",
      data: "AAA",
    });
  });

  it("filters duplex tools from listTools and rejects calls", async () => {
    const r = new ToolRegistry();
    r.register([
      {
        name: "echo",
        description: "echo",
        input: passthrough(),
        handler: async () => ({ data: 1 }),
      },
      {
        name: "voice",
        description: "duplex voice",
        input: passthrough(),
        capabilities: { duplex: true },
        handler: async () => ({ data: 2 }),
      },
    ] as ToolDefinition[]);
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);
    const list = await client.listTools();
    expect(list.tools.map((t) => t.name)).toEqual(["echo"]);
    const blocked = await client.callTool({ name: "voice", arguments: {} });
    expect(blocked.isError).toBe(true);
  });

  it("maps annotation hints to MCP *Hint fields", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "annotated",
      description: "annotated",
      input: passthrough(),
      hints: {
        mcp: {
          annotations: { readOnly: true, destructive: false, idempotent: true },
        },
      },
      handler: async () => ({ data: 1 }),
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);
    const list = await client.listTools();
    expect(list.tools[0]?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  });

  it("injects options.scope into ctx.scope for tool handlers", async () => {
    const seen: { scope?: unknown; read?: unknown } = {};
    const r = new ToolRegistry();
    r.register({
      name: "needs_scope",
      description: "reads ctx.scope",
      input: passthrough(),
      handler: async (_input: unknown, ctx) => {
        seen.scope = ctx.scope;
        seen.read = ctx.scope?.get("probe.key", "persona");
        return { data: { ok: true } };
      },
    });
    const fakeScope = {
      get: (key: string) => (key === "probe.key" ? "SENTINEL" : undefined),
    } as unknown as NonNullable<Parameters<typeof createMcpServer>[0]["scope"]>;
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
      scope: fakeScope,
    });
    const client = await pair(adapter);
    const result = await client.callTool({
      name: "needs_scope",
      arguments: {},
    });
    expect(result.isError ?? false).toBe(false);
    expect(seen.scope).toBe(fakeScope);
    expect(seen.read).toBe("SENTINEL");
  });

  it("injects trusted request context into ctx.host", async () => {
    let host: unknown;
    const r = new ToolRegistry();
    r.register({
      name: "whoami",
      description: "returns the authenticated host context",
      input: passthrough(),
      handler: async (_input: unknown, ctx) => {
        host = ctx.host;
        return { data: ctx.host };
      },
    });
    const principal = { invoker: "agent", profileId: "sol" };
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
      makeContext: () => ({ host: principal }),
    });
    const client = await pair(adapter);
    await client.callTool({ name: "whoami", arguments: {} });
    expect(host).toEqual(principal);
  });

  it("leaves ctx.scope undefined when no scope option is given", async () => {
    const seen: { had: boolean } = { had: true };
    const r = new ToolRegistry();
    r.register({
      name: "probe_scope",
      description: "probes ctx.scope presence",
      input: passthrough(),
      handler: async (_input: unknown, ctx) => {
        seen.had = ctx.scope !== undefined;
        return { data: {} };
      },
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
    });
    const client = await pair(adapter);
    await client.callTool({ name: "probe_scope", arguments: {} });
    expect(seen.had).toBe(false);
  });

  it("filters discovery per principal and makes hidden calls indistinguishable from missing tools", async () => {
    const r = new ToolRegistry();
    r.register([
      {
        name: "visible",
        description: "visible",
        input: passthrough(),
        handler: async () => ({ data: { visible: true } }),
      },
      {
        name: "hidden",
        description: "hidden",
        input: passthrough(),
        handler: async () => ({ data: { leaked: true } }),
      },
    ] as ToolDefinition[]);
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
      makeAuthContext: () =>
        auth((request) => ({
          outcome: request.resource.target === "hidden" ? "deny" : "allow",
          reason: request.resource.target === "hidden" ? "hidden" : "allowed",
        })),
    });
    const client = await pair(adapter);
    const emptyClient = await pair(
      createMcpServer({
        serverName: "test-empty",
        serverVersion: "0",
        source: new ToolRegistry(),
      })
    );

    const list = await client.listTools();
    expect(list.tools.map((tool) => tool.name)).toEqual(["visible"]);
    const hidden = await client.callTool({ name: "hidden", arguments: {} });
    const missing = await emptyClient.callTool({
      name: "hidden",
      arguments: {},
    });
    expect(hidden).toEqual(missing);
    expect(hidden).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Unknown tool: hidden" }],
    });
  });

  it("fails discovery closed when policy returns a malformed decision", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "hidden",
      description: "hidden",
      input: passthrough(),
      handler: async () => ({ data: { leaked: true } }),
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
      makeAuthContext: () =>
        auth((() => ({
          outcome: "allow",
        })) as unknown as AuthContext["authorize"]),
    });
    const client = await pair(adapter);

    expect((await client.listTools()).tools).toEqual([]);
    expect(
      await client.callTool({ name: "hidden", arguments: {} })
    ).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Unknown tool: hidden" }],
    });
  });

  it("returns approval-required as a completed structured MCP error", async () => {
    let handled = false;
    const r = new ToolRegistry({
      security: {
        requestId: () => "request-1",
        approvalProvider: {
          decide: () => ({
            outcome: "required",
            reason: "Ask the user",
            approvalRequestId: "approval-1",
            expiresAt: "2026-07-16T20:00:00.000Z",
          }),
        },
      },
    });
    r.register({
      name: "dangerous",
      description: "dangerous",
      input: passthrough(),
      approval: "exec",
      handler: async () => {
        handled = true;
        return { data: { ran: true } };
      },
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
      makeAuthContext: () =>
        auth(() => ({
          outcome: "allow",
          reason: "allowed",
        })),
    });
    const client = await pair(adapter);

    const result = await client.callTool({
      name: "dangerous",
      arguments: {},
    });
    expect(result).toMatchObject({
      isError: true,
      structuredContent: {
        error: {
          code: "APPROVAL_REQUIRED",
          message: "Approval required",
          details: {
            requestId: "request-1",
            approvalRequestId: "approval-1",
            toolName: "dangerous",
            approvalTier: "exec",
            reason: "Ask the user",
            resource: { kind: "tool", target: "dangerous" },
          },
        },
      },
    });
    expect(handled).toBe(false);
  });

  it("uses makeAuthContext as the sole policy while preserving host context", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "canonical-auth",
      description: "canonical auth",
      input: passthrough(),
      approval: "read",
      handler: async (_input, ctx) => ({
        data: {
          invoker: (ctx.host as { invoker?: string } | undefined)?.invoker,
        },
      }),
    });
    const adapter = createMcpServer({
      serverName: "test",
      serverVersion: "0",
      source: r,
      makeAuthContext: () =>
        auth(() => ({
          outcome: "allow",
          reason: "transport allowed",
        })),
      makeContext: () => ({
        host: { invoker: "agent" },
      }),
    });
    const client = await pair(adapter);

    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual([
      "canonical-auth",
    ]);
    const result = await client.callTool({
      name: "canonical-auth",
      arguments: {},
    });
    expect(result.structuredContent).toEqual({ invoker: "agent" });
  });

  it("rejects invocation-only auth before advertising the catalog", async () => {
    const r = new ToolRegistry();
    r.register({
      name: "hidden",
      description: "must not be advertised",
      input: passthrough(),
      handler: async () => ({ data: { leaked: true } }),
    });
    const makeContext = (() => ({
      auth: auth(() => ({ outcome: "deny", reason: "hidden" })),
    })) as unknown as NonNullable<McpAdapterOptions["makeContext"]>;
    const client = await pair(
      createMcpServer({
        serverName: "test",
        serverVersion: "0",
        source: r,
        makeContext,
      })
    );

    await expect(client.listTools()).rejects.toThrow(/makeAuthContext/);
  });

  it("treats write-tier meta-tools as writes for MCP allowlisting", async () => {
    const r = new ToolRegistry();
    const orchestrator = createOrchestrator({
      registries: [r],
      scope: "mcp",
    });
    const client = await pair(
      createMcpServer({
        serverName: "test",
        serverVersion: "0",
        source: orchestrator,
        writeToolPolicy: "require-allowlist",
      })
    );

    const names = (await client.listTools()).tools.map((tool) => tool.name);
    expect(names).not.toContain("load_tool");
    expect(names).not.toContain("unload_tool");
  });
});
