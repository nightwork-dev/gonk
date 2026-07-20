import type { AuthContext, AuthenticatedPrincipal } from "@gonk/auth";
import type { Tool as McpTool } from "@modelcontextprotocol/sdk/types.js";
import {
  ToolRegistry,
  collectToolOutcome,
  makeBaseContext,
  passthrough,
} from "@gonk/tool-registry";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMcpToolImporter,
  type McpImportedToolDefinition,
  type McpImporterConnection,
  type McpImporterConnectionFactoryOptions,
} from "../src/client.ts";
import { createHttpMcpServer } from "../src/http/server.ts";
import type { HttpMcpServer } from "../src/http/types.ts";

const servers: HttpMcpServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop().catch(() => {});
});

function remoteTool(
  name: string,
  over: Partial<McpTool> = {}
): McpTool {
  return {
    name,
    description: "UNTRUSTED REMOTE DESCRIPTION",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", minLength: 1 } },
      required: ["text"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
    },
    ...over,
  } as McpTool;
}

class FakeConnection implements McpImporterConnection {
  pages = new Map<string, { tools: McpTool[]; nextCursor?: string }>();
  calls: Array<{
    name: string;
    args: Record<string, unknown> | undefined;
    signal: AbortSignal | undefined;
    timeout: number | undefined;
  }> = [];
  result: unknown = {
    content: [{ type: "text", text: "remote ok", annotations: { audience: ["assistant"] } }],
    structuredContent: { ok: true },
    _meta: { secret: "drop-me" },
  };
  callError: unknown;
  closeCount = 0;
  changed: (() => void) | undefined;
  listGate: Promise<void> | undefined;
  onListStarted: (() => void) | undefined;

  constructor(tools: McpTool[] = [remoteTool("echo")]) {
    this.pages.set("", { tools });
  }

  async listTools(params?: { cursor?: string }) {
    this.onListStarted?.();
    await this.listGate;
    const page = this.pages.get(params?.cursor ?? "");
    if (!page) throw new Error(`unknown cursor ${params?.cursor}`);
    return page;
  }

  async callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    _schema?: unknown,
    options?: { signal?: AbortSignal; timeout?: number }
  ) {
    this.calls.push({
      name: params.name,
      args: params.arguments,
      signal: options?.signal,
      timeout: options?.timeout,
    });
    if (this.callError) throw this.callError;
    return this.result;
  }

  async close() {
    this.closeCount += 1;
  }

  getProtocolVersion() {
    return "2025-11-25";
  }
}

function importer(
  registry: ToolRegistry,
  connection: FakeConnection,
  over: Partial<Parameters<typeof createMcpToolImporter>[0]> = {}
) {
  return createMcpToolImporter({
    registry,
    serverId: "docs-server",
    endpoint: "https://mcp.example.test/mcp?credential=not-provenance",
    selection: { allow: ["echo", "second", "third"] },
    authorization: { requiredRole: "operator" },
    now: () => new Date("2026-07-20T12:00:00.000Z"),
    connectionFactory: async (options) => {
      connection.changed = options.onToolsChanged;
      return connection;
    },
    ...over,
  });
}

async function invoke(registry: ToolRegistry, name: string, input: unknown) {
  return collectToolOutcome(
    registry.invoke(name, input, makeBaseContext())
  );
}

