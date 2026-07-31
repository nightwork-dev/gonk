import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const checker = new URL("./check-public-docs.mjs", import.meta.url);

function runCheck(files) {
  const root = mkdtempSync(join(tmpdir(), "gonk-public-docs-"));
  try {
    spawnSync("git", ["init", "-q"], { cwd: root });
    for (const [file, contents] of Object.entries(files)) {
      const absolute = join(root, file);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, contents);
    }
    spawnSync("git", ["add", "."], { cwd: root });
    return spawnSync(process.execPath, [checker.pathname], {
      cwd: root,
      encoding: "utf8",
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts existing angle-wrapped links and placeholder home paths", () => {
  const result = runCheck({
    "README.md": [
      "[spaced](<docs/exists here.md>)",
      "[external](https://example.com)",
      "`/Users/example/project/file.md`",
    ].join("\n"),
    "docs/exists here.md": "# Present\n",
  });

  assert.equal(result.status, 0, result.stderr);
});

for (const [name, markdown, expected] of [
  ["ordinary missing link", "[missing](docs/missing.md)", "broken local link"],
  ["angle-wrapped missing link", "[missing](<docs/missing here.md>)", "broken local link"],
  ["macOS home path", "`/Users/private-user/project/file.md`", "machine-specific macOS home path"],
  ["development shortcut", "`~/Dev/project/file.md`", "machine-specific development shortcut"],
  ["private workspace document", "`docs.local/private.md`", "private workspace-document reference"],
]) {
  test(`rejects ${name}`, () => {
    const result = runCheck({ "README.md": markdown });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(expected));
  });
}
