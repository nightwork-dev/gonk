import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import {
  SkillsExtension,
  type Skill,
  type SkillReadResult,
  type SkillSource,
} from "@modelcontextprotocol/server/ext/skills";
import { nodeSkillFiles } from "@modelcontextprotocol/server/ext/skills/node";
import type { ToolDefinition, ToolOutcome } from "@gonk/tool-registry";

export interface McpBundledSkillOptions {
  /** Application-owned, packaged directories, one immediate child per skill. */
  root: string | URL;
  /** Pass createBundledSkillToolDefinitions from @gonk/skills/bundled. */
  createTools(options: { catalog: BundledSkillCatalog; listName: string; getName: string }): ToolDefinition[];
  listName?: string;
  getName?: string;
}

type InvokeSkillTool = (
  tool: ToolDefinition,
  input: Record<string, unknown>,
  ctx: ServerContext
) => Promise<ToolOutcome>;

type SkillFile = Exclude<Skill["resources"], "dynamic">[number];

interface BundledEntry {
  id: string;
  skill: Skill;
  manifest: SkillFile;
}

interface BundledSkillCatalog {
  list(): Promise<readonly { id: string; name: string; description: string }[]>;
  read(id: string): Promise<{ id: string; name: string; description: string; content: string } | undefined>;
}

export interface McpBundledSkills {
  readonly tools: ToolDefinition[];
  /** @internal Wire the native projection through the same registered tools. */
  attach(mcp: McpServer, invoke: InvokeSkillTool): void;
}

/** Load one verified bundle for both the portable tools and native MCP Skills. */
export async function loadMcpBundledSkills(options: McpBundledSkillOptions): Promise<McpBundledSkills> {
  const files = nodeSkillFiles(options.root instanceof URL ? fileURLToPath(options.root) : options.root);
  const bundle = await SkillsExtension.load(files, { strict: true });
  const entries = new Map<string, BundledEntry>();
  const manifests = new Map<string, BundledEntry>();
  const resources = new Map<string, { entry: BundledEntry; file: SkillFile }>();
  const listName = options.listName ?? "skill_list";
  const getName = options.getName ?? "skill_get";

  for (const skill of bundle.entries) {
    const id = skill.frontmatter.name;
    if (skill.uri !== `skill://${id}/SKILL.md` || skill.resources === "dynamic") {
      throw new Error(`Expected bundled skill ${id} in an immediate child directory`);
    }
    const manifest = skill.resources.find(file => file.uri === skill.uri);
    if (!manifest) throw new Error(`Missing manifest for bundled skill ${id}`);
    const entry = { id, skill, manifest };
    entries.set(id, entry);
    manifests.set(skill.uri, entry);
    for (const file of skill.resources) resources.set(file.uri, { entry, file });
  }

  async function readVerified(file: SkillFile): Promise<SkillReadResult> {
    // The path comes from the SDK-built manifest, never from a client URI.
    const path = file.uri.slice("skill://".length).split("/").map(decodeURIComponent).join("/");
    const bytes = await files.read(path);
    if (!matchesFile(file, bytes)) {
      throw new Error("Bundled skill changed since loading");
    }
    try {
      return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) };
    } catch {
      return { bytes };
    }
  }

  function summary(entry: BundledEntry) {
    return { id: entry.id, name: entry.id, description: entry.skill.frontmatter.description };
  }

  const catalog: BundledSkillCatalog = {
    async list() {
      return [...entries.values()].map(summary);
    },
    async read(id) {
      const entry = entries.get(id);
      if (!entry) return undefined;
      const manifest = await readVerified(entry.manifest);
      if (!("text" in manifest)) throw new Error("Bundled SKILL.md must be UTF-8");
      return { ...summary(entry), content: manifest.text };
    },
  };
  const tools = options.createTools({ catalog, listName, getName });
  if (listName === getName) throw new Error("Bundled MCP Skills requires distinct list and read tools");
  const listTool = requireTool(listName);
  const getTool = requireTool(getName);

  function requireTool(name: string): ToolDefinition {
    const tool = tools.find(candidate => candidate.name === name);
    if (!tool) throw new Error(`Missing bundled skill tool: ${name}`);
    return tool;
  }

  return {
    tools,
    attach(mcp, invoke) {
      async function authorizedRead(entry: BundledEntry, ctx: ServerContext): Promise<string | undefined> {
        const outcome = await invoke(getTool, { id: entry.id }, ctx);
        if (!outcome.ok || !isRecord(outcome.data)) return undefined;
        const { id, content } = outcome.data;
        if (id !== entry.id || typeof content !== "string") return undefined;
        return matchesFile(entry.manifest, Buffer.from(content, "utf8")) ? content : undefined;
      }

      const source: SkillSource = {
        async list(_params, ctx) {
          // Native entries include file names and digests, so require read access as well.
          const listing = await invoke(listTool, {}, ctx);
          const skills: Skill[] = [];
          if (!listing.ok || !isRecord(listing.data) || !Array.isArray(listing.data.skills)) {
            return { skills };
          }
          for (const item of listing.data.skills) {
            if (!isRecord(item) || typeof item.id !== "string") continue;
            const entry = entries.get(item.id);
            if (entry && await authorizedRead(entry, ctx) !== undefined) skills.push(entry.skill);
          }
          return { skills };
        },
        async get(uri, ctx) {
          const entry = manifests.get(uri);
          return entry && await authorizedRead(entry, ctx) !== undefined ? entry.skill : undefined;
        },
        async read(uri, ctx) {
          const found = resources.get(uri);
          if (!found) return undefined;
          const content = await authorizedRead(found.entry, ctx);
          if (content === undefined) return undefined;
          return found.file === found.entry.manifest ? { text: content } : readVerified(found.file);
        },
      };
      new SkillsExtension({ source }).attach(mcp);
    },
  };
}

function matchesFile(file: SkillFile, bytes: Uint8Array): boolean {
  return bytes.byteLength === file.size
    && `sha256:${createHash("sha256").update(bytes).digest("hex")}` === file.digest;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
