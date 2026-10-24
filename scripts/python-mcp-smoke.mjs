#!/usr/bin/env node

/**
 * Small real-process proof for the native Python MCP adapter. It uses the
 * official TypeScript Client + StdioClientTransport and the Gonk importer
 * connectionFactory; no raw JSON-RPC is involved.
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(
  new URL("../packages/adapters/tool-registry-mcp/package.json", import.meta.url),
);
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");
const { ownerPrincipal } = await import(new URL("../packages/core/auth/dist/index.js", import.meta.url));
const { collectToolOutcome, makeBaseContext, ToolRegistry } = await import(
  new URL("../packages/core/tool-registry/dist/index.js", import.meta.url),
);
const { createMcpToolImporter } = await import(
  new URL("../packages/adapters/tool-registry-mcp/dist/client.js", import.meta.url),
);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pythonRoot = path.join(root, "python");
const fixture = path.join(pythonRoot, "mcp/tests/stdio_server.py");
const explicitPython = process.env.GONK_PYTHON;
const python = explicitPython ?? path.join(pythonRoot, ".venv/bin/python");
const pythonArgs = explicitPython ? ["-I", fixture] : [fixture];
const explicitEnvironment = explicitPython
  ? Object.fromEntries(
      Object.entries(process.env).filter(
        (entry) => entry[0] !== "PYTHONPATH" && entry[1] !== undefined,
      ),
    )
  : undefined;
const auth = ownerPrincipal({ USER: "python-mcp-smoke", HOSTNAME: "local" });
const smokeDir = await mkdtemp(path.join(os.tmpdir(), "gonk-python-mcp-smoke-"));
const resultPath = path.join(smokeDir, "result.txt");
const resultText = "python mcp smoke passed";

const transport = new StdioClientTransport({
  command: python,
  args: pythonArgs,
  ...(explicitEnvironment === undefined ? {} : { env: explicitEnvironment }),
  stderr: "pipe",
});
const client = new Client({ name: "gonk-python-smoke", version: "0.1.0" });
const registry = new ToolRegistry({ security: { approvalMode: "bypass" } });
let importer;

try {
  await client.connect(transport);
  importer = createMcpToolImporter({
    registry,
    serverId: "python-local",
    endpoint: "https://local.python.invalid/mcp",
    selection: { allow: ["write-result", "progress-result"] },
    authorization: { requiredRole: "operator" },
    connectionFactory: async () => ({
      listTools: async (params, options) => {
        const page = await client.listTools(params, options);
        return {
          tools: page.tools,
          ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
        };
      },
      callTool: (params, options) => client.callTool(params, options),
      close: () => client.close(),
    }),
  });
  await importer.connect();
  const tools = registry.list().map((tool) => tool.name);
  const result = await collectToolOutcome(
    registry.invoke(
      "python-local.write-result",
      { path: resultPath, text: resultText },
      makeBaseContext({ auth }),
    ),
  );
  if (!result.ok) throw new Error(`Python MCP smoke call failed: ${result.code}`);
  const content = await readFile(resultPath, "utf8");
  if (content !== resultText) {
    throw new Error(`Python MCP smoke wrote unexpected content: ${JSON.stringify(content)}`);
  }
  console.log(JSON.stringify({ tools, result: result.ok, resultPath }));
} finally {
  await importer?.close().catch(() => {});
  await client.close().catch(() => {});
  await rm(smokeDir, { recursive: true, force: true }).catch(() => {});
}
