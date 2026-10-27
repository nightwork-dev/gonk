import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

for (const member of ["auth", "tool-registry", "mcp"]) {
  const cwd = fileURLToPath(new URL(`../python/${member}/`, import.meta.url));
  for (const command of [["pytest", "-q"], ["pyright"], ["ruff", "check", "."]]) {
    const result = spawnSync("uv", ["run", "--locked", "--all-packages", "--all-extras", ...command], {
      cwd, stdio: "inherit",
    });
    if (result.error) throw result.error;
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}
