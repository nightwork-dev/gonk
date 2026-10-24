import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const workspace = join(root, "python");
const temporary = await mkdtemp(join(tmpdir(), "gonk-python-wheels-"));
function run(command, args, cwd = temporary, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed`);
}

try {
  const output = join(temporary, "wheels");
  run("uv", ["build", "--all-packages", "--out-dir", output], workspace);
  const wheels = (await readdir(output)).filter((name) => name.endsWith(".whl"));
  assert.equal(wheels.length, 3);
  const requirements = join(temporary, "requirements.txt");
  run("uv", ["export", "--locked", "--all-packages", "--all-extras", "--no-dev",
    "--no-emit-workspace", "--no-hashes", "--output-file", requirements], workspace);
  const environment = join(temporary, "venv");
  run("uv", ["venv", "--python", "3.12", environment]);
  const python = join(environment, "bin", "python");
  run("uv", ["pip", "install", "--python", python, "--requirements", requirements,
    ...wheels.map((name) => join(output, name))]);
  run(python, ["-I", "-c", `
from pathlib import Path
import gonk.auth, gonk.tool_registry, gonk.mcp
for module in (gonk.auth, gonk.tool_registry, gonk.mcp):
    location = Path(module.__file__).resolve()
    assert "site-packages" in location.parts, location
    assert location.parent.joinpath("py.typed").is_file(), location
print("All three Python distributions imported from installed wheels.")
`]);
  run(process.execPath, [join(root, "scripts/python-mcp-smoke.mjs")], temporary, {
    ...process.env, GONK_PYTHON: python,
  });
} finally {
  await rm(temporary, { recursive: true, force: true });
}
