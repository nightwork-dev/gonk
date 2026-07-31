import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveClaudeHookSpecPath } from "../src/spec-path.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function createPluginRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "gonk-claude-hook-spec-"));
  roots.push(root);
  mkdirSync(join(root, "dist"));
  return root;
}

describe("resolveClaudeHookSpecPath", () => {
  it("prefers an ESM hook runtime when both module formats exist", () => {
    const root = createPluginRoot();
    writeFileSync(join(root, "dist", "hook-spec.cjs"), "module.exports = {};\n");
    writeFileSync(join(root, "dist", "hook-spec.mjs"), "export default {};\n");

    expect(resolveClaudeHookSpecPath(root)).toBe(join(root, "dist", "hook-spec.mjs"));
  });

  it("falls back to the legacy CommonJS hook runtime", () => {
    const root = createPluginRoot();
    writeFileSync(join(root, "dist", "hook-spec.cjs"), "module.exports = {};\n");

    expect(resolveClaudeHookSpecPath(root)).toBe(join(root, "dist", "hook-spec.cjs"));
  });
});
