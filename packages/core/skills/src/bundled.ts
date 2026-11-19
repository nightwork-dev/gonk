import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shape, ToolError, type ToolDefinition } from '@gonk/tool-registry';
import { parseSkillDocument } from './frontmatter.ts';
import { isManagedSkillId } from './identifiers.ts';

export interface BundledSkillToolOptions {
  /** Trusted application-owned directory containing <id>/SKILL.md trees. */
  root: string | URL;
  listName?: string;
  getName?: string;
}
interface SkillSummary { id: string; name: string; description: string }
interface SkillDetail extends SkillSummary { content: string }

/** A read-only catalog shared by the tools and any native host projection. */
export interface BundledSkillCatalog {
  list(): Promise<readonly SkillSummary[]>;
  read(id: string): Promise<SkillDetail | undefined>;
}

interface CatalogToolOptions extends Omit<BundledSkillToolOptions, 'root'> {
  catalog: BundledSkillCatalog;
}

function directoryCatalog(root: string | URL): BundledSkillCatalog {
  const configuredRoot = root instanceof URL ? fileURLToPath(root) : resolve(root);

  async function read(id: string): Promise<SkillDetail | undefined> {
    if (!isManagedSkillId(id)) throw new ToolError('INVALID_INPUT', 'Use a skill ID returned by skill_list.');
    const root = await realpath(configuredRoot);
    const directory = join(root, id);
    try {
      const folder = await lstat(directory);
      if (!folder.isDirectory() || folder.isSymbolicLink() || await realpath(directory) !== directory) throw new ToolError('SKILL_NOT_FOUND', `Unknown bundled skill: ${id}`);
      const file = await open(join(directory, 'SKILL.md'), constants.O_RDONLY | constants.O_NOFOLLOW);
      let content: string;
      try {
        if (!(await file.stat()).isFile()) throw new ToolError('SKILL_NOT_FOUND', `Unknown bundled skill: ${id}`);
        content = await file.readFile('utf8');
      } finally { await file.close(); }
      const { frontmatter } = parseSkillDocument(content);
      if (frontmatter.name !== id || typeof frontmatter.description !== 'string' || !frontmatter.description.trim()) throw new ToolError('INVALID_SKILL', `Bundled skill ${id} needs a matching name and a description.`);
      return { id, name: id, description: frontmatter.description, content };
    } catch (error) {
      if (error instanceof ToolError) throw error;
      if (error && typeof error === 'object' && 'code' in error && ['ENOENT', 'ENOTDIR', 'ELOOP'].includes(String(error.code))) throw new ToolError('SKILL_NOT_FOUND', `Unknown bundled skill: ${id}`);
      throw error;
    }
  }

  return {
    read,
    async list() {
      const root = await realpath(configuredRoot);
      const entries = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && isManagedSkillId(entry.name))
        .sort((a, b) => a.name.localeCompare(b.name));
      const skills: SkillSummary[] = [];
      for (const entry of entries) {
        const detail = await read(entry.name);
        if (!detail) continue;
        const { content: _, ...summary } = detail;
        skills.push(summary);
      }
      return skills;
    },
  };
}

/** Project packaged instruction files through the ordinary registry policy and transports. */
export function createBundledSkillToolDefinitions(options: BundledSkillToolOptions | CatalogToolOptions): ToolDefinition[] {
  const catalog = 'catalog' in options ? options.catalog : directoryCatalog(options.root);
  const listName = options.listName ?? 'skill_list';
  const getName = options.getName ?? 'skill_get';

  const common = {
    approval: 'read' as const,
    capabilities: { readsFs: true, writesFs: false, network: false, idempotent: true },
    category: 'Skills',
    hints: { mcp: { annotations: { readOnly: true, idempotent: true, destructive: false, openWorld: false } } },
  };
  return [
    {
      ...common,
      name: listName,
      description: `List the usage skills bundled with this server. Use ${getName} to read a relevant skill before using its tools.`,
      input: shape<Record<string, never>>(
        (value): value is Record<string, never> => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0,
        'expected an empty object', { type: 'object', properties: {}, additionalProperties: false },
      ),
      handler: async () => ({ data: { skills: await catalog.list() } }),
    },
    {
      ...common,
      name: getName,
      description: 'Read a bundled usage skill by ID, including its complete SKILL.md instructions.',
      input: shape<{ id: string }>(
        (value): value is { id: string } => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 && 'id' in value && isManagedSkillId(value.id),
        `expected { id: <skill ID from ${listName}> }`,
        { type: 'object', properties: { id: { type: 'string', minLength: 1 } }, required: ['id'], additionalProperties: false },
      ),
      hints: { ...common.hints, cli: { positional: ['id'] } },
      handler: async input => {
        const { id } = input as { id: string };
        const skill = await catalog.read(id);
        if (!skill) throw new ToolError('SKILL_NOT_FOUND', `Unknown bundled skill: ${id}`);
        return { data: skill };
      },
    },
  ];
}
