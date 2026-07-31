import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import type {
  RequestOptions,
  Tool as McpTool,
  Transport,
} from "@modelcontextprotocol/client";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  ToolError,
  withJsonSchema,
  type Display,
  type ToolApproval,
  type ToolAuthorization,
  type ToolDefinition,
  type ToolRegistry,
} from "@gonk/tool-registry";

export interface McpImportedToolProvenance {
  readonly importer: "mcp";
  readonly serverId: string;
  readonly remoteToolName: string;
  readonly endpoint: string;
  readonly protocolVersion?: string;
  readonly catalogRevision: number;
  readonly discoveredAt: string;
}

export type McpImportedToolDefinition = ToolDefinition & {
  readonly provenance: McpImportedToolProvenance;
};

export interface McpImportedToolOverride {
  /** Trusted local description. Remote descriptions are never promoted. */
  description?: string;
  approval?: ToolApproval;
  authorization?: ToolAuthorization;
}

export type McpToolSelection =
  | { allow: readonly string[] }
  | { select: (tool: Readonly<McpTool>) => boolean };

export interface McpImporterConnection {
  listTools(
    params?: { cursor?: string },
    options?: RequestOptions
  ): Promise<{ tools: McpTool[]; nextCursor?: string }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: RequestOptions
  ): Promise<unknown>;
  close(): Promise<void>;
  getProtocolVersion?(): string | undefined;
}

export interface McpImporterConnectionFactoryOptions {
  endpoint: URL;
  headers: Readonly<Record<string, string>>;
  onToolsChanged(): void;
}

export interface McpToolImporterOptions {
  registry: ToolRegistry;
  serverId: string;
  endpoint: string | URL;
  selection: McpToolSelection;
  /** Local, reviewed authorization metadata applied to every imported tool. */
  authorization: ToolAuthorization;
  approval?: ToolApproval;
  overrides?: Readonly<Record<string, McpImportedToolOverride>>;
  /** Host-owned credential resolution. Returned headers never enter tool input. */
  resolveHeaders?: () =>
    | Readonly<Record<string, string>>
    | Promise<Readonly<Record<string, string>>>;
  allowedOrigins?: readonly string[];
  allowInsecureLoopback?: boolean;
  requestTimeoutMs?: number;
  now?: () => Date;
  connectionFactory?: (
    options: McpImporterConnectionFactoryOptions
  ) => Promise<McpImporterConnection>;
}

export interface McpToolImporter {
  connect(): Promise<void>;
  refresh(): Promise<void>;
  reconnect(): Promise<void>;
  close(): Promise<void>;
  readonly connected: boolean;
  readonly revision: number;
}

