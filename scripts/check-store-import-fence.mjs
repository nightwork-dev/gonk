#!/usr/bin/env node
// GS-00: freeze the compatibility surface while consumers migrate to the
// caller-provided Mirk state binding. This is intentionally source-based: dist
// and tests can describe migration history without authorizing new production
// dependencies.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(SCRIPT_DIR, "..");

export const LEGACY_EXPORTS = Object.freeze([
  "createStore",
  "resolveStoreDir",
  "StoreBackend",
  "BackendFactory",
  "CreateStoreOptions",
  "FsStoreBackend",
  "MirkStoreBackend",
  "mirkBackendFactory",
  "BackedKvStore",
  "BackedBlobStore",
  "BackedLogStore",
  "BackedVectorStore",
  "VectorStore",
  "VectorEntry",
  "VectorFilter",
  "VectorMatch",
  "cosineSimilarity",
  "tailLog",
  "FoldStore",
  "compact",
  "StoreProvider",
  "createStoreProvider",
]);

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);

function isProductionSource(path) {
  const normalized = path.split("\\").join("/");
  if (!/(^|\/)packages\/.*\/src\//.test(normalized)) return false;
  if (/(^|\/)(test|tests|fixtures|__tests__|archive|archives|evidence|dist|node_modules)(\/|$)/i.test(normalized)) return false;
  return SOURCE_EXTENSIONS.has(normalized.slice(normalized.lastIndexOf(".")));
}

function sourceFiles(root) {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "dist", ".git"].includes(entry.name)) continue;
        walk(path);
      } else if (entry.isFile() && isProductionSource(relative(root, path))) {
        out.push(path);
      }
    }
  };
  walk(join(root, "packages"));
  return out.sort();
}

function importedNames(text) {
  const names = new Set();
  const pattern = /(?:import|export)\s+([\s\S]*?)\s+from\s*["'](@gonk\/store(?:\/[^"']*)?)["']/g;
  for (const match of text.matchAll(pattern)) {
    const clause = match[1] ?? "";
    if (/\*/.test(clause)) {
      for (const legacy of LEGACY_EXPORTS) names.add(legacy);
      continue;
    }
    const braces = clause.match(/\{([\s\S]*?)\}/);
    if (!braces) continue;
    for (const item of braces[1].split(",")) {
      const name = item.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

/** Return every production import of a deprecated store export. */
export function scanStoreImportFence({ repoRoot = REPO_ROOT } = {}) {
  const root = resolve(repoRoot);
  const failures = [];
  for (const file of sourceFiles(root)) {
    const relativeFile = relative(root, file).split("\\").join("/");
    const text = readFileSync(file, "utf8");
    for (const name of importedNames(text)) {
      if (!LEGACY_EXPORTS.includes(name)) continue;
      failures.push({ file: relativeFile, name });
    }
  }
  return failures;
}

export function runStoreImportFence(options = {}) {
  const failures = scanStoreImportFence(options);
  return { failures, ok: failures.length === 0 };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { failures } = runStoreImportFence();
  if (failures.length > 0) {
    process.stderr.write(
      `Store import fence failed (legacy imports are frozen for this migration release):\n${failures
        .map(({ file, name }) => `${file}: ${name}`)
        .join("\n")}\n`,
    );
    process.exit(1);
  }
  process.stdout.write("Store import fence passed (no new production legacy imports).\n");
}
