import { request } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolRegistry, passthrough } from "@gonk/tool-registry";
import { afterEach, describe, expect, it } from "vitest";

/** POST JSON to 127.0.0.1:port with an explicit (possibly foreign) Host header,
 *  bypassing fetch's forbidden-header filtering. Resolves the status code. */
function rawPost(port: number, path: string, host: string, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          Host: host,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("error", reject);
    req.end(payload);
  });
}

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

  it("refuses a non-loopback bind with no apiKey (unauthenticated network exposure)", () => {
    expect(() =>
      createHttpMcpServer({
        source: makeRegistry(),
        serverName: "t",
        serverVersion: "0",
        host: "0.0.0.0",
      }),
    ).toThrow(/unauthenticated/i);
  });

  it("allows a non-loopback bind with no key when allowInsecure is set", async () => {
    const server = createHttpMcpServer({
      source: makeRegistry(),
      serverName: "t",
      serverVersion: "0",
      host: "0.0.0.0",
      port: 0,
      allowInsecure: true,
    });
    await server.start();
    servers.push(server);
    expect(server.port).toBeGreaterThan(0);
  });

  it("allows a non-loopback bind when an apiKey AND allowedHosts are set", async () => {
    const server = createHttpMcpServer({
      source: makeRegistry(),
      serverName: "t",
      serverVersion: "0",
      host: "0.0.0.0",
      port: 0,
      apiKey: "k3y",
      allowedHosts: ["mybox.tail-scale.ts.net:8080"],
    });
    await server.start();
    servers.push(server);
    expect(server.port).toBeGreaterThan(0);
  });

  it("refuses a protected non-loopback bind with no allowedHosts (would silently reject every request)", () => {
    // apiKey satisfies the exposure guard, but rebinding protection on a
    // wildcard bind with no allowedHosts can only allow-list `0.0.0.0:port` —
    // a Host no client ever sends — so every request would 400 while the port
    // sits open. Must fail loud at construction instead.
    expect(() =>
      createHttpMcpServer({
        source: makeRegistry(),
        serverName: "t",
        serverVersion: "0",
        host: "0.0.0.0",
        apiKey: "k3y",
      }),
    ).toThrow(/allowedHosts/);
  });

  it("an EMPTY allowedHosts array doesn't satisfy the guard (dead-server one layer over)", () => {
    // [] is `!== undefined` but hands the SDK an empty allowlist → every Host
    // rejected. The guard must catch it the same as omitting it.
    expect(() =>
      createHttpMcpServer({
        source: makeRegistry(),
        serverName: "t",
        serverVersion: "0",
        host: "0.0.0.0",
        apiKey: "k3y",
        allowedHosts: [],
      }),
    ).toThrow(/allowedHosts/);
  });

  it("an explicit enableDnsRebindingProtection:true on a wildcard bind still requires allowedHosts", () => {
    // The footgun is closed on the explicit path too, not just the default.
    expect(() =>
      createHttpMcpServer({
        source: makeRegistry(),
        serverName: "t",
        serverVersion: "0",
        host: "0.0.0.0",
        apiKey: "k3y",
        enableDnsRebindingProtection: true,
      }),
    ).toThrow(/allowedHosts/);
  });

  it("keyless trusted-tailnet (allowInsecure) defaults rebinding OFF so a client can dial by any name", () => {
    // The documented keyless mode: perimeter is the boundary. Protection off →
    // no Host-check → a tailnet client dialing by MagicDNS name isn't rejected.
    // Construction must succeed with no allowedHosts.
    const server = createHttpMcpServer({
      source: makeRegistry(),
      serverName: "t",
      serverVersion: "0",
      host: "0.0.0.0",
      port: 0,
      allowInsecure: true,
    });
    expect(server).toBeDefined();
  });

  it("DNS-rebinding protection is on by default but a foreign Host header is rejected", async () => {
    const { url } = await start();
    const port = Number(new URL(url).port);
    // A request whose Host header is not the bound address is rejected by the
    // SDK transport (classic DNS-rebinding defense). fetch forbids setting Host,
    // so drive it through node:http with an explicit foreign Host.
    const status = await rawPost(port, "/mcp", "evil.example.com", {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "x", version: "0" } },
    });
    expect(status).toBeGreaterThanOrEqual(400);
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
