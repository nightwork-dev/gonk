import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { currentDevMcpEnvironment, useDevMcpEnvironment, validateDevMcpConfig, writeDevMcpConfig } from "../src/dev/config.ts";

const directories: string[] = [];

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

async function configPath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "gonk-dev-config-"));
  directories.push(directory);
  return join(directory, "config.json");
}

describe("dev MCP configuration", () => {
  it("keeps code and database targets explicit while switching the active environment", async () => {
    const path = await configPath();
    await writeDevMcpConfig({
      version: 1,
      active: "main",
      environments: [
        { id: "main", repo: "/repo/main", branch: "main", endpoint: "http://127.0.0.1:4173/mcp", database: "/data/canonical.db" },
        { id: "review", repo: "/repo/review", branch: "feat/review", endpoint: "http://127.0.0.1:4179/mcp", database: "/tmp/review.db" },
      ],
    }, path);

    expect((await currentDevMcpEnvironment(path)).database).toBe("/data/canonical.db");
    const selected = await useDevMcpEnvironment("review", path);
    expect(selected.branch).toBe("feat/review");
    expect((await currentDevMcpEnvironment(path)).database).toBe("/tmp/review.db");
  });

  it("rejects a manifest whose active target does not exist", () => {
    expect(() => validateDevMcpConfig({ version: 1, active: "missing", environments: [] })).toThrow(/does not exist/);
  });
});
