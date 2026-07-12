#!/usr/bin/env node
import { defaultDevMcpConfigPath, currentDevMcpEnvironment, readDevMcpConfig, useDevMcpEnvironment } from "./config.ts";
import { createDevMcpRouter } from "./server.ts";

interface Args {
  command: "serve" | "list" | "current" | "use";
  id?: string;
  config?: string;
  host?: string;
  port?: number;
  apiKey?: string;
  allowInsecure?: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const [command = "current", ...rest] = argv;
  if (command !== "serve" && command !== "list" && command !== "current" && command !== "use") {
    throw new Error(`unknown command "${command}"; use serve, list, current, or use`);
  }
  const args: Args = { command };
  for (let i = 0; i < rest.length; i++) {
    const value = rest[i];
    if (value === undefined) continue;
    const next = rest[i + 1];
    if (value === "--config" && next) (args.config = next), i++;
    else if (value === "--host" && next) (args.host = next), i++;
    else if (value === "--port" && next) (args.port = Number.parseInt(next, 10)), i++;
    else if (value === "--api-key" && next) (args.apiKey = next), i++;
    else if (value === "--allow-insecure") args.allowInsecure = true;
    else if (!value.startsWith("-") && command === "use" && !args.id) args.id = value;
    else throw new Error(`unexpected argument "${value}"`);
  }
  return args;
}

function print(environment: Awaited<ReturnType<typeof currentDevMcpEnvironment>>): void {
  process.stdout.write(`${environment.id}\n  repo: ${environment.repo}\n  branch: ${environment.branch}\n  endpoint: ${environment.endpoint}\n  database: ${environment.database ?? "unspecified"}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = args.config ?? defaultDevMcpConfigPath();
  if (args.command === "list") {
    const value = await readDevMcpConfig(config);
    for (const environment of value.environments) process.stdout.write(`${environment.id === value.active ? "*" : " "} ${environment.id}\t${environment.branch}\t${environment.endpoint}\t${environment.database ?? "unspecified"}\n`);
    return;
  }
  if (args.command === "current") return print(await currentDevMcpEnvironment(config));
  if (args.command === "use") {
    if (!args.id) throw new Error("use requires an environment id");
    print(await useDevMcpEnvironment(args.id, config));
    process.stderr.write("New MCP sessions will use this environment; reconnect existing sessions to switch safely.\n");
    return;
  }
  const apiKey = args.apiKey ?? process.env.GONK_DEV_MCP_API_KEY;
  const server = createDevMcpRouter({
    configPath: config,
    ...(args.host ? { host: args.host } : {}),
    ...(args.port !== undefined ? { port: args.port } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(args.allowInsecure ? { allowInsecure: true } : {}),
  });
  await server.start();
  process.stderr.write(`gonk-mcp-dev listening on http://${args.host ?? "127.0.0.1"}:${server.port}/mcp using ${config}\n`);
}

void main().catch((error) => {
  process.stderr.write(`gonk-mcp-dev: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
