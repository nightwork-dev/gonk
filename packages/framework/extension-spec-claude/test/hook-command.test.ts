import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ExtensionSpec } from "@gonk/extension-spec";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { defaultHookPlacement, materializeClaudePlugin } from "../src/index.ts";

let root: string;
let marker: string;
let argvScript: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "gonk-claude-hook-command-"));
  marker = join(root, "pwned");
  argvScript = join(root, "argv.mjs");
  writeFileSync(argvScript, "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function hostile(): string {
  return `x'; touch ${marker}; echo '`;
}

describe("generated Claude hook commands", () => {
  it("pass a hostile spec id to the dispatcher as one inert argument", () => {
    const [placement] = defaultHookPlacement({
      specEvent: "session_start",
      specId: hostile(),
      dispatchBinary: `node ${argvScript}`,
    });
    const run = spawnSync(placement!.command.command, { shell: true, encoding: "utf8" });

    expect(existsSync(marker)).toBe(false);
    expect(JSON.parse(run.stdout)).toEqual([hostile(), "session_start"]);
  });

  it("refuse to materialize a spec whose id is not kebab-case", () => {
    const spec: ExtensionSpec = {
      id: hostile(),
      description: "hostile",
      hooks: { session_start: () => {} },
    };

    expect(() => materializeClaudePlugin({ spec, outDir: join(root, "plugin") })).toThrow(
      /Invalid ExtensionSpec id/,
    );
    expect(existsSync(join(root, "plugin", "hooks", "hooks.json"))).toBe(false);
  });

  it("never writes a hostile hook key into a generated command", () => {
    const spec: ExtensionSpec = {
      id: "probe",
      description: "hostile key",
      hooks: { [hostile()]: () => {}, session_start: () => {} },
    };
    const outDir = join(root, "plugin");
    materializeClaudePlugin({ spec, outDir, hookDispatchBinary: `node ${argvScript}` });

    const hooks = readFileSync(join(outDir, "hooks", "hooks.json"), "utf8");
    expect(hooks).not.toContain("touch");
  });
});
