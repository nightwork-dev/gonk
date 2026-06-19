import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolRegistry, passthrough } from "@gonk/tool-registry";
import { afterEach, describe, expect, it } from "vitest";

import { createHttpMcpServer } from "../src/http/server.ts";
import type { HttpMcpServer, HttpMcpServerOptions } from "../src/http/types.ts";

// A REAL small ToolRegistry with two real tools whose handlers yield real results.
function makeRegistry(): ToolRegistry {
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
  r.register({
    name: "add",
    description: "add two numbers",
    input: passthrough(),
    inputJsonSchema: {
      type: "object",
      properties: { a: { type: "number" }, b: { type: "number" } },
      required: ["a", "b"],
    },
    handler: async (input: { a: number; b: number }) => ({ data: { sum: input.a + input.b } }),
  });
  return r;
}

const servers: HttpMcpServer[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const c of clients.splice(0)) await c.close().catch(() => {});
  for (const s of servers.splice(0)) await s.stop().catch(() => {});
});

async function start(over: Partial<HttpMcpServerOptions> = {}): Promise<{ url: string }> {
  const server = createHttpMcpServer({
    source: makeRegistry(),
    serverName: "gonk-mcp-http-test",
    serverVersion: "0",
    port: 0,
    ...over,
  });
  await server.start();
  servers.push(server);
  return { url: `http://127.0.0.1:${server.port}/mcp` };
}

async function connect(url: string, headers?: Record<string, string>): Promise<Client> {
  const client = new Client({ name: "test-client", version: "0" });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined,
  );
  // Same cross-package exactOptional cast as the server side (SDK not built strict).
  await client.connect(transport as Transport);
  clients.push(client);
  return client;
}

describe("HTTP-MCP server — real SDK client round-trip", () => {
  it("initialize + tools/list returns the real gonk tools", async () => {
    const { url } = await start();
    const client = await connect(url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["add", "echo"]);
    expect(tools.find((t) => t.name === "echo")?.inputSchema.type).toBe("object");
  });

  it("tools/call executes a real tool through the real handler path", async () => {
    const { url } = await start();
    const client = await connect(url);
    const res = await client.callTool({ name: "add", arguments: { a: 2, b: 3 } });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ sum: 5 });
  });

  it("auth: configured key rejects connect without bearer, accepts with the right bearer", async () => {
    const { url } = await start({ apiKey: "k3y" });
    await expect(connect(url)).rejects.toThrow(); // no bearer -> 401 -> initialize fails
    const client = await connect(url, { Authorization: "Bearer k3y" });
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });

  it("keyless when unconfigured", async () => {
    const { url } = await start();
    const client = await connect(url);
    expect((await client.listTools()).tools.length).toBeGreaterThan(0);
  });

  it("unknown endpoint path -> not found (no MCP there)", async () => {
    const { url } = await start();
    const base = url.replace("/mcp", "");
    const res = await fetch(`${base}/nope`, { method: "POST", body: "{}" });
    expect(res.status).toBe(404);
  });

  it("POST with an unknown Mcp-Session-Id -> 404", async () => {
    const { url } = await start();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Mcp-Session-Id": "does-not-exist" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(404);
  });

  it("non-initialize POST without a session -> 400", async () => {
    const { url } = await start();
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("oversized body -> 413", async () => {
    const { url } = await start();
    const huge = "a".repeat(4 * 1024 * 1024 + 1024);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { pad: huge } }),
    });
    expect(res.status).toBe(413);
  });

  it("concurrent sessions are independent; one closing doesn't break the other", async () => {
    const { url } = await start();
    const a = await connect(url);
    const b = await connect(url);
    expect((await a.listTools()).tools.length).toBeGreaterThan(0);
    expect((await b.listTools()).tools.length).toBeGreaterThan(0);
    await a.close();
    // b still works after a closed
    expect((await b.callTool({ name: "add", arguments: { a: 1, b: 1 } })).structuredContent).toEqual({
      sum: 2,
    });
  });

  it("network-safe default: a write-capable tool is gated (require-allowlist) unless allowlisted", async () => {
    function writeReg(): ToolRegistry {
      const r = new ToolRegistry();
      r.register({
        name: "danger_write",
        description: "a write tool",
        input: passthrough(),
        inputJsonSchema: { type: "object", properties: {}, additionalProperties: true },
        capabilities: { writesFs: true },
        handler: async () => ({ data: { ok: true } }),
      });
      return r;
    }
    // default policy (require-allowlist) -> write tool NOT advertised
    const gated = await start({ source: writeReg() });
    const c1 = await connect(gated.url);
    expect((await c1.listTools()).tools.map((t) => t.name)).not.toContain("danger_write");
    // explicit allowlist -> advertised
    const open = await start({ source: writeReg(), allowlist: ["danger_write"] });
    const c2 = await connect(open.url);
    expect((await c2.listTools()).tools.map((t) => t.name)).toContain("danger_write");
  });
});
