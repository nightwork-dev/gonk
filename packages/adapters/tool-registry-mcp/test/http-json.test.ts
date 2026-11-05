import { request } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { Transport } from "@modelcontextprotocol/client";
import type { AuthenticatedPrincipal } from "@gonk/auth";
import { collectToolOutcome, makeBaseContext, passthrough, ToolRegistry } from "@gonk/tool-registry";
import { afterEach, describe, expect, it } from "vitest";
import { GONK_AUTH_INFO_PRINCIPAL } from "../src/index.ts";
import { createHttpMcpServer, createWebMcpHandler, type HttpMcpServer, type HttpMcpServerOptions } from "../src/http/index.ts";

const servers: HttpMcpServer[] = [];
const clients: Client[] = [];
afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  for (const server of servers.splice(0)) await server.stop();
});

const principal: AuthenticatedPrincipal = {
  id: "service:json-test", kind: "service",
  identity: { issuer: "test", subject: "json-test", method: "service-token" },
  roles: [], scopes: [],
};
const auth = { principal, authorize: () => ({ outcome: "allow" as const, reason: "test" }) };

async function start(registry: ToolRegistry, extra: Partial<HttpMcpServerOptions> = {}) {
  const server = createHttpMcpServer({
    source: registry, serverName: "json-test", serverVersion: "0", jsonPath: "/tools",
    apiKey: "test-token", staticBearerClientId: "json-test",
    makeAuthContext: ({ http }) => ({ ...auth,
      principal: http!.authInfo!.extra![GONK_AUTH_INFO_PRINCIPAL] as AuthenticatedPrincipal,
    }), ...extra,
  });
  servers.push(server);
  await server.start();
  return `http://127.0.0.1:${server.port}`;
}
const headers = { authorization: "Bearer test-token", "content-type": "application/json" };
function invoke(base: string, name: string, input: unknown, extraHeaders = {}) {
  return fetch(`${base}/tools/${encodeURIComponent(name)}`, {
    method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(input),
  });
}

describe("opt-in JSON HTTP tools", () => {
  it("discovers and invokes the registry through JSON and keeps MCP working", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "echo", description: "Echo a raw scalar", approval: "read", input: passthrough(),
      inputJsonSchema: { type: "string" }, hints: { mcp: { mcpName: "public.echo" } },
      handler: async (value) => ({ data: { value }, display: "echoed", metadata: { size: { returned: 1, unit: "items" } } }),
    });
    const expected = await collectToolOutcome(registry.invoke("echo", "hello", makeBaseContext({ auth })));
    const base = await start(registry);
    const discovery = await fetch(`${base}/tools`, { headers });
    const body = await discovery.json();
    expect(body).toMatchObject({ tools: [{ name: "public.echo", inputSchema: { type: "string" } }] });
    const response = await invoke(base, "public.echo", "hello");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expected);

    const client = new Client({ name: "json-test", version: "0" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
      requestInit: { headers },
    }) as Transport);
    const tools = (await client.listTools()).tools;
    expect(tools[0]?.name).toBe("public.echo");
    expect(tools[0]?.inputSchema).toMatchObject({ type: "object", properties: { value: { type: "string" } } });
    expect((await client.callTool({ name: "public.echo", arguments: { value: "hello" } })).structuredContent).toEqual({ value: "hello" });
  });

  it("rejects credentials and policy without entering a tool handler", async () => {
    let invoked = 0;
    const registry = new ToolRegistry();
    registry.register({ name: "protected", description: "Protected", approval: "read", input: passthrough(),
      handler: async () => { invoked++; return { data: true }; },
    });
    const base = await start(registry, { makeAuthContext: ({ http }) => ({
      principal: http!.authInfo!.extra![GONK_AUTH_INFO_PRINCIPAL] as AuthenticatedPrincipal,
      authorize: ({ action }) => ({
        outcome: action === "tool.discover" ? "allow" : "deny", reason: "test policy",
      }),
    }) });
    expect((await invoke(base, "protected", {}, { authorization: "Bearer wrong" })).status).toBe(401);
    const denied = await invoke(base, "protected", {});
    expect(await denied.json()).toMatchObject({ ok: false, code: "AUTHORIZATION_DENIED" });
    expect(invoked).toBe(0);
  });

  it("uses the same write gate and hides denied discovery and direct calls", async () => {
    const registry = new ToolRegistry();
    let invoked = 0;
    for (const name of ["hidden", "write"]) registry.register({
      name, description: name, approval: name === "write" ? "write" : "read", input: passthrough(),
      handler: async () => { invoked++; return { data: true }; },
    });
    const base = await start(registry, { makeAuthContext: ({ http }) => ({
      principal: http!.authInfo!.extra![GONK_AUTH_INFO_PRINCIPAL] as AuthenticatedPrincipal,
      authorize: () => ({ outcome: "deny", reason: "hidden" }),
    }) });
    expect(await (await fetch(`${base}/tools`, { headers })).json()).toEqual({ tools: [] });
    for (const name of ["hidden", "write"]) {
      const result = await invoke(base, name, {});
      expect(result.status).toBe(404);
      expect(await result.json()).toMatchObject({ ok: false, code: "TOOL_NOT_FOUND" });
    }
    expect(invoked).toBe(0);
  });

  it("protects JSON with Host, Origin, body size, and JSON media checks", async () => {
    const base = await start(new ToolRegistry(), { allowedOrigins: ["https://trusted.test"] });
    const port = Number(new URL(base).port);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/tools", headers: {
        authorization: headers.authorization, host: "evil.test",
      } }, (response) => { response.resume(); resolve(response.statusCode!); });
      req.on("error", reject); req.end();
    });
    expect(status).toBe(403);
    expect((await fetch(`${base}/tools`, { headers: { ...headers, origin: "https://evil.test" } })).status).toBe(403);
    expect((await invoke(base, "missing", {}, { "content-type": "text/plain" })).status).toBe(415);
    expect((await fetch(`${base}/tools/missing`, { method: "POST", headers, body: "{" })).status).toBe(400);
    expect((await invoke(base, "missing", "x".repeat(4 * 1024 * 1024))).status).toBe(413);
  });

  it("passes request cancellation into the same registry context", async () => {
    const registry = new ToolRegistry();
    const controller = new AbortController();
    let running!: () => void;
    const started = new Promise<void>((resolve) => { running = resolve; });
    let observedSignal: AbortSignal | undefined;
    registry.register({ name: "wait", description: "Wait", approval: "read", input: passthrough(),
      handler: async (_input, context) => {
        observedSignal = context.signal;
        running();
        await new Promise<void>((resolve) => context.signal.addEventListener("abort", () => resolve(), { once: true }));
        return { data: true };
      },
    });
    const handler = createWebMcpHandler({ source: registry, serverName: "cancel", serverVersion: "0",
      jsonPath: "/tools", allowInsecure: true, allowUnrestrictedTools: true,
    });
    const response = handler.handle(new Request("http://app.test/tools/wait", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: controller.signal,
    }));
    await started;
    controller.abort();
    expect(observedSignal?.aborted).toBe(true);
    expect(await (await response).json()).toMatchObject({ ok: false, code: "ABORTED" });
    await handler.close();
  });
});