interface RemoteCallResult {
  content: unknown[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
  [key: string]: unknown;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export function createMcpToolImporter(
  options: McpToolImporterOptions
): McpToolImporter {
  const endpoint = validateEndpoint(options);
  const sourceId = `mcp:${options.serverId}`;
  let client: McpImporterConnection | undefined;
  let revision = 0;
  let refreshQueue = Promise.resolve();
  let closed = false;
  let lifecycleGeneration = 0;

  async function connect(): Promise<void> {
    if (client) return;
    closed = false;
    const generation = ++lifecycleGeneration;
    const headers = Object.freeze({ ...(await options.resolveHeaders?.()) });
    const factory = options.connectionFactory ?? createSdkConnection;
    const nextClient = await factory({
      endpoint,
      headers,
      onToolsChanged: () => {
        void enqueueRefresh().catch(() => {
          // A failed notification refresh deliberately retains the prior catalog.
        });
      },
    });
    if (generation !== lifecycleGeneration || closed) {
      await nextClient.close().catch(() => {});
      throw new Error("MCP importer lifecycle changed while connecting");
    }
    client = nextClient;
    try {
      await refreshNow(generation);
    } catch (error) {
      if (client === nextClient) client = undefined;
      await nextClient.close().catch(() => {});
      throw error;
    }
  }

  function refresh(): Promise<void> {
    return enqueueRefresh();
  }

  function enqueueRefresh(): Promise<void> {
    const generation = lifecycleGeneration;
    const pending = refreshQueue.then(
      () => refreshNow(generation),
      () => refreshNow(generation)
    );
    refreshQueue = pending.catch(() => {});
    return pending;
  }

  async function refreshNow(generation: number): Promise<void> {
    const activeClient = requireClient(client, closed);
    const tools = await listAllTools(
      activeClient,
      options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS
    );
    const nextRevision = revision + 1;
    const discoveredAt = (options.now ?? (() => new Date()))().toISOString();
    const definitions = tools
      .filter((tool) => isSelected(options.selection, tool))
      .map((tool) =>
        materializeTool({
          tool,
          client: activeClient,
          options,
          endpoint,
          revision: nextRevision,
          discoveredAt,
        })
      );

    if (
      generation !== lifecycleGeneration ||
      client !== activeClient ||
      closed
    ) {
      throw new Error("MCP importer lifecycle changed during refresh");
    }
    options.registry.replaceSource(sourceId, definitions);
    revision = nextRevision;
  }

  async function reconnect(): Promise<void> {
    lifecycleGeneration += 1;
    const previous = client;
    client = undefined;
    try {
      if (previous) await previous.close();
    } finally {
      options.registry.replaceSource(sourceId, []);
    }
    await connect();
  }

  async function close(): Promise<void> {
    closed = true;
    lifecycleGeneration += 1;
    const previous = client;
    client = undefined;
    try {
      if (previous) await previous.close();
    } finally {
      options.registry.replaceSource(sourceId, []);
    }
  }

  return {
    connect,
    refresh,
    reconnect,
    close,
    get connected() {
      return client !== undefined;
    },
    get revision() {
      return revision;
    },
  };
}

async function createSdkConnection(
  options: McpImporterConnectionFactoryOptions
): Promise<McpImporterConnection> {
  const client = new Client(
    { name: "gonk-mcp-importer", version: "0.4.0" },
    {
      capabilities: {},
      listChanged: {
        tools: {
          autoRefresh: false,
          debounceMs: 0,
          onChanged: (error) => {
            if (!error) options.onToolsChanged();
          },
        },
      },
    }
  );
  const transport = new StreamableHTTPClientTransport(options.endpoint, {
    requestInit: {
      headers: options.headers,
      redirect: "manual",
    },
  });
  await client.connect(transport as Transport);
  return Object.assign(client, {
    getProtocolVersion: () => transport.protocolVersion,
  }) as McpImporterConnection;
}

async function listAllTools(
  client: McpImporterConnection,
  timeout: number
): Promise<McpTool[]> {
  const tools: McpTool[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await client.listTools(
      cursor === undefined ? undefined : { cursor },
      { timeout }
    );
    tools.push(...page.tools);
    cursor = page.nextCursor;
    if (cursor && seenCursors.has(cursor)) {
      throw new Error(`MCP tools/list repeated cursor: ${cursor}`);
    }
    if (cursor) seenCursors.add(cursor);
  } while (cursor);
  return tools;
}

function materializeTool(input: {
  tool: McpTool;
  client: McpImporterConnection;
  options: McpToolImporterOptions;
  endpoint: URL;
  revision: number;
  discoveredAt: string;
}): McpImportedToolDefinition {
  const { tool, client, options, endpoint, revision, discoveredAt } = input;
  const override = options.overrides?.[tool.name];
  const inputSchema = sanitizeJsonSchema(tool.inputSchema);
  const outputSchema = tool.outputSchema
    ? sanitizeJsonSchema(tool.outputSchema)
    : undefined;
  const inputValidator = compileJsonSchema(inputSchema, "input");
  const outputValidator = outputSchema
    ? compileJsonSchema(outputSchema, "output")
    : undefined;
  const protocolVersion = client.getProtocolVersion?.();
  const provenance: McpImportedToolProvenance = Object.freeze({
    importer: "mcp",
    serverId: options.serverId,
    remoteToolName: tool.name,
    endpoint: credentialFreeEndpoint(endpoint),
    ...(protocolVersion === undefined ? {} : { protocolVersion }),
    catalogRevision: revision,
    discoveredAt,
  });

  return {
    name: localToolName(options.serverId, tool.name),
    description:
      override?.description ??
      `Remote MCP tool ${options.serverId}/${tool.name}`,
    visibility: "on-demand",
    input: withJsonSchema(inputValidator, inputSchema),
    inputJsonSchema: inputSchema,
    approval: override?.approval ?? options.approval ?? "exec",
    authorization: override?.authorization ?? options.authorization,
    capabilities: {
      network: true,
    },
    hints: {
      mcp: {
        visibility: "on-demand",
      },
    },
    provenance,
    handler: async (args, ctx) => {
      let result: RemoteCallResult;
      try {
        result = asCallResult(
          await client.callTool(
            { name: tool.name, arguments: asRecord(args) },
            {
              signal: ctx.signal,
              timeout: options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS,
            }
          )
        );
      } catch (error) {
        throw mapRemoteError(error, ctx.signal);
      }

      const sanitized = sanitizeMcpValue(result) as RemoteCallResult;
      if (result.isError) {
        throw new ToolError(
          "REMOTE_TOOL_ERROR",
          `Remote MCP tool ${tool.name} reported an error`,
          sanitized
        );
      }
      if (outputValidator && result.structuredContent !== undefined) {
        const validation = await outputValidator["~standard"].validate(
          result.structuredContent
        );
        if (validation.issues) {
          throw new ToolError(
            "REMOTE_OUTPUT_INVALID",
            `Remote MCP tool ${tool.name} returned invalid structured content`,
            validation.issues
          );
        }
      }
      const display = displayFromContent(result.content);
      return {
        data: { ...sanitized, provenance },
        ...(display === undefined ? {} : { display }),
      };
    },
  };
}

function compileJsonSchema(
  schema: Record<string, unknown>,
  purpose: "input" | "output"
): StandardSchemaV1<unknown, unknown> {
  assertSupportedSchema(schema, "$", new Set());
  return {
    "~standard": {
      version: 1,
      vendor: "gonk-mcp-json-schema-subset-2020-12",
      validate(value) {
        const issues: Array<{ message: string; path?: PropertyKey[] }> = [];
        validateSchemaValue(schema, value, [], issues);
        return issues.length > 0 ? { issues } : { value };
      },
    },
  };

  function unsupported(keyword: string, path: string): never {
    throw new Error(
      `Unsupported MCP ${purpose} schema keyword ${keyword} at ${path}`
    );
  }

  function assertSupportedSchema(
    node: Record<string, unknown>,
    path: string,
    seen: Set<object>
  ): void {
    if (seen.has(node)) unsupported("cyclic-schema", path);
    seen.add(node);
    const supported = new Set([
      "type",
      "properties",
      "required",
      "additionalProperties",
      "items",
      "enum",
      "const",
      "minimum",
      "maximum",
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
    ]);
    for (const keyword of Object.keys(node)) {
      if (!supported.has(keyword)) unsupported(keyword, path);
    }
    if (node.type !== undefined && !isSupportedType(node.type)) {
      unsupported("type", path);
    }
    if (
      node.required !== undefined &&
      (!Array.isArray(node.required) ||
        !node.required.every((entry) => typeof entry === "string"))
    ) {
      unsupported("required", path);
    }
    if (
      node.additionalProperties !== undefined &&
      typeof node.additionalProperties !== "boolean"
    ) {
      unsupported("additionalProperties", path);
    }
    if (
      node.enum !== undefined &&
      (!Array.isArray(node.enum) ||
        !node.enum.every(isJsonPrimitive))
    ) {
      unsupported("enum", path);
    }
    if (node.const !== undefined && !isJsonPrimitive(node.const)) {
      unsupported("const", path);
    }
    for (const keyword of ["minimum", "maximum"] as const) {
      if (
        node[keyword] !== undefined &&
        (typeof node[keyword] !== "number" ||
          !Number.isFinite(node[keyword]))
      ) {
        unsupported(keyword, path);
      }
    }
    for (const keyword of [
      "minLength",
      "maxLength",
      "minItems",
      "maxItems",
    ] as const) {
      if (
        node[keyword] !== undefined &&
        (!Number.isInteger(node[keyword]) || (node[keyword] as number) < 0)
      ) {
        unsupported(keyword, path);
      }
    }
    if (node.properties !== undefined) {
      if (!isRecord(node.properties)) unsupported("properties", path);
      for (const [key, child] of Object.entries(node.properties)) {
        if (!isRecord(child)) unsupported(`properties.${key}`, path);
        assertSupportedSchema(child, `${path}.properties.${key}`, seen);
      }
    }
    if (node.items !== undefined) {
      if (!isRecord(node.items)) unsupported("items", path);
      assertSupportedSchema(node.items, `${path}.items`, seen);
    }
    seen.delete(node);
  }
}

function sanitizeJsonSchema(
  schema: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(schema)
      .filter(
        ([key]) =>
          key !== "description" &&
          key !== "title" &&
          key !== "default" &&
          key !== "$schema"
      )
      .map(([key, value]) => {
        if (key === "properties" && isRecord(value)) {
          return [
            key,
            Object.fromEntries(
              Object.entries(value).map(([name, child]) => [
                name,
                isRecord(child) ? sanitizeJsonSchema(child) : child,
              ])
            ),
          ];
        }
        if (key === "items" && isRecord(value)) {
          return [key, sanitizeJsonSchema(value)];
        }
        return [key, value];
      })
  );
}

function validateSchemaValue(
  schema: Record<string, unknown>,
  value: unknown,
  path: PropertyKey[],
  issues: Array<{ message: string; path?: PropertyKey[] }>
): void {
  if (schema.const !== undefined && !Object.is(value, schema.const)) {
    issues.push({ message: "Value does not match const", path });
    return;
  }
  if (
    Array.isArray(schema.enum) &&
    !schema.enum.some((item) => Object.is(item, value))
  ) {
    issues.push({ message: "Value is not in enum", path });
    return;
  }
  const type = schema.type;
  if (type && !matchesType(type, value)) {
    issues.push({ message: `Expected ${String(type)}`, path });
    return;
  }
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength)
      issues.push({
        message: `Expected at least ${schema.minLength} characters`,
        path,
      });
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength)
      issues.push({
        message: `Expected at most ${schema.maxLength} characters`,
        path,
      });
  }
  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum)
      issues.push({ message: `Expected at least ${schema.minimum}`, path });
    if (typeof schema.maximum === "number" && value > schema.maximum)
      issues.push({ message: `Expected at most ${schema.maximum}`, path });
  }
  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems)
      issues.push({ message: `Expected at least ${schema.minItems} items`, path });
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems)
      issues.push({ message: `Expected at most ${schema.maxItems} items`, path });
    if (isRecord(schema.items)) {
      value.forEach((item, index) =>
        validateSchemaValue(
          schema.items as Record<string, unknown>,
          item,
          [...path, index],
          issues
        )
      );
    }
  }
  if (isRecord(value)) {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const name of required) {
      if (typeof name === "string" && !(name in value))
        issues.push({
          message: `Missing required property ${name}`,
          path: [...path, name],
        });
    }
    for (const [name, child] of Object.entries(properties)) {
      if (name in value && isRecord(child))
        validateSchemaValue(child, value[name], [...path, name], issues);
    }
    if (schema.additionalProperties === false) {
      for (const name of Object.keys(value)) {
        if (!(name in properties))
          issues.push({
            message: `Unexpected property ${name}`,
            path: [...path, name],
          });
      }
    }
  }
}

