import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import { ToolRegistry, type ToolDefinition } from "@gonk/tool-registry";
import { createOrchestrator } from "@gonk/tool-orchestrator";

import { createMcpServer } from "../src/index.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

async function pair(adapter: ReturnType<typeof createMcpServer>): Promise<Client> {
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0" }, { capabilities: {} });
  await Promise.all([client.connect(clientT), adapter.connect(serverT)]);
  return client;
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
      handler: async (input: { text: string }) => ({ data: { echoed: input.text } }),
    });
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
    const client = await pair(adapter);

    const result = await client.listTools();
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]?.name).toBe("echo");
    expect(result.tools[0]?.inputSchema.type).toBe("object");
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
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
    const client = await pair(adapter);

    const result = await client.callTool({ name: "echo", arguments: { text: "hi" } });
    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([{ type: "text", text: "echoed: hi" }]);
    expect(result.structuredContent).toEqual({ echoed: "hi" });
  });

  it("returns isError for unknown tool", async () => {
    const r = new ToolRegistry();
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
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
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
    const client = await pair(adapter);
    const result = await client.callTool({ name: "boom", arguments: {} });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("kaboom");
  });

  it("respects activeSet when given an Orchestrator (only always tools advertised)", async () => {
    const r = new ToolRegistry();
    r.register([
      { name: "a", description: "a", visibility: "always", input: passthrough(), handler: async () => ({ data: 1 }) },
      { name: "b", description: "b", visibility: "on-demand", input: passthrough(), handler: async () => ({ data: 2 }) },
    ] as ToolDefinition[]);
    const orch = createOrchestrator({ registries: [r], scope: "mcp", registerMetaTools: false });
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: orch });
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
      { name: "writer-a", description: "a", input: passthrough(), capabilities: { writesFs: true }, handler: async () => ({ data: 1 }) },
      { name: "writer-b", description: "b", input: passthrough(), capabilities: { writesFs: true }, handler: async () => ({ data: 2 }) },
      { name: "reader", description: "r", input: passthrough(), handler: async () => ({ data: 3 }) },
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
    expect(list.tools.map((t) => t.name).sort()).toEqual(["reader", "writer-a"]);

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
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
    const client = await pair(adapter);
    const result = await client.callTool({ name: "rich", arguments: {} });
    const content = result.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
    expect(content[0]).toMatchObject({ type: "text", text: "# title" });
    expect(content[1]).toMatchObject({ type: "text" });
    expect(content[1]?.text).toContain("```ts");
    expect(content[2]).toMatchObject({ type: "image", mimeType: "image/png", data: "AAA" });
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
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
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
      hints: { mcp: { annotations: { readOnly: true, destructive: false, idempotent: true } } },
      handler: async () => ({ data: 1 }),
    });
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
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
    const result = await client.callTool({ name: "needs_scope", arguments: {} });
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
    const adapter = createMcpServer({ serverName: "test", serverVersion: "0", source: r });
    const client = await pair(adapter);
    await client.callTool({ name: "probe_scope", arguments: {} });
    expect(seen.had).toBe(false);
  });
});
