import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  CONTRACTS_MANIFEST,
  REPO_ROOT,
  runClientSafeContractsCheck,
} from "./check-client-safe-contracts.mjs";

test("the real client-safe contracts manifest compiles clean against a browser-lib tsconfig", () => {
  const { result } = runClientSafeContractsCheck();
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("CONTRACTS_MANIFEST names every entry the story requires", () => {
  const names = CONTRACTS_MANIFEST.map((entry) => entry.pkg).sort();
  assert.deepEqual(names, ["@gonk/auth", "@gonk/context", "@gonk/tool-registry"]);
});

// The negative case: prove the check FAILS the moment a Node built-in shows
// up in a client-safe path — not by asserting a hardcoded error string, but
// by actually running the checker against a fixture that reproduces the
// regression. This is a regression test for the checker itself: if the
// checker's isolation (types: [], no @types/node) ever weakens, this test
// starts failing instead of the guard silently going quiet.
test("fails when a contracts file imports a Node built-in", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "gonk-client-safe-fixture-"));
  try {
    const srcDir = join(fixtureRoot, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "contracts.ts"),
      [
        'import { createHash } from "node:crypto";',
        "",
        "export function hashId(id: string): string {",
        '  return createHash("sha256").update(id).digest("hex");',
        "}",
        "",
      ].join("\n")
    );

    const { result } = runClientSafeContractsCheck({
      repoRoot: fixtureRoot,
      manifest: [
        {
          pkg: "@fixture/poisoned",
          subpath: "./contracts",
          file: "src/contracts.ts",
        },
      ],
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /node:crypto/);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("passes when a contracts file is genuinely Node-free (control for the negative case)", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "gonk-client-safe-fixture-"));
  try {
    const srcDir = join(fixtureRoot, "src");
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(
      join(srcDir, "contracts.ts"),
      [
        "export interface Widget {",
        "  id: string;",
        "  label: string;",
        "}",
        "",
        "export function isWidget(value: unknown): value is Widget {",
        "  return (",
        '    !!value && typeof value === "object" &&',
        '    typeof (value as Widget).id === "string" &&',
        '    typeof (value as Widget).label === "string"',
        "  );",
        "}",
        "",
      ].join("\n")
    );

    const { result } = runClientSafeContractsCheck({
      repoRoot: fixtureRoot,
      manifest: [
        {
          pkg: "@fixture/clean",
          subpath: "./contracts",
          file: "src/contracts.ts",
        },
      ],
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("REPO_ROOT resolves to the actual repository root (sanity check for the manifest paths)", () => {
  assert.ok(dirname(REPO_ROOT).length > 0);
  const { result } = runClientSafeContractsCheck({
    manifest: [CONTRACTS_MANIFEST[0]],
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