function validateEndpoint(options: McpToolImporterOptions): URL {
  const endpoint = new URL(options.endpoint);
  if (endpoint.username || endpoint.password) {
    throw new Error("MCP endpoint must not contain credentials");
  }
  const secure = endpoint.protocol === "https:";
  const insecureLoopback =
    endpoint.protocol === "http:" &&
    options.allowInsecureLoopback === true &&
    isLoopback(endpoint.hostname);
  if (!secure && !insecureLoopback) {
    throw new Error("MCP endpoint must use HTTPS (or explicit loopback HTTP)");
  }
  if (
    options.allowedOrigins &&
    !options.allowedOrigins.includes(endpoint.origin)
  ) {
    throw new Error(`MCP endpoint origin is not allowed: ${endpoint.origin}`);
  }
  return endpoint;
}

function isSelected(selection: McpToolSelection, tool: McpTool): boolean {
  return "allow" in selection
    ? selection.allow.includes(tool.name)
    : selection.select(tool);
}

function localToolName(serverId: string, remoteName: string): string {
  return `${slug(serverId)}.${slug(remoteName)}`;
}

function slug(value: string): string {
  const result = value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!result) throw new Error(`Cannot derive stable tool name from ${value}`);
  return result;
}

function credentialFreeEndpoint(endpoint: URL): string {
  const safe = new URL(endpoint);
  safe.username = "";
  safe.password = "";
  safe.search = "";
  safe.hash = "";
  return safe.toString();
}

function sanitizeMcpValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeMcpValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "_meta" && key !== "annotations")
      .map(([key, child]) => [key, sanitizeMcpValue(child)])
  );
}

function displayFromContent(content: unknown[]): Display | undefined {
  const text = content
    .filter(
      (item): item is { type: "text"; text: string } =>
        isRecord(item) && item.type === "text" && typeof item.text === "string"
    )
    .map((item) => item.text);
  return text.length > 0 ? text.join("\n") : undefined;
}

function mapRemoteError(error: unknown, signal: AbortSignal): ToolError {
  if (error instanceof ToolError) return error;
  if (signal.aborted || (error instanceof Error && error.name === "AbortError")) {
    return new ToolError("REMOTE_CANCELLED", "Remote MCP call was cancelled");
  }
  if (
    error instanceof Error &&
    (/timeout/i.test(error.message) || error.name === "TimeoutError")
  ) {
    return new ToolError("REMOTE_TIMEOUT", "Remote MCP call timed out");
  }
  return new ToolError(
    "REMOTE_TRANSPORT_ERROR",
    "Remote MCP transport failed",
    error instanceof Error
      ? { name: error.name, message: error.message }
      : undefined
  );
}

function asCallResult(value: unknown): RemoteCallResult {
  if (!isRecord(value) || !Array.isArray(value.content)) {
    throw new ToolError(
      "REMOTE_PROTOCOL_ERROR",
      "Remote MCP returned an invalid tool result"
    );
  }
  return value as RemoteCallResult;
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requireClient(
  client: McpImporterConnection | undefined,
  closed: boolean
): McpImporterConnection {
  if (!client) {
    throw new Error(
      closed ? "MCP importer is closed" : "MCP importer is not connected"
    );
  }
  return client;
}

function isSupportedType(value: unknown): boolean {
  const supported = new Set([
    "object",
    "array",
    "string",
    "number",
    "integer",
    "boolean",
    "null",
  ]);
  return typeof value === "string"
    ? supported.has(value)
    : Array.isArray(value) &&
        value.every(
          (entry) => typeof entry === "string" && supported.has(entry)
        );
}

function isJsonPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

function matchesType(type: unknown, value: unknown): boolean {
  if (Array.isArray(type)) {
    return type.some((entry) => matchesType(entry, value));
  }
  switch (type) {
    case "object":
      return isRecord(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "::1" || /^127\./.test(hostname);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
