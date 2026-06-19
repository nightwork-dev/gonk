#!/usr/bin/env node
// Thin CLI launcher for createHttpMcpServer — the real consumer that makes the
// exported factory non-orphan. Serves a built-in `gonk_health` tool so the
// endpoint advertises something live; production deployments wire their full
// capability suite (memory, knowledge, RLM, …) by calling createHttpMcpServer
// from the library with their own ToolRegistry/Orchestrator.
//
//   gonk-mcp-http [--host 0.0.0.0] [--port 8808] [--api-key <key>]
//
// Bind 0.0.0.0 on a Tailscale node and leave the key unset for trusted-tailnet
// mode; point an MCP client (an Eve `connection`, curl, any MCP client) at
// http://<host>:<port>/mcp.

import { ToolRegistry, passthrough } from "@gonk/tool-registry";

import { createHttpMcpServer } from "./server.ts";
import type { HttpMcpServerOptions } from "./types.ts";

const DEFAULT_PORT = 8808;

interface CliArgs {
  host?: string;
  port?: number;
  apiKey?: string;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--host" && next) (args.host = next), i++;
    else if (a === "--port" && next) (args.port = Number.parseInt(next, 10)), i++;
    else if (a === "--api-key" && next) (args.apiKey = next), i++;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const host = args.host ?? "127.0.0.1";

  const registry = new ToolRegistry();
  registry.register({
    name: "gonk_health",
    description: "Liveness + version for this gonk HTTP-MCP endpoint.",
    input: passthrough(),
    inputJsonSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => ({ data: { ok: true, server: "gonk-mcp-http", version: "0.0.0" } }),
  });

  const options: HttpMcpServerOptions = {
    source: registry,
    serverName: "gonk-mcp-http",
    serverVersion: "0.0.0",
    host,
    port: args.port ?? DEFAULT_PORT,
  };
  const key = args.apiKey ?? process.env.GONK_MCP_HTTP_KEY;
  if (key) options.apiKey = key;

  const server = createHttpMcpServer(options);
  await server.start();
  process.stderr.write(`gonk-mcp-http listening on http://${host}:${server.port}/mcp\n`);
}

void main();
