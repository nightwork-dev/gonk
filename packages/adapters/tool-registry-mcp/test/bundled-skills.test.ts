import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ownerPrincipal } from "@gonk/auth";
import { createBundledSkillToolDefinitions } from "@gonk/skills/bundled";
import { ToolRegistry } from "@gonk/tool-registry";
import { Client, StreamableHTTPClientTransport, type Transport } from "@modelcontextprotocol/client";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { expect, it } from "vitest";

import { createHttpMcpServer } from "../src/http/server.ts";
import { GONK_AUTH_INFO_PRINCIPAL, loadMcpBundledSkills } from "../src/index.ts";

it.each(["legacy", "auto"] as const)("serves verified bundled skills with tool policy over %s HTTP", async mode => {
  const root = await mkdtemp(join(tmpdir(), "gonk-bundled-mcp-"));
  const manifest = "---\nname: release-notes\ndescription: Draft the release notes.\n---\nUse the [guide](references/Release guide.md).\n";
  const guidePath = "references/Release guide.md";
  const guide = "Read the merged changes before drafting.\n";
  const skillUri = "skill://release-notes/SKILL.md";
  const guideUri = "skill://release-notes/references/Release%20guide.md";
  const clients: Client[] = [];

  try {
    await mkdir(join(root, "release-notes", "references"), { recursive: true });
    await writeFile(join(root, "release-notes", "SKILL.md"), manifest);
    await writeFile(join(root, "release-notes", guidePath), guide);
    const getName = "usage_get";
    const bundledSkills = await loadMcpBundledSkills({
      root, listName: "usage_list", getName, createTools: createBundledSkillToolDefinitions,
    });
    const source = new ToolRegistry();
    source.register(bundledSkills.tools);
    const owner = ownerPrincipal({ USER: "skills-owner" });
    const visitor = ownerPrincipal({ USER: "skills-visitor" });
    const server = createHttpMcpServer({
      serverName: "test-skills", serverVersion: "1", source, bundledSkills,
      authenticate(request) {
        const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
        if (token !== "owner" && token !== "visitor") return null;
        const auth = token === "owner" ? owner : visitor;
        return { token, clientId: auth.principal.id, scopes: [],
          extra: { [GONK_AUTH_INFO_PRINCIPAL]: auth.principal } };
      },
      makeAuthContext(ctx) {
        const auth = ctx.http?.authInfo?.token === "owner" ? owner : visitor;
        return {
          principal: auth.principal,
          authorize: ({ resource }) => ({
            outcome: auth === visitor && resource.target === getName ? "deny" : "allow",
            reason: "test bundle policy",
          }),
        };
      },
    });
    await server.start();
    async function connect(token: string) {
      const client = new Client({ name: "skills-check", version: "1" }, { versionNegotiation: { mode } });
      clients.push(client);
      const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${server.port}/mcp`), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      await client.connect(transport as Transport);
      return client;
    }

    try {
      const allowed = await connect("owner");
      const skills = new SkillsClient(allowed);
      expect(skills.supported).toBe(true);
      const list = await skills.list();
      expect(list.skills.map(skill => skill.uri)).toEqual([skillUri]);
      if (mode === "auto") expect(list.cacheScope).toBe("private");
      const { skill } = await skills.get(skillUri);
      expect(await skills.read(skill)).toMatchObject({ text: manifest, verified: true });
      expect(await skills.read(skill, guidePath)).toMatchObject({ text: guide, verified: true });
      expect(await allowed.callTool({ name: getName, arguments: { id: "release-notes" } }))
        .toMatchObject({ structuredContent: { content: manifest } });

      const denied = await connect("visitor");
      const deniedSkills = new SkillsClient(denied);
      expect((await deniedSkills.list()).skills).toEqual([]);
      await expect(deniedSkills.get(skillUri)).rejects.toThrow();
      await expect(denied.readResource({ uri: guideUri })).rejects.toThrow();

      const original = source.get(getName)!;
      source.register({ ...original }, { overwrite: true });
      await expect(allowed.readResource({ uri: guideUri })).rejects.toThrow();
      source.register(original, { overwrite: true });

      await writeFile(join(root, "release-notes", guidePath), "Replaced after catalog load.");
      await expect(allowed.readResource({ uri: guideUri })).rejects.toThrow();
    } finally {
      await Promise.all(clients.map(client => client.close()));
      await server.stop();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
