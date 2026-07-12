import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface DevMcpEnvironment {
  /** Stable short name used by `gonk-mcp-dev use <id>`. */
  id: string;
  /** Human-facing repository identity, usually an absolute checkout path. */
  repo: string;
  /** The branch or revision that is actually serving this endpoint. */
  branch: string;
  /** Streamable-HTTP MCP endpoint, including its path (normally `/mcp`). */
  endpoint: string;
  /** Data target is deliberately separate from the code checkout. */
  database?: string;
  /** Static headers for the target endpoint, such as an endpoint-local bearer token. */
  headers?: Record<string, string>;
}

export interface DevMcpConfig {
  version: 1;
  active: string;
  environments: DevMcpEnvironment[];
}

export function defaultDevMcpConfigPath(): string {
  return process.env.GONK_DEV_MCP_CONFIG ?? join(homedir(), ".config", "gonk", "dev-mcp.json");
}

export function validateDevMcpConfig(value: unknown): DevMcpConfig {
  if (!isRecord(value) || value.version !== 1 || typeof value.active !== "string" || !Array.isArray(value.environments)) {
    throw new Error("invalid dev MCP config: expected { version: 1, active, environments }");
  }
  const ids = new Set<string>();
  const environments = value.environments.map((item, index) => {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.repo !== "string" || typeof item.branch !== "string" || typeof item.endpoint !== "string") {
      throw new Error(`invalid dev MCP config: environment ${index} needs id, repo, branch, and endpoint strings`);
    }
    if (!item.id.trim() || ids.has(item.id)) throw new Error(`invalid dev MCP config: duplicate or empty environment id "${item.id}"`);
    ids.add(item.id);
    let endpoint: URL;
    try {
      endpoint = new URL(item.endpoint);
    } catch {
      throw new Error(`invalid dev MCP config: environment "${item.id}" has an invalid endpoint`);
    }
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error(`invalid dev MCP config: environment "${item.id}" endpoint must use http(s)`);
    }
    const headers = item.headers === undefined ? undefined : validateHeaders(item.headers, item.id);
    return {
      id: item.id,
      repo: item.repo,
      branch: item.branch,
      endpoint: endpoint.toString(),
      ...(typeof item.database === "string" ? { database: item.database } : {}),
      ...(headers ? { headers } : {}),
    };
  });
  if (!ids.has(value.active)) throw new Error(`invalid dev MCP config: active environment "${value.active}" does not exist`);
  return { version: 1, active: value.active, environments };
}

export async function readDevMcpConfig(path = defaultDevMcpConfigPath()): Promise<DevMcpConfig> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not read dev MCP config at ${path}: ${detail}`);
  }
  try {
    return validateDevMcpConfig(JSON.parse(raw));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`could not parse dev MCP config at ${path}: ${detail}`);
  }
}

export async function writeDevMcpConfig(config: DevMcpConfig, path = defaultDevMcpConfigPath()): Promise<void> {
  const validated = validateDevMcpConfig(config);
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function currentDevMcpEnvironment(path = defaultDevMcpConfigPath()): Promise<DevMcpEnvironment> {
  const config = await readDevMcpConfig(path);
  const environment = config.environments.find((item) => item.id === config.active);
  if (!environment) throw new Error(`active dev MCP environment "${config.active}" disappeared`);
  return environment;
}

export async function useDevMcpEnvironment(id: string, path = defaultDevMcpConfigPath()): Promise<DevMcpEnvironment> {
  const config = await readDevMcpConfig(path);
  const environment = config.environments.find((item) => item.id === id);
  if (!environment) throw new Error(`unknown dev MCP environment "${id}"`);
  await writeDevMcpConfig({ ...config, active: id }, path);
  return environment;
}

function validateHeaders(value: unknown, id: string): Record<string, string> {
  if (!isRecord(value)) throw new Error(`invalid dev MCP config: environment "${id}" headers must be an object`);
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (!name.trim() || typeof headerValue !== "string") throw new Error(`invalid dev MCP config: environment "${id}" headers must be string pairs`);
    headers[name] = headerValue;
  }
  return headers;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
