import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

import { safeJoin } from "@gonk/utils/path";

import type {
  CodexPluginInterface,
  CodexPluginManifest,
  CodexSkill,
  MaterializationManifest,
  MaterializeCodexOptions,
  SkillPlacementPolicy,
} from "./types.ts";
import { defaultCodexHookPlacement } from "./placement.ts";
import { renderStandaloneCodexHookPolicy } from "./run-hook.ts";

const MANIFEST_DIR = ".codex-plugin";
const MANIFEST_FILE = "plugin.json";
const SKILLS_DIR = "skills";
const SKILL_FILE = "SKILL.md";
const MCP_FILE = ".mcp.json";
const MATERIALIZE_MANIFEST_FILE = ".gonk-materialize.json";
const HOOKS_DIR = "hooks";
const HOOKS_FILE = "hooks.json";
const HOOK_RUNNER_FILE = "gonk-codex-hook.mjs";
const HOOK_POLICY_FILE = "gonk-codex-hook-policy.mjs";
const HOOK_SPEC_FILE = join("dist", "hook-spec.cjs");

/** Materialize an `ExtensionSpec` into a Codex plugin tree.
 *
 *  Idempotent: re-running with the same spec produces the same files. Files
 *  previously written by this materializer that the new spec no longer needs
 *  are removed via the `.gonk-materialize.json` sidecar. */
