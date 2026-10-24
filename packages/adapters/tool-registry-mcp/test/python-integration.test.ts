import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ownerPrincipal, type AuthContext } from "@gonk/auth";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";
import {
  collectToolOutcome,
  makeBaseContext,
  ToolRegistry,
  type ToolRegistryOptions,
} from "@gonk/tool-registry";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMcpToolImporter,
  type McpImporterConnection,
} from "../src/client.ts";

const ROOT = new URL("../../../..", import.meta.url);
const PYTHON = new URL("python/mcp/tests/stdio_server.py", ROOT);
const PYTHON_ROOT = new URL("python/", ROOT);
const PYTHON_BIN = process.env.GONK_PYTHON ?? new URL("python/.venv/bin/python", ROOT).pathname;
const PYTHONPATH = [
  new URL("auth/src", PYTHON_ROOT).pathname,
  new URL("tool-registry/src", PYTHON_ROOT).pathname,
  new URL("mcp/src", PYTHON_ROOT).pathname,
].join(delimiter);

const OWNER_AUTH: AuthContext = ownerPrincipal({
  USER: "typescript-importer-test",
  HOSTNAME: "local",
});
const importedServerId = "python-local";

function ownerRegistry(opts: ToolRegistryOptions = {}): ToolRegistry {
  return new ToolRegistry({
    ...opts,
    security: { approvalMode: "bypass", ...opts.security },
  });
}

function ownerCtx(
  overrides: Partial<Omit<Parameters<typeof makeBaseContext>[0], "auth">> = {},
) {
  return makeBaseContext({ ...overrides, auth: OWNER_AUTH });
}

async function pythonConnection(deny = false): Promise<McpImporterConnection> {
  const transport = new StdioClientTransport({
    command: PYTHON_BIN,
    args: [PYTHON.pathname],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (entry): entry is [string, string] => entry[1] !== undefined,
        ),
      ),
      PYTHONPATH,
      ...(deny ? { GONK_TEST_DENY: "1" } : {}),
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "gonk-ts-importer-test", version: "0.1.0" });
  await client.connect(transport);
  return {
    listTools: async (params, options) => {
      const page = await client.listTools(params, options);
      return {
        tools: page.tools,
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      };
    },
    callTool: (params, options) => client.callTool(params, options),
    close: () => client.close(),
  };
}

function importer(
  registry: ToolRegistry,
  connectionFactory: () => Promise<McpImporterConnection>,
) {
  return createMcpToolImporter({
    registry,
    serverId: importedServerId,
    // This is explicit local metadata for the custom stdio factory. The
    // importer still requires a credential-free HTTPS-shaped provenance URL.
    endpoint: "https://local.python.invalid/mcp",
    selection: {
      allow: ["write-result", "progress-result", "long-result", "unicode-echo"],
    },
    authorization: { requiredRole: "operator" },
    connectionFactory: async () => connectionFactory(),
  });
}

async function invoke(registry: ToolRegistry, name: string, input: unknown) {
  return collectToolOutcome(registry.invoke(name, input, ownerCtx()));
}

describe("Python MCP stdio importer", () => {
  const importers: Array<{ close(): Promise<void> }> = [];

  afterEach(async () => {
    for (const active of importers.splice(0)) await active.close().catch(() => {});
  });

  it("discovers and invokes a real Python registry tool through the SDK transport", async () => {
    const registry = ownerRegistry();
    const inbound = importer(registry, () => pythonConnection());
    importers.push(inbound);
    await inbound.connect();

    expect(registry.list().map((tool) => tool.name)).toEqual([
      "python-local.write-result",
      "python-local.progress-result",
      "python-local.long-result",
      "python-local.unicode-echo",
    ]);
    const tempDir = await mkdtemp(join(tmpdir(), "gonk-ts-python-importer-"));
    try {
      const target = join(tempDir, "result.txt");
      const success = await invoke(registry, "python-local.write-result", {
        path: target,
        text: "typescript importer",
      });
      expect(success).toMatchObject({
        ok: true,
        data: { structuredContent: { path: target } },
      });
      expect(await readFile(target, "utf8")).toBe("typescript importer");

      const invalid = await invoke(registry, "python-local.write-result", {
        path: join(tempDir, "missing-text"),
      });
      expect(invalid).toMatchObject({ ok: false, code: "INVALID_INPUT" });

      const unicodeInvalid = await invoke(registry, "python-local.unicode-echo", {
        text: "🌱",
      });
      expect(unicodeInvalid).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      const unicodeValid = await invoke(registry, "python-local.unicode-echo", {
        text: "ab",
      });
      expect(unicodeValid).toMatchObject({ ok: true });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("preserves authorization at the Python host boundary", async () => {
    const registry = ownerRegistry();
    const inbound = importer(registry, () => pythonConnection(true));
    importers.push(inbound);
    await inbound.connect();
    expect(registry.list()).toHaveLength(0);
  });

  it("cancels a long Python call and observes file cleanup", async () => {
    const registry = ownerRegistry();
    const inbound = importer(registry, () => pythonConnection());
    importers.push(inbound);
    await inbound.connect();
    const tempDir = await mkdtemp(join(tmpdir(), "gonk-ts-python-importer-"));
    try {
      const marker = join(tempDir, "operation");
      const controller = new AbortController();
      const pending = collectToolOutcome(
        registry.invoke(
          "python-local.long-result",
          { path: marker, text: "unused" },
          ownerCtx({ signal: controller.signal }),
        ),
      );
      await waitForFile(`${marker}.started`);
      controller.abort();
      await expect(pending).resolves.toMatchObject({ ok: false, code: "ABORTED" });
      await waitForFile(`${marker}.cleaned`);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      await import("node:fs/promises").then((fs) => fs.access(path));
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}`);
}
