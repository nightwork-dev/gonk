import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { runStoreImportFence } from "./check-store-import-fence.mjs";

function fixture(files) {
  const root = mkdtempSync(join(process.env.TMPDIR ?? "/tmp", "gonk-store-fence-"));
  const packages = join(root, "packages");
  mkdirSync(packages, { recursive: true });
  for (const [path, contents] of Object.entries(files)) {
    const target = join(root, path);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

test("ignores test fixtures and accepts current non-legacy imports", () => {
  const root = fixture({
    "packages/core/retrieval/test/fixture.ts": 'import { createStore } from "@gonk/store";\n',
    "packages/core/retrieval/src/types.ts": 'import type { GonkSyncState } from "@gonk/store";\n',
  });
  try {
    assert.deepEqual(runStoreImportFence({ repoRoot: root }).failures, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails a new production import of a deprecated export", () => {
  const root = fixture({
    "packages/core/jobs/src/state.ts": 'import { createStore, FsStoreBackend } from "@gonk/store";\n',
  });
  try {
    const result = runStoreImportFence({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.deepEqual(result.failures, [
      { file: "packages/core/jobs/src/state.ts", name: "createStore" },
      { file: "packages/core/jobs/src/state.ts", name: "FsStoreBackend" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails namespace imports because their legacy dependency cannot be proven safe", () => {
  const root = fixture({
    "packages/core/jobs/src/state.ts": 'import * as store from "@gonk/store";\n',
  });
  try {
    const result = runStoreImportFence({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 22);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails CommonJS require of the package because the selected exports cannot be proven safe", () => {
  const root = fixture({
    "packages/core/jobs/src/state.cjs": 'const store = require("@gonk/store");\n',
  });
  try {
    const result = runStoreImportFence({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 22);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails destructured CommonJS require of a deprecated export", () => {
  const root = fixture({
    "packages/core/jobs/src/state.cts": 'const { createStore } = require("@gonk/store");\n',
  });
  try {
    assert.deepEqual(runStoreImportFence({ repoRoot: root }).failures, [
      { file: "packages/core/jobs/src/state.cts", name: "createStore" },
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("fails dynamic import of the package because the selected exports cannot be proven safe", () => {
  const root = fixture({
    "packages/core/jobs/src/state.ts": 'const store = await import("@gonk/store");\n',
  });
  try {
    const result = runStoreImportFence({ repoRoot: root });
    assert.equal(result.ok, false);
    assert.equal(result.failures.length, 22);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