export function materializeCodexPlugin(opts: MaterializeCodexOptions): MaterializationManifest {
  const pluginRoot = resolve(opts.outDir);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(opts.spec.id)) {
    throw new Error(`Invalid ExtensionSpec id for Codex materialization: ${opts.spec.id}`);
  }
  const packageName = opts.packageName ?? opts.spec.id;
  const version = opts.version ?? "0.0.0";
  const mcpServerKey = opts.mcpServerKey ?? `gonk-${opts.spec.id}`;

  mkdirSync(pluginRoot, { recursive: true });

  const previous = readPreviousManifest(pluginRoot);
  const targets = new WriteBuffer(pluginRoot);

  const skills = opts.skills ?? buildDefaultSkills(opts.spec, opts.skillPlacement);
  const hooks = buildHooksFile(opts);
  const manifest = buildPluginManifest({
    opts,
    packageName,
    version,
    hasSkills: skills.length > 0,
    hasMcp: Boolean(opts.mcpServerEntry),
    hasHooks: Object.keys(hooks.hooks).length > 0,
  });
  targets.write(join(MANIFEST_DIR, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);

  if (opts.mcpServerEntry) {
    const payload = { mcpServers: { [mcpServerKey]: opts.mcpServerEntry } };
    targets.write(MCP_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  }
  if (Object.keys(hooks.hooks).length > 0) {
    if (!existsFile(join(pluginRoot, HOOK_SPEC_FILE))) {
      throw new Error(
        `Codex hooks require ${HOOK_SPEC_FILE} to exist before materialization`,
      );
    }
    targets.write(join(HOOKS_DIR, HOOKS_FILE), `${JSON.stringify(hooks, null, 2)}\n`);
    targets.write(join(HOOKS_DIR, HOOK_POLICY_FILE), renderStandaloneCodexHookPolicy());
    targets.write(join(HOOKS_DIR, HOOK_RUNNER_FILE), renderHookRunner());
  }

  for (const skill of skills.sort((a, b) => a.name.localeCompare(b.name))) {
    targets.write(join(SKILLS_DIR, skill.name, SKILL_FILE), renderSkill(skill));
  }

  const written = targets.relativePaths();
  const materializeManifest: MaterializationManifest = {
    pluginRoot,
    specId: opts.spec.id,
    packageName,
    written: [...written, MATERIALIZE_MANIFEST_FILE].sort(),
    manifestPath: MATERIALIZE_MANIFEST_FILE,
  };
  targets.write(MATERIALIZE_MANIFEST_FILE, `${JSON.stringify(materializeManifest, null, 2)}\n`);

  sweepObsolete({
    pluginRoot,
    previous,
    current: new Set(targets.relativePaths()),
  });

  return materializeManifest;
}

/** Remove every file this materializer previously wrote. Leaves unrelated files
 *  inside the plugin root alone. */
export function unmaterializeCodexPlugin(opts: { outDir: string }): { removed: string[] } {
  const pluginRoot = resolve(opts.outDir);
  const previous = readPreviousManifest(pluginRoot);
  const removed: string[] = [];

  for (const rel of [...previous].sort()) {
    if (rel === MATERIALIZE_MANIFEST_FILE) continue;
    let abs: string;
    try {
      abs = safeJoin(pluginRoot, rel);
    } catch {
      continue;
    }
    try {
      rmSync(abs);
      removed.push(rel);
    } catch {
      // Already gone.
    }
  }

  try {
    rmSync(join(pluginRoot, MATERIALIZE_MANIFEST_FILE));
  } catch {
    // Best-effort.
  }

  for (const dir of OWNED_DIRS) {
    pruneIfEmpty(join(pluginRoot, dir));
  }
  return { removed };
}

function buildPluginManifest(args: {
  opts: MaterializeCodexOptions;
  packageName: string;
  version: string;
  hasSkills: boolean;
  hasMcp: boolean;
  hasHooks: boolean;
}): CodexPluginManifest {
  const { opts } = args;
  const iface = buildInterface(opts);
  const manifest: CodexPluginManifest = {
    name: packageNameToManifestName(args.packageName),
    version: args.version,
    description: opts.spec.description,
    author: { name: "Nightwork" },
    license: "Apache-2.0",
    interface: iface,
    ...opts.manifest,
  };
  if (args.hasSkills) manifest.skills = `./${SKILLS_DIR}/`;
  if (args.hasMcp) manifest.mcpServers = `./${MCP_FILE}`;
  if (args.hasHooks) manifest.hooks = `./${HOOKS_DIR}/${HOOKS_FILE}`;
  return manifest;
}

function buildHooksFile(opts: MaterializeCodexOptions): import("./types.ts").CodexHooksFile {
  const policy = opts.hookPlacement ?? defaultCodexHookPlacement;
  const dispatchBinary =
    opts.hookDispatchBinary ?? 'node "$PLUGIN_ROOT/hooks/gonk-codex-hook.mjs"';
  if (!dispatchBinary.includes("$PLUGIN_ROOT")) {
    throw new Error("Codex hook dispatch commands must be anchored through $PLUGIN_ROOT");
  }
  const grouped: import("./types.ts").CodexHooksFile["hooks"] = {};
  for (const specEvent of Object.keys(opts.spec.hooks ?? {}).sort()) {
    for (const placement of policy({ specEvent, specId: opts.spec.id, dispatchBinary })) {
      const entries = (grouped[placement.event] ??= []);
      entries.push({
        ...(placement.matcher !== undefined ? { matcher: placement.matcher } : {}),
        hooks: [placement.command],
      });
    }
  }
  const hooks: import("./types.ts").CodexHooksFile["hooks"] = {};
  for (const event of Object.keys(grouped).sort() as Array<keyof typeof grouped>) {
    const entries = grouped[event];
    if (entries) hooks[event] = entries;
  }
  return { hooks };
}

function existsFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function renderHookRunner(): string {
  return `#!/usr/bin/env node
import { dispatchCodexHook } from "./gonk-codex-hook-policy.mjs";
const specEvent = process.argv[3];
const root = process.env.PLUGIN_ROOT ?? process.env.CLAUDE_PLUGIN_ROOT;

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  if (!specEvent || !root) return process.stdout.write("{}");
  let payload = {};
  try {
    const raw = await readStdin();
    if (raw.trim()) payload = JSON.parse(raw);
  } catch {}
  try {
    const output = await dispatchCodexHook({ root, specEvent, payload });
    process.stdout.write(JSON.stringify(output));
  } catch (error) {
    process.stderr.write(\`[gonk-codex-hook] \${error instanceof Error ? error.stack : String(error)}\\n\`);
    process.stdout.write("{}");
  }
}

void main();
`;
}

function buildInterface(opts: MaterializeCodexOptions): CodexPluginInterface {
  const category = opts.spec.category ?? "Productivity";
  const defaults: CodexPluginInterface = {
    displayName: toDisplayName(opts.spec.id),
    shortDescription: opts.spec.description,
    longDescription: opts.spec.description,
    developerName: "Nightwork",
    category: toCategory(category),
    defaultPrompt: opts.spec.command
      ? [`Use gonk ${opts.spec.command.name} in Codex.`]
      : [`Use gonk ${opts.spec.id} in Codex.`],
    brandColor: "#4F7CAC",
  };
  if (opts.mcpServerEntry) defaults.capabilities = ["Interactive"];
  return dropUndefined({ ...defaults, ...opts.interface });
}

function buildDefaultSkills(
  spec: MaterializeCodexOptions["spec"],
  placement?: SkillPlacementPolicy,
): CodexSkill[] {
  if (!spec.command) return [];
  const subcommands = Object.entries(spec.command.subcommands ?? {})
    .filter(([, subcommand]) => subcommand.requires?.() !== false)
    .sort(([a], [b]) => a.localeCompare(b)) as Parameters<SkillPlacementPolicy>[0]["subcommands"];
  const result =
    placement?.({ spec, command: spec.command, subcommands }) ??
    defaultSkillPlacement({ spec, command: spec.command, subcommands });
  return result === "drop" ? [] : [result];
}

const defaultSkillPlacement: SkillPlacementPolicy = ({ spec, command, subcommands }) => {
  const name = `gonk-${command.name}`;
  const verbs = subcommands.map(([verb, subcommand]) => `- ${verb}: ${subcommand.description}`);
  const body = [
    `# ${toDisplayName(command.name)}`,
    "",
    `Use this skill when Codex should work with the gonk ${command.name} capability.`,
    "",
    spec.description,
    "",
    ...(verbs.length > 0 ? ["Available verbs:", "", ...verbs, ""] : []),
    "This plugin is materialized from the shared gonk extension spec and exposes its runtime through the bundled MCP server when one is configured.",
  ].join("\n");
  return {
    name,
    description: command.description || spec.description,
    body,
  };
};

function renderSkill(skill: CodexSkill): string {
  const frontmatter = [
    "---",
    `name: ${serializeFrontmatterValue(skill.name)}`,
    `description: ${serializeFrontmatterValue(skill.description)}`,
    "---",
    "",
  ].join("\n");
  return `${frontmatter}${skill.body.replace(/\n+$/, "")}\n`;
}

function serializeFrontmatterValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  const str = String(value);
  return needsQuoting(str) ? JSON.stringify(str) : str;
}

