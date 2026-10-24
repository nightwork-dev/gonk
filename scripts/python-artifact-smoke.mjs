#!/usr/bin/env node
// Optional two-repository proof. Paths select built artifacts, never runtime dependencies.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const [python, mirkRoot] = process.argv.slice(2);
if (!python || !mirkRoot) {
  throw new Error("Usage: node scripts/python-artifact-smoke.mjs PYTHON MIRK_CHECKOUT");
}
const origins = spawnSync(resolve(python), ["-I", "-c", `
from pathlib import Path
import gonk.auth, gonk.tool_registry, gonk.mcp, mirk.store, mirk.artifact
for module in (gonk.auth, gonk.tool_registry, gonk.mcp, mirk.store, mirk.artifact):
    path = Path(module.__file__).resolve()
    assert "site-packages" in path.parts, (module.__name__, path)
`], { encoding: "utf8" });
assert.equal(origins.status, 0, origins.stderr || "Python packages must be installed from wheels");
const require = createRequire(new URL("../packages/adapters/tool-registry-mcp/package.json", import.meta.url));
const { Client } = require("@modelcontextprotocol/client");
const { StdioClientTransport } = require("@modelcontextprotocol/client/stdio");
const { ownerPrincipal } = await import("../packages/core/auth/dist/index.js");
const { ToolRegistry, makeBaseContext, collectToolOutcome } = await import("../packages/core/tool-registry/dist/index.js");
const { createMcpToolImporter } = await import("../packages/adapters/tool-registry-mcp/dist/client.js");
const fromMirk = (file) => import(pathToFileURL(resolve(mirkRoot, file)).href);
const { SqliteAdapter } = await fromMirk("packages/store/dist/adapters/sqlite.js");
const { toAsync } = await fromMirk("packages/store/dist/kv.js");
const { ArtifactCoordinator } = await fromMirk("packages/artifact/dist/index.js");
const { StoreArtifactRepository } = await fromMirk("packages/artifact/dist/store.js");
const { FileObjectStore } = await fromMirk("packages/artifact/dist/fs.js");
const root = await mkdtemp(join(tmpdir(), "gonk-mirk-python-"));
const script = new URL("../python/examples/artifact_documents.py", import.meta.url);
const auth = ownerPrincipal({ USER: "interop-test", HOSTNAME: "local" });
const text = "A portable document: café, \u{1f331}.";
let descriptor;

async function withServer(work) {
  const client = new Client({ name: "artifact-proof", version: "0.1.0" });
  const transport = new StdioClientTransport({
    command: resolve(python), args: ["-I", fileURLToPath(script), root], stderr: "pipe",
  });
  const registry = new ToolRegistry({ security: { approvalMode: "bypass" } });
  const importer = createMcpToolImporter({
    registry, serverId: "python", endpoint: "https://python.invalid/mcp",
    selection: { allow: ["document.create", "document.read"] },
    authorization: { requiredRole: "owner" },
    connectionFactory: async () => ({
      listTools: (params, options) => client.listTools(params, options),
      callTool: (params, options) => client.callTool(params, options),
      close: () => client.close(),
    }),
  });
  try {
    await client.connect(transport);
    await importer.connect();
    const invoke = async (name, input) => {
      const outcome = await collectToolOutcome(registry.invoke(name, input, makeBaseContext({ auth })));
      assert.equal(outcome.ok, true, JSON.stringify(outcome));
      return outcome.data.structuredContent;
    };
    return await work(invoke);
  } finally {
    await importer.close();
    await client.close();
    await transport.close();
  }
}

try {
  await withServer(async (invoke) => {
    const created = await invoke("python.document-create", { text, requestKey: "request-1" });
    descriptor = created.artifact;
    assert.equal(descriptor.mediaType, "text/plain");
    const replayed = await invoke("python.document-create", { text, requestKey: "request-1" });
    assert.deepEqual(replayed.artifact, descriptor);
    assert.equal((await invoke("python.document-read", { id: descriptor.id })).text, text);
  });
  await withServer(async (invoke) => {
    const reopened = await invoke("python.document-read", { id: descriptor.id });
    assert.deepEqual(reopened.artifact, descriptor);
    assert.equal(reopened.text, text);
  });
  const db = new SqliteAdapter({ path: join(root, "metadata.sqlite") });
  try {
    const artifacts = new ArtifactCoordinator(
      new FileObjectStore({ root: join(root, "objects") }),
      new StoreArtifactRepository(toAsync(db.kv), { namespace: "documents" }),
      { namespace: "documents", concurrency: { mode: "repository-atomic" } },
    );
    const verification = await artifacts.verify(descriptor.id);
    assert.equal(verification.ok, true);
    const read = await artifacts.read(descriptor.id);
    assert.deepEqual(read.artifact, descriptor);
    const chunks = [];
    for await (const chunk of read.bytes) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString("utf8"), text);
    console.log(JSON.stringify({ ok: true, artifact: descriptor.id, reopenedProcess: true, verifiedByTypeScript: true }));
  } finally {
    db.close();
  }
} finally {
  await rm(root, { recursive: true, force: true });
}
