import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

describe("serveMcpStdio", () => {
  it.each(["legacy", "auto"] as const)("serves registry guidance and tools over %s stdio", async (mode) => {
    const instructions = "Run ping_tool to check whether this connection is live.";
    const manifest = "---\nname: check-connection\ndescription: Check the connection.\n---\nRun ping_tool.\n";
    const root = await mkdtemp(join(tmpdir(), "gonk-skills-stdio-"));
    await mkdir(join(root, "check-connection"));
    await writeFile(join(root, "check-connection", "SKILL.md"), manifest);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--experimental-transform-types", "--input-type=module", "--eval", `
        import { ownerPrincipal } from "@gonk/auth";
        import { createBundledSkillToolDefinitions } from "@gonk/skills/bundled";
        import { loadMcpBundledSkills } from "./src/index.ts";
        import { passthrough, ToolRegistry } from "@gonk/tool-registry";
        import { serveMcpStdio } from "./src/stdio.ts";

        const source = new ToolRegistry({ instructions: ${JSON.stringify(instructions)} });
        source.register({
          name: "ping_tool",
          description: "Check the connection.",
          approval: "read",
          input: passthrough(),
          handler: async () => ({ data: true }),
        });

        const bundledSkills = await loadMcpBundledSkills({
          root: ${JSON.stringify(root)},
          createTools: createBundledSkillToolDefinitions,
        });
        source.register(bundledSkills.tools);
        serveMcpStdio({
          source, bundledSkills, serverName: "stdio-test", serverVersion: "1",
          makeAuthContext: () => ownerPrincipal({ USER: "stdio-test" }),
        });
      `],
      stderr: "ignore",
    });
    const client = new Client(
      { name: "stdio-test", version: "1" },
      { versionNegotiation: { mode } }
    );
    try {
      await client.connect(transport);
      expect(client.getNegotiatedProtocolVersion()).toBe(
        mode === "auto" ? "2026-07-28" : "2025-11-25"
      );
      expect(client.getInstructions()).toBe(instructions);
      expect((await client.listTools()).tools.map(tool => tool.name)).toContain("ping_tool");
      const skillsClient = new SkillsClient(client);
      const { skills } = await skillsClient.list();
      expect(skills.map(skill => skill.frontmatter.name)).toEqual(["check-connection"]);
      expect(await skillsClient.read(skills[0]!)).toMatchObject({ text: manifest, verified: true });
      const result = await client.callTool({ name: "ping_tool" });
      expect(result.content).toEqual([{ type: "text", text: "true" }]);
      expect(result.structuredContent).toBe(mode === "auto" ? true : undefined);
    } finally {
      await client.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