function needsQuoting(s: string): boolean {
  if (s.length === 0) return true;
  if (/^[\s'"`]/.test(s) || /[\s]$/.test(s)) return true;
  if (/^[!&*|>%@`#?]/.test(s)) return true;
  if (/:\s/.test(s)) return true;
  return false;
}

function packageNameToManifestName(packageName: string): string {
  return packageName.startsWith("@gonk/") ? packageName.slice("@gonk/".length) : packageName;
}

function toDisplayName(id: string): string {
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function toCategory(category: string): string {
  if (category === "operator") return "Developer Tools";
  if (category === "substrate") return "Productivity";
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function dropUndefined<T extends Record<string, unknown>>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T;
}

function readPreviousManifest(pluginRoot: string): Set<string> {
  try {
    const sidecarPath = join(pluginRoot, MATERIALIZE_MANIFEST_FILE);
    const stat = statSync(sidecarPath);
    if (!stat.isFile()) return new Set();
    const raw = readFileSync(sidecarPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MaterializationManifest>;
    if (!parsed.written || !Array.isArray(parsed.written)) return new Set();
    return new Set(parsed.written.filter((p) => typeof p === "string"));
  } catch {
    return new Set();
  }
}

function sweepObsolete(args: {
  pluginRoot: string;
  previous: Set<string>;
  current: Set<string>;
}): void {
  for (const rel of args.previous) {
    if (args.current.has(rel)) continue;
    if (rel === MATERIALIZE_MANIFEST_FILE) continue;
    if (!isInsideOwnedDir(rel)) continue;
    let abs: string;
    try {
      abs = safeJoin(args.pluginRoot, rel);
    } catch {
      continue;
    }
    try {
      rmSync(abs);
    } catch {
      // Already gone.
    }
    pruneEmptyParents(args.pluginRoot, dirname(abs));
  }
}

const OWNED_DIRS = new Set([MANIFEST_DIR, SKILLS_DIR, HOOKS_DIR]);
const OWNED_ROOT_FILES = new Set([MCP_FILE]);

function isInsideOwnedDir(rel: string): boolean {
  const top = rel.split(sep)[0] ?? rel.split("/")[0] ?? "";
  if (OWNED_DIRS.has(top)) return true;
  return OWNED_ROOT_FILES.has(rel);
}

function pruneIfEmpty(dir: string): void {
  try {
    const entries = readdirSync(dir);
    if (entries.length === 0) rmdirSync(dir);
  } catch {
    // Best-effort.
  }
}

function pruneEmptyParents(pluginRoot: string, dir: string): void {
  if (!dir.startsWith(pluginRoot) || dir === pluginRoot) return;
  try {
    const entries = readdirSync(dir);
    if (entries.length === 0) {
      rmdirSync(dir);
      pruneEmptyParents(pluginRoot, dirname(dir));
    }
  } catch {
    // Best-effort.
  }
}

class WriteBuffer {
  private readonly entries = new Map<string, string>();
  constructor(private readonly pluginRoot: string) {}

  write(relPath: string, content: string): void {
    const abs = safeJoin(this.pluginRoot, relPath);
    const normalized = relPath.split(sep).join("/");
    this.entries.set(normalized, content);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }

  relativePaths(): string[] {
    return [...this.entries.keys()].sort();
  }
}

/** Read the manifest sidecar without re-materializing. Returns `null` if no
 *  prior manifest exists in `pluginRoot`. */
export function readMaterializationManifest(pluginRoot: string): MaterializationManifest | null {
  const sidecar = join(pluginRoot, MATERIALIZE_MANIFEST_FILE);
  try {
    const raw = readFileSync(sidecar, "utf8");
    return JSON.parse(raw) as MaterializationManifest;
  } catch {
    return null;
  }
}

/** Resolve a path inside the plugin root, useful for tests that want to read
 *  materialized output back. */
export function pluginPath(pluginRoot: string, ...parts: string[]): string {
  return safeJoin(resolve(pluginRoot), join(...parts));
}
