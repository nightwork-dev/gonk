import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Transport } from "@modelcontextprotocol/client";
import type { AuthenticatedPrincipal } from "@gonk/auth";
import { passthrough, ToolRegistry } from "@gonk/tool-registry";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpMcpServer, type HttpMcpServer } from "../src/http/index.ts";

const servers: HttpMcpServer[] = [];
const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.stop();
});

// A host principal that is not the one the static bearer key authenticates.
const otherPrincipal: AuthenticatedPrincipal = {
  id: "service:someone-else", kind: "service",
  identity: { issuer: "test", subject: "someone-else", method: "service-token" },
  roles: [], scopes: [],
};
const headers = { authorization: "Bearer test-token", "content-type": "application/json" };

async function start() {
  const registry = new ToolRegistry();
  let invoked = 0;
  registry.register({
    name: "echo", description: "Echo", approval: "read", input: passthrough(),
    handler: async (value) => { invoked++; return { data: value }; },
  });
  const logged: string[] = [];
  const log = {
    debug: () => {}, info: () => {},
    warn: (message: string) => { logged.push(message); },
    error: (message: string) => { logged.push(message); },
  };
  const server = createHttpMcpServer({
    source: registry, serverName: "mismatch", serverVersion: "0", jsonPath: "/tools",
    apiKey: "test-token", log,
    makeAuthContext: () => ({
      principal: otherPrincipal,
      authorize: () => ({ outcome: "allow" as const, reason: "test" }),
    }),
  });
  servers.push(server);
  await server.start();
  return { base: `http://127.0.0.1:${server.port}`, logged, invoked: () => invoked };
}

describe("a makeAuthContext principal that differs from the authenticated one", () => {
  it("is refused with 403 and a reason on JSON routes, and logged", async () => {
    const { base, logged, invoked } = await start();
    for (const response of [
      await fetch(`${base}/tools`, { headers }),
      await fetch(`${base}/tools/echo`, { method: "POST", headers, body: "{}" }),
    ]) {
      expect(response.status).toBe(403);
      const body = (await response.json()) as { error: { message: string } };
      expect(body.error.message).toMatch(/makeAuthContext/);
      expect(body.error.message).toMatch(/different principal/);
    }
    expect(invoked()).toBe(0);
    expect(logged.some((line) => /different principal/.test(line))).toBe(true);
  });

  it("is refused with the reason over MCP, and logged", async () => {
    const { base, logged, invoked } = await start();
    const client = new Client({ name: "mismatch", version: "0" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers },
    }) as Transport);
    await expect(client.listTools()).rejects.toThrow(/different principal/);
    const call = client.callTool({ name: "echo", arguments: {} });
    await expect(call).rejects.toThrow(/different principal/);
    expect(invoked()).toBe(0);
    expect(logged.some((line) => /different principal/.test(line))).toBe(true);
  });
});
