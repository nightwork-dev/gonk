import { describe, expect, it } from "vitest";

import { ToolRegistry, passthrough } from "@gonk/tool-registry";

import { createWebMcpHandler } from "../src/http/web.ts";

const endpoint = "http://app.test/mcp";

function post(body: unknown, sessionId?: string, token?: string): Request {
  return new Request(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "echo input",
    input: passthrough(),
    inputJsonSchema: { type: "object", properties: { text: { type: "string" } } },
    handler: async (input: { text: string }, ctx) => ({ data: { text: input.text, host: ctx.host } }),
  });
  return tools;
}

async function initialize(handler: ReturnType<typeof createWebMcpHandler>, token?: string): Promise<string> {
  const response = await handler.handle(post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "0" } },
  }, undefined, token));
  expect(response.status).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

describe("createWebMcpHandler", () => {
  it("mounts stateful MCP on a Web Request/Response route", async () => {
    const handler = createWebMcpHandler({
      source: registry(),
      serverName: "web-test",
      serverVersion: "0",
      enableJsonResponse: true,
      makeContext: () => ({ host: { invoker: "agent", profileId: "sol" } }),
    });
    const sessionId = await initialize(handler);
    await handler.handle(post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId));
    const response = await handler.handle(post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }, sessionId));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: { structuredContent: { text: "hi", host: { invoker: "agent", profileId: "sol" } } },
    });
    await handler.close();
  });

  it("rejects missing or incorrect bearer credentials", async () => {
    const handler = createWebMcpHandler({ source: registry(), serverName: "web-test", serverVersion: "0", apiKey: "secret" });
    expect((await handler.handle(post({}))).status).toBe(401);
    expect((await handler.handle(post({}, undefined, "wrong"))).status).toBe(401);
    expect(await initialize(handler, "secret")).toBeTruthy();
    await handler.close();
  });
});
