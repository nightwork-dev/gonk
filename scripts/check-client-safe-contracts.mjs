#!/usr/bin/env node
// =============================================================================
// GR-84 part (b): operationalize "client-safe" as a CI compile check.
//
// A "client-safe contracts subpath" is a package's `./contracts` export:
// types and pure functions only, importable from a browser/UI bundle with
// zero Node built-ins in the resolved module graph. This script compiles an
// import of each subpath's SOURCE file (not the built dist — see below)
// against an isolated tsconfig with `types: []` and no `@types/node`
// available, so a `node:*` import anywhere in that file's dependency chain
// fails resolution immediately.
//
// Why SOURCE and not dist: a Node import used only internally (never
// referenced by an exported type's signature) is invisible in a built
// `.d.ts` — tsup's declaration bundler only emits what the public types
// actually reference. Checking the built output would silently miss exactly
// the regression this gate exists to catch (an added `node:crypto` import
// whose return value never appears in an exported signature). Checking
// source closes that gap: TypeScript must resolve every top-level import in
// the file to type-check it at all, regardless of what's re-exported.
//
// Cross-package composition (e.g. @gonk/tool-registry/contracts re-exporting
// receipt types from "@gonk/auth/contracts") resolves through the normal
// pnpm workspace symlink to @gonk/auth's BUILT dist — that's fine and
// expected: @gonk/auth's own manifest entry independently source-checks its
// contracts chain, so a regression there is caught at its origin, not
// silently swallowed by the cross-package hop.
// =============================================================================

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = join(__dirname, "..");

/** Every package's client-safe contracts subpath this gate guards. Bounded
 *  per GR-84: only the packages a UI consumer names today. Add an entry
 *  here in the same change that ships a new `./contracts` subpath. */
export const CONTRACTS_MANIFEST = [
  {
    pkg: "@gonk/auth",
    subpath: "./contracts",
    file: "packages/core/auth/src/contracts.ts",
  },
  {
    pkg: "@gonk/tool-registry",
    subpath: "./contracts",
    file: "packages/core/tool-registry/src/contracts.ts",
  },
  {
    pkg: "@gonk/context",
    subpath: "./contracts",
    file: "packages/core/context/src/contracts.ts",
  },
];

function toPosix(path) {
  return path.split("\\").join("/");
}

/** Build an isolated fixture (tsconfig + one entry file per manifest entry)
 *  and run `tsc --noEmit` against it. Returns the raw spawn result plus the
 *  manifest actually used, so callers can report which subpath(s) failed. */
export function runClientSafeContractsCheck({
  manifest = CONTRACTS_MANIFEST,
  repoRoot = REPO_ROOT,
} = {}) {
  const workdir = mkdtempSync(join(tmpdir(), "gonk-client-safe-"));
  try {
    const entryFiles = manifest.map((entry, index) => {
      const entryPath = join(workdir, `entry-${index}.ts`);
      const target = toPosix(join(repoRoot, entry.file));
      writeFileSync(
        entryPath,
        [
          `// Browser-lib compile check for ${entry.pkg}${entry.subpath}`,
          `import * as contract from ${JSON.stringify(target)};`,
          `export type Contract = typeof contract;`,
          "",
        ].join("\n")
      );
      return toPosix(entryPath);
    });

    const tsconfigPath = join(workdir, "tsconfig.json");
    writeFileSync(
      tsconfigPath,
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            lib: ["ES2022", "DOM"],
            types: [],
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            isolatedModules: true,
            verbatimModuleSyntax: true,
            // Matches every package's own tsconfig (see
            // packages/core/auth/tsconfig.json) — the repo imports relative
            // modules with an explicit ".ts" extension throughout.
            allowImportingTsExtensions: true,
          },
          include: entryFiles,
        },
        null,
        2
      )
    );

    const result = spawnSync(
      "npx",
      ["tsc", "--noEmit", "-p", toPosix(tsconfigPath)],
      { cwd: repoRoot, encoding: "utf8" }
    );
    return { manifest, result };
  } finally {
    rmSync(workdir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { manifest, result } = runClientSafeContractsCheck();
  const names = manifest.map((entry) => `${entry.pkg}${entry.subpath}`).join(", ");
  if (result.status !== 0) {
    process.stderr.write(`Client-safe contracts check FAILED for: ${names}\n\n`);
    process.stderr.write(result.stdout ?? "");
    process.stderr.write(result.stderr ?? "");
    process.exit(result.status ?? 1);
  }
  process.stdout.write(
    `Client-safe contracts check passed (${manifest.length} subpaths, browser-lib tsconfig, no Node builtins): ${names}\n`
  );
}