describe("inbound MCP importer", () => {
  it("imports paginated selected tools with stable restrictive local metadata and provenance", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    connection.pages.set("", {
      tools: [remoteTool("echo"), remoteTool("hidden")],
      nextCursor: "page-2",
    });
    connection.pages.set("page-2", { tools: [remoteTool("second")] });
    const inbound = importer(registry, connection);

    await inbound.connect();

    expect(registry.list().map((tool) => tool.name).sort()).toEqual([
      "docs-server.echo",
      "docs-server.second",
    ]);
    const definition = registry.get("docs-server.echo") as McpImportedToolDefinition;
    expect(definition.description).toBe("Remote MCP tool docs-server/echo");
    expect(definition.description).not.toContain("UNTRUSTED");
    expect(definition.visibility).toBe("on-demand");
    expect(definition.approval).toBe("exec");
    expect(definition.authorization).toEqual({ requiredRole: "operator" });
    expect(definition.hints?.mcp?.annotations).toBeUndefined();
    expect(definition.provenance).toEqual({
      importer: "mcp",
      serverId: "docs-server",
      remoteToolName: "echo",
      endpoint: "https://mcp.example.test/mcp",
      protocolVersion: "2025-11-25",
      catalogRevision: 1,
      discoveredAt: "2026-07-20T12:00:00.000Z",
    });
  });

  it("compiles runtime input validation and fails a catalog with unsupported schema without replacing it", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    const inbound = importer(registry, connection);
    await inbound.connect();

    const invalid = await invoke(registry, "docs-server.echo", { text: "" });
    expect(invalid).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(connection.calls).toHaveLength(0);

    connection.pages.set("", {
      tools: [remoteTool("second", { inputSchema: { type: "object", oneOf: [] } as never })],
    });
    await expect(inbound.refresh()).rejects.toThrow(
      "Unsupported MCP input schema keyword oneOf"
    );
    expect(registry.list().map((tool) => tool.name)).toEqual([
      "docs-server.echo",
    ]);
    expect(inbound.revision).toBe(1);
  });

  it("atomically refreshes added, changed, and removed tools on list-change notification", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    const inbound = importer(registry, connection);
    await inbound.connect();

    connection.pages.set("", {
      tools: [
        remoteTool("echo", {
          inputSchema: {
            type: "object",
            properties: { count: { type: "integer", minimum: 1 } },
            required: ["count"],
            additionalProperties: false,
          },
        }),
        remoteTool("third"),
      ],
    });
    connection.changed?.();
    await waitFor(() => inbound.revision === 2);

    expect(registry.list().map((tool) => tool.name).sort()).toEqual([
      "docs-server.echo",
      "docs-server.third",
    ]);
    expect(await invoke(registry, "docs-server.echo", { text: "old" })).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await invoke(registry, "docs-server.echo", { count: 2 })).toMatchObject({
      ok: true,
    });
  });

  it("runs local authorization before upstream tools/call", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    const inbound = importer(registry, connection);
    await inbound.connect();
    const ctx = makeBaseContext({
      auth: auth(async () => ({ outcome: "deny", reason: "policy" })),
    });

    const denied = await collectToolOutcome(
      registry.invoke("docs-server.echo", { text: "blocked" }, ctx)
    );

    expect(denied).toMatchObject({ ok: false, code: "TOOL_NOT_FOUND" });
    expect(connection.calls).toHaveLength(0);
  });

  it("preserves sanitized success data and maps remote tool errors distinctly", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    const inbound = importer(registry, connection);
    await inbound.connect();

    const success = await invoke(registry, "docs-server.echo", { text: "yes" });
    expect(success).toMatchObject({
      ok: true,
      data: {
        content: [{ type: "text", text: "remote ok" }],
        structuredContent: { ok: true },
        provenance: { remoteToolName: "echo" },
      },
      display: "remote ok",
    });
    expect((success as { data: Record<string, unknown> }).data._meta).toBeUndefined();

    connection.result = {
      content: [{ type: "text", text: "remote rejected" }],
      isError: true,
    };
    const remoteFailure = await invoke(registry, "docs-server.echo", { text: "no" });
    expect(remoteFailure).toMatchObject({
      ok: false,
      code: "REMOTE_TOOL_ERROR",
      details: { content: [{ type: "text", text: "remote rejected" }], isError: true },
    });
  });

  it("validates advertised structured output", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection([
      remoteTool("echo", {
        outputSchema: {
          type: "object",
          properties: { ok: { type: "boolean" } },
          required: ["ok"],
          additionalProperties: false,
        },
      }),
    ]);
    connection.result = {
      content: [],
      structuredContent: { ok: "not-a-boolean" },
    };
    const inbound = importer(registry, connection);
    await inbound.connect();

    expect(await invoke(registry, "docs-server.echo", { text: "x" })).toMatchObject({
      ok: false,
      code: "REMOTE_OUTPUT_INVALID",
    });
  });

  it("propagates cancellation and timeout options and distinguishes transport failures", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    connection.callError = new Error("connection dropped");
    const inbound = importer(registry, connection, { requestTimeoutMs: 321 });
    await inbound.connect();
    const signal = new AbortController().signal;
    const outcome = await collectToolOutcome(
      registry.invoke(
        "docs-server.echo",
        { text: "x" },
        makeBaseContext({ signal })
      )
    );

    expect(connection.calls[0]).toMatchObject({ signal, timeout: 321 });
    expect(outcome).toMatchObject({
      ok: false,
      code: "REMOTE_TRANSPORT_ERROR",
    });
  });

  it("maps upstream cancellation and timeout separately", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    const inbound = importer(registry, connection);
    await inbound.connect();

    connection.callError = Object.assign(new Error("cancelled"), {
      name: "AbortError",
    });
    expect(await invoke(registry, "docs-server.echo", { text: "x" })).toMatchObject({
      ok: false,
      code: "REMOTE_CANCELLED",
    });

    connection.callError = new Error("MCP request timeout after 10ms");
    expect(await invoke(registry, "docs-server.echo", { text: "x" })).toMatchObject({
      ok: false,
      code: "REMOTE_TIMEOUT",
    });
  });

  it("maps malformed upstream results as protocol failures", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    connection.result = { structuredContent: { ok: true } };
    const inbound = importer(registry, connection);
    await inbound.connect();

    expect(await invoke(registry, "docs-server.echo", { text: "x" })).toMatchObject({
      ok: false,
      code: "REMOTE_PROTOCOL_ERROR",
    });
  });

  it("closes and reconnects deterministically with host-resolved credentials", async () => {
    const registry = new ToolRegistry();
    const connections: FakeConnection[] = [];
    const resolvedHeaders: Readonly<Record<string, string>>[] = [];
    let token = "first";
    const inbound = createMcpToolImporter({
      registry,
      serverId: "docs-server",
      endpoint: "https://mcp.example.test/mcp",
      selection: { allow: ["echo"] },
      authorization: { requiredRole: "operator" },
      resolveHeaders: () => ({ Authorization: `Bearer ${token}` }),
      connectionFactory: async (options: McpImporterConnectionFactoryOptions) => {
        resolvedHeaders.push(options.headers);
        const connection = new FakeConnection();
        connections.push(connection);
        return connection;
      },
    });
    await inbound.connect();
    token = "second";
    await inbound.reconnect();

    expect(resolvedHeaders).toEqual([
      { Authorization: "Bearer first" },
      { Authorization: "Bearer second" },
    ]);
    expect(connections[0]?.closeCount).toBe(1);
    expect(inbound.connected).toBe(true);
    await inbound.close();
    expect(connections[1]?.closeCount).toBe(1);
    expect(inbound.connected).toBe(false);
    expect(registry.list()).toEqual([]);
  });

  it("cannot repopulate stale tools when close races an in-flight refresh", async () => {
    const registry = new ToolRegistry();
    const connection = new FakeConnection();
    const inbound = importer(registry, connection);
    await inbound.connect();

    let releaseList!: () => void;
    let markListStarted!: () => void;
    connection.listGate = new Promise<void>((resolve) => {
      releaseList = resolve;
    });
    const listStarted = new Promise<void>((resolve) => {
      markListStarted = resolve;
    });
    connection.onListStarted = markListStarted;

    const refresh = inbound.refresh();
    await listStarted;
    await inbound.close();
    releaseList();

    await expect(refresh).rejects.toThrow("lifecycle changed during refresh");
    expect(registry.list()).toEqual([]);
    expect(inbound.connected).toBe(false);
  });

  it("imports and invokes through a separately running authenticated Streamable HTTP server", async () => {
    const upstreamRegistry = new ToolRegistry();
    upstreamRegistry.register({
      name: "echo",
      description: "echo",
      approval: "read",
      input: passthrough<{ text: string }>(),
      inputJsonSchema: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      handler: async ({ text }) => ({ data: { echoed: text } }),
    });
    const server = createHttpMcpServer({
      source: upstreamRegistry,
      serverName: "authenticated-upstream",
      serverVersion: "1",
      port: 0,
      apiKey: "test-secret",
      allowUnrestrictedTools: true,
    });
    await server.start();
    servers.push(server);

    const localRegistry = new ToolRegistry();
    const inbound = createMcpToolImporter({
      registry: localRegistry,
      serverId: "live-upstream",
      endpoint: `http://127.0.0.1:${server.port}/mcp`,
      allowInsecureLoopback: true,
      allowedOrigins: [`http://127.0.0.1:${server.port}`],
      selection: { allow: ["echo"] },
      authorization: { requiredRole: "operator" },
      resolveHeaders: () => ({ Authorization: "Bearer test-secret" }),
    });
    await inbound.connect();

    expect(await invoke(localRegistry, "live-upstream.echo", { text: "round-trip" })).toMatchObject({
      ok: true,
      data: { structuredContent: { echoed: "round-trip" } },
    });
    await inbound.close();
  });

  it("rejects unsafe endpoints before resolving credentials or connecting", async () => {
    const registry = new ToolRegistry();
    let resolved = false;
    expect(() =>
      createMcpToolImporter({
        registry,
        serverId: "unsafe",
        endpoint: "http://metadata.internal/mcp",
        selection: { allow: [] },
        authorization: {},
        resolveHeaders: () => {
          resolved = true;
          return {};
        },
      })
    ).toThrow("must use HTTPS");
    expect(resolved).toBe(false);
  });
});

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
  return { principal: authenticatedPrincipal(), authorize };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out waiting for refresh");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
