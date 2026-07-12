import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { currentDevMcpEnvironment, useDevMcpEnvironment, writeDevMcpConfig } from "../src/dev/config.ts";
import { createDevMcpRouter, type DevMcpRouter } from "../src/dev/server.ts";

interface Target {
  id: string;
  server: Server;
  port: number;
  calls: string[];
  authorization: Array<string | undefined>;
}

const targets: Target[] = [];
const routers: DevMcpRouter[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const router of routers.splice(0)) await router.stop().catch(() => {});
  for (const target of targets.splice(0)) await new Promise<void>((resolve) => target.server.close(() => resolve()));
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function startTarget(id: string): Promise<Target> {
  const calls: string[] = [];
  const authorization: Array<string | undefined> = [];
  const server = createServer(async (req, res) => {
    const body = await read(req);
    const rpc = JSON.parse(body) as { method: string; params?: { name?: string } };
    calls.push(`${id}:${rpc.method}:${rpc.params?.name ?? ""}`);
    authorization.push(req.headers.authorization);
    if (rpc.method === "initialize") {
      res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": `${id}-session` });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: id, version: "1" } } }));
      return;
    }
    if (rpc.method === "tools/list") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [
        { name: "read", description: "read data", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
        { name: "write", description: "change data", inputSchema: { type: "object" } },
      ] } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 3, result: { content: [{ type: "text", text: `${id} handled ${rpc.params?.name}` }] } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("target did not bind a port");
  const target = { id, server, port: address.port, calls, authorization };
  targets.push(target);
  return target;
}

async function setup(): Promise<{ a: Target; b: Target; configPath: string; url: string }> {
  const a = await startTarget("alpha");
  const b = await startTarget("beta");
  const directory = await mkdtemp(join(tmpdir(), "gonk-dev-mcp-"));
  directories.push(directory);
  const configPath = join(directory, "targets.json");
  await writeDevMcpConfig({
    version: 1,
    active: "alpha",
    environments: [
      { id: "alpha", repo: "/work/tapestry", branch: "main", endpoint: `http://127.0.0.1:${a.port}/mcp`, database: "/data/canonical.db", headers: { Authorization: "Bearer alpha-target" } },
      { id: "beta", repo: "/work/tapestry-review", branch: "feat/review", endpoint: `http://127.0.0.1:${b.port}/mcp`, database: "/data/isolated.db" },
    ],
  }, configPath);
  const router = createDevMcpRouter({ configPath, port: 0 });
  await router.start();
  routers.push(router);
  return { a, b, configPath, url: `http://127.0.0.1:${router.port}/mcp` };
}

async function rpc(url: string, body: unknown, session?: string, authorization?: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(session ? { "Mcp-Session-Id": session } : {}), ...(authorization ? { Authorization: authorization } : {}) },
    body: JSON.stringify(body),
  });
}

describe("dev MCP router", () => {
  it("pins a live session while `use` changes the environment for new sessions", async () => {
    const { a, b, configPath, url } = await setup();
    const initialize = await rpc(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const alphaSession = initialize.headers.get("mcp-session-id");
    expect(alphaSession).toBeTruthy();
    if (!alphaSession) throw new Error("missing alpha session");
    expect(alphaSession).not.toBe("alpha-session");
    expect(initialize.headers.get("x-gonk-dev-environment")).toBe("alpha");

    await useDevMcpEnvironment("beta", configPath);
    expect((await currentDevMcpEnvironment(configPath)).id).toBe("beta");

    await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "write" } }, alphaSession);
    expect(a.calls).toContain("alpha:tools/call:write");
    expect(b.calls).not.toContain("beta:tools/call:write");

    const newInitialize = await rpc(url, { jsonrpc: "2.0", id: 3, method: "initialize", params: {} });
    expect(newInitialize.headers.get("mcp-session-id")).not.toBe("beta-session");
    expect(newInitialize.headers.get("x-gonk-dev-environment")).toBe("beta");
  });

  it("marks non-read-only tools and results with the code and data target", async () => {
    const { url } = await setup();
    const initialize = await rpc(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    const session = initialize.headers.get("mcp-session-id");
    if (!session) throw new Error("missing session");

    const tools = await rpc(url, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, session);
    const listed = await tools.json() as { result: { tools: Array<{ name: string; description: string }> } };
    expect(listed.result.tools.find((tool) => tool.name === "read")?.description).toBe("read data");
    expect(listed.result.tools.find((tool) => tool.name === "write")?.description).toContain("DEV TARGET: alpha");
    expect(listed.result.tools.find((tool) => tool.name === "write")?.description).toContain("canonical.db");

    const write = await rpc(url, { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "write" } }, session);
    const result = await write.json() as { result: { content: Array<{ text: string }> } };
    expect(result.result.content.at(-1)?.text).toContain("This call was routed here");
    expect(result.result.content.at(-1)?.text).toContain("branch: main");
  });

  it("rejects unknown sessions rather than guessing which target should receive a call", async () => {
    const { url } = await setup();
    const response = await rpc(url, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, "not-a-real-session");
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("reconnect");
  });

  it("keeps the router bearer token at the router and uses only the target's configured credentials upstream", async () => {
    const { a, configPath } = await setup();
    const router = createDevMcpRouter({ configPath, port: 0, apiKey: "router-secret" });
    await router.start();
    routers.push(router);
    await rpc(`http://127.0.0.1:${router.port}/mcp`, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, undefined, "Bearer router-secret");
    expect(a.authorization).toEqual(["Bearer alpha-target"]);
  });
});

function read(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
