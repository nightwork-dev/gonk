import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type Dirent,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  SCOPE_RESOLUTION_ORDER,
  resolveTierHomes,
  type ScopeName,
} from "@gonk/scope";

import { parseSkillDocument, type FrontmatterRecord } from "./frontmatter.ts";
import { isManagedSkillId, isManagedSkillPath } from "./identifiers.ts";
import {
  skillGetRequestSchema,
  skillGetResultSchema,
  skillListRequestSchema,
  skillListResultSchema,
  skillReadRequestSchema,
  skillReadResultSchema,
  skillResolveResultSchema,
  skillFreshnessResultSchema,
} from "./schemas.ts";
import type {
  FilesystemManagedSkillRegistryOptions,
  ManagedSkillDetail,
  ManagedSkillRegistry,
  ManagedSkillSummary,
  SkillFileEntry,
  SkillFreshnessResult,
  SkillGetRequest,
  SkillGetResult,
  SkillListRequest,
  SkillListResult,
  SkillProvenance,
  SkillProvenanceAnchor,
  SkillReadRequest,
  SkillReadResult,
  SkillRequirement,
  SkillResolveResult,
  SkillScope,
  SkillTreeEntry,
} from "./types.ts";

const SKILLS_DIR = "skills";
const MANIFEST = "SKILL.md";
const READ_CAPABILITIES = Object.freeze(["read"] as const);

interface LoadedSkill {
  summary: ManagedSkillSummary;
  body: string;
  skillDir: string;
  manifestPath: string;
  supportingFiles: readonly SkillTreeEntry[];
  provenance?: SkillProvenance;
  files: ReadonlyMap<string, { bytes: Uint8Array; contentHash: string }>;
}

export class FilesystemManagedSkillRegistry implements ManagedSkillRegistry {
  private readonly env: Readonly<FilesystemManagedSkillRegistryOptions["env"]>;
  private readonly freshnessProbe: FilesystemManagedSkillRegistryOptions["freshnessProbe"];

  constructor(options: FilesystemManagedSkillRegistryOptions) {
    this.env = Object.freeze({
      ...options.env,
      ...(options.env.rootKinds === undefined
        ? {}
        : { rootKinds: Object.freeze([...options.env.rootKinds]) }),
      ...(options.env.adapterFactories === undefined
        ? {}
        : { adapterFactories: Object.freeze({ ...options.env.adapterFactories }) }),
    });
    this.freshnessProbe = options.freshnessProbe;
  }

  async list(request: SkillListRequest = {}): Promise<SkillListResult> {
    assertValidSync(skillListRequestSchema, request, "SkillListRequest");
    const captured = captureListRequest(request);
    const definitions = this.scanDefinitions(captured.scope);
    const winners = firstById(definitions);
    const skills = await Promise.all(
      winners.map((skill) =>
        this.summaryWithFreshness(skill, captured.includeFreshness === true)
      )
    );
    const result: SkillListResult = { status: "ok", skills };
    assertValidSync(skillListResultSchema, result, "SkillListResult");
    return result;
  }

  async get(request: SkillGetRequest): Promise<SkillGetResult> {
    assertValidSync(skillGetRequestSchema, request, "SkillGetRequest");
    const captured = captureGetRequest(request);
    const definitions = this.scanDefinitions();
    const matching = definitions.filter(({ summary }) => summary.id === captured.id);
    const selected = selectDefinition(matching, captured.scope);
    if (!selected) {
      const result: SkillGetResult = { status: "not-found", id: captured.id };
      assertValidSync(skillGetResultSchema, result, "SkillGetResult");
      return result;
    }
    const skill = await this.toDetail(
      selected,
      matching.filter((definition) => definition !== selected),
      captured.includeFreshness === true
    );
    const result: SkillGetResult = { status: "found", skill };
    assertValidSync(skillGetResultSchema, result, "SkillGetResult");
    return result;
  }

  async resolve(request: SkillGetRequest): Promise<SkillResolveResult> {
    assertValidSync(skillGetRequestSchema, request, "SkillGetRequest");
    const captured = captureGetRequest(request);
    const definitions = this.scanDefinitions().filter(
      ({ summary }) => summary.id === captured.id
    );
    const selected = selectDefinition(definitions, captured.scope);
    if (!selected) {
      const result: SkillResolveResult = {
        status: "not-found",
        id: captured.id,
      };
      assertValidSync(skillResolveResultSchema, result, "SkillResolveResult");
      return result;
    }
    const summaries = await Promise.all(
      definitions.map((definition) =>
        this.summaryWithFreshness(
          definition,
          captured.includeFreshness === true
        )
      )
    );
    const active = await this.toDetail(
      selected,
      definitions.filter((definition) => definition !== selected),
      captured.includeFreshness === true
    );
    const result: SkillResolveResult = {
      status: "found",
      id: captured.id,
      active,
      definitions: summaries,
    };
    assertValidSync(skillResolveResultSchema, result, "SkillResolveResult");
    return result;
  }

  async read(request: SkillReadRequest): Promise<SkillReadResult> {
    assertValidSync(skillReadRequestSchema, request, "SkillReadRequest");
    const captured = captureReadRequest(request);
    const definitions = this.scanDefinitions().filter(
      ({ summary }) => summary.id === captured.id
    );
    const selected = selectDefinition(definitions, captured.scope);
    if (!selected) {
      return this.validateReadResult({
        status: "not-found",
        id: captured.id,
        path: captured.path,
        reason: "skill-not-found",
      });
    }
    if (captured.path === MANIFEST) {
      return this.validateReadResult({
        status: "found",
        id: captured.id,
        scope: selected.summary.scope,
        path: MANIFEST,
        content: selected.body,
        contentHash: selected.summary.contentHash,
        skillRevision: selected.summary.revision,
        mediaType: "text/markdown",
      });
    }
    const file = selected.files.get(captured.path);
    if (!file) {
      return this.validateReadResult({
        status: "not-found",
        id: captured.id,
        path: captured.path,
        reason: "file-not-found",
      });
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(
        file.bytes
      );
    } catch {
      return this.validateReadResult({
        status: "not-found",
        id: captured.id,
        path: captured.path,
        reason: "file-not-found",
      });
    }
    return this.validateReadResult({
      status: "found",
      id: captured.id,
      scope: selected.summary.scope,
      path: captured.path,
      content,
      contentHash: file.contentHash,
      skillRevision: selected.summary.revision,
      mediaType: captured.path.endsWith(".md")
        ? "text/markdown"
        : "text/plain",
    });
  }

  private validateReadResult(result: SkillReadResult): SkillReadResult {
    assertValidSync(skillReadResultSchema, result, "SkillReadResult");
    return result;
  }

  private scanDefinitions(scope?: SkillScope): LoadedSkill[] {
    // resolveTierHomes consults the live persona callback once per synchronous
    // scan; the copied environment prevents caller mutation of other inputs.
    const homes = resolveTierHomes(this.env);
    const out: LoadedSkill[] = [];
    const seenSkillDirs = new Set<string>();

    for (const currentScope of SCOPE_RESOLUTION_ORDER) {
      if (scope !== undefined && currentScope !== scope) continue;
      const home = homes.get(currentScope);
      if (!home) continue;
      const skillsRoot = join(home, SKILLS_DIR);
      if (!isDirectoryWithoutLinks(skillsRoot)) continue;
      const realSkillsRoot = realpathSync(skillsRoot);
      if (!isInside(home, realSkillsRoot)) continue;
      let entries: Dirent[];
      try {
        entries = readdirSync(realSkillsRoot, { withFileTypes: true });
      } catch {
        continue;
      }
      entries.sort((a, b) => compareOpaque(a.name, b.name));
      for (const entry of entries) {
        if (
          entry.name.startsWith(".") ||
          !entry.isDirectory() ||
          entry.isSymbolicLink() ||
          !isManagedSkillId(entry.name)
        ) {
          continue;
        }
        const skillDir = join(realSkillsRoot, entry.name);
        if (!isDirectoryWithoutLinks(skillDir)) continue;
        const canonicalDir = realpathSync(skillDir);
        if (!isInside(realSkillsRoot, canonicalDir) || seenSkillDirs.has(canonicalDir)) {
          continue;
        }
        seenSkillDirs.add(canonicalDir);
        try {
          out.push(readDefinition(currentScope, canonicalDir, entry.name));
        } catch {
          // One malformed or unsafe skill never makes other valid skills vanish.
        }
      }
    }
    return out;
  }

  private async summaryWithFreshness(
    skill: LoadedSkill,
    includeFreshness: boolean
  ): Promise<ManagedSkillSummary> {
    if (!includeFreshness || !skill.provenance) return { ...skill.summary };
    const freshness = await this.probeFreshness(skill);
    return { ...skill.summary, freshness };
  }

  private async toDetail(
    skill: LoadedSkill,
    otherDefinitions: readonly LoadedSkill[],
    includeFreshness: boolean
  ): Promise<ManagedSkillDetail> {
    const summary = await this.summaryWithFreshness(skill, includeFreshness);
    const shadowed = await Promise.all(
      otherDefinitions.map((definition) =>
        this.summaryWithFreshness(definition, includeFreshness)
      )
    );
    return {
      ...summary,
      body: skill.body,
      skillDir: skill.skillDir,
      manifestPath: skill.manifestPath,
      supportingFiles: skill.supportingFiles,
      ...(skill.provenance === undefined
        ? {}
        : { provenance: skill.provenance }),
      shadowed,
    };
  }

  private async probeFreshness(skill: LoadedSkill): Promise<SkillFreshnessResult> {
    if (!skill.provenance) return { status: "unknown" };
    if (!this.freshnessProbe) return { status: "unknown" };
    try {
      const result = await this.freshnessProbe.probe({
        id: skill.summary.id,
        revision: skill.summary.revision,
        provenance: skill.provenance,
      });
      if (isValidSync(skillFreshnessResultSchema, result)) return { ...result };
    } catch {
      // Normalize probe failures below.
    }
    return {
      status: "unprobeable",
      summary: "Freshness probe failed",
    };
  }
}

function readDefinition(
  scope: ScopeName,
  skillDir: string,
  directoryId: string
): LoadedSkill {
  const manifestPath = join(skillDir, MANIFEST);
  if (!isRegularFileWithoutLinks(manifestPath)) {
    throw new TypeError("Skill manifest is missing or linked");
  }
  const realManifest = realpathSync(manifestPath);
  if (!isInside(skillDir, realManifest)) {
    throw new TypeError("Skill manifest escapes its directory");
  }
  const manifestBytes = readVerifiedFile(skillDir, realManifest);
  const document = parseSkillDocument(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)
  );
  const metadata = parseMetadata(document.frontmatter, directoryId);
  const tree = readSupportingTree(skillDir);
  const contentHash = hashBytes(Buffer.from(document.body, "utf8"));
  const revision = hashRevision(manifestBytes, tree.files);
  const summary: ManagedSkillSummary = {
    id: metadata.id,
    ...(metadata.name === undefined ? {} : { name: metadata.name }),
    description: metadata.description,
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    origin: { kind: "gonk-managed" },
    scope,
    lifecycle: "active",
    capabilities: READ_CAPABILITIES,
    revision,
    contentHash,
    ...(metadata.pinned === undefined ? {} : { pinned: metadata.pinned }),
    ...(metadata.agentCreated === undefined
      ? {}
      : { agentCreated: metadata.agentCreated }),
    ...(metadata.useCount === undefined ? {} : { useCount: metadata.useCount }),
    ...(metadata.lastUsedAt === undefined
      ? {}
      : { lastUsedAt: metadata.lastUsedAt }),
    ...(metadata.updatedAt === undefined
      ? {}
      : { updatedAt: metadata.updatedAt }),
    ...(metadata.requirements === undefined
      ? {}
      : { requirements: metadata.requirements }),
  };
  return {
    summary,
    body: document.body,
    skillDir,
    manifestPath: realManifest,
    supportingFiles: tree.entries,
    ...(metadata.provenance === undefined
      ? {}
      : { provenance: metadata.provenance }),
    files: tree.files,
  };
}

interface ParsedMetadata {
  id: string;
  name?: string;
  description: string;
  version?: string;
  author?: string;
  pinned?: boolean;
  agentCreated?: boolean;
  useCount?: number;
  lastUsedAt?: string;
  updatedAt?: string;
  requirements?: SkillRequirement;
  provenance?: SkillProvenance;
}

function parseMetadata(
  frontmatter: FrontmatterRecord,
  directoryId: string
): ParsedMetadata {
  const declaredId = optionalString(frontmatter.id, "id");
  const id = declaredId ?? directoryId;
  if (!isManagedSkillId(id) || id !== directoryId) {
    throw new TypeError("Skill id must match its directory");
  }
  const description = requiredString(frontmatter.description, "description");
  const needsAudit = optionalBoolean(
    frontmatter.needs_audit ?? frontmatter.needsAudit,
    "needs_audit"
  );
  if (needsAudit === true) {
    throw new TypeError("Staged skill appeared in the active directory");
  }
  const requirements = parseRequirements(frontmatter);
  const provenance = parseProvenance(frontmatter.provenance);
  return {
    id,
    ...(frontmatter.name === undefined
      ? {}
      : { name: requiredString(frontmatter.name, "name") }),
    description,
    ...(frontmatter.version === undefined
      ? {}
      : { version: requiredString(frontmatter.version, "version") }),
    ...(frontmatter.author === undefined
      ? {}
      : { author: requiredString(frontmatter.author, "author") }),
    ...(frontmatter.pinned === undefined
      ? {}
      : { pinned: optionalBoolean(frontmatter.pinned, "pinned")! }),
    ...((frontmatter.agent_created ?? frontmatter.agentCreated) === undefined
      ? {}
      : {
          agentCreated: optionalBoolean(
            frontmatter.agent_created ?? frontmatter.agentCreated,
            "agent_created"
          )!,
        }),
    ...((frontmatter.use_count ?? frontmatter.useCount) === undefined
      ? {}
      : {
          useCount: nonNegativeInteger(
            frontmatter.use_count ?? frontmatter.useCount,
            "use_count"
          ),
        }),
    ...((frontmatter.last_used_at ?? frontmatter.lastUsedAt) === undefined
      ? {}
      : {
          lastUsedAt: requiredString(
            frontmatter.last_used_at ?? frontmatter.lastUsedAt,
            "last_used_at"
          ),
        }),
    ...((frontmatter.updated_at ?? frontmatter.updatedAt) === undefined
      ? {}
      : {
          updatedAt: requiredString(
            frontmatter.updated_at ?? frontmatter.updatedAt,
            "updated_at"
          ),
        }),
    ...(requirements === undefined ? {} : { requirements }),
    ...(provenance === undefined ? {} : { provenance }),
  };
}

function parseRequirements(frontmatter: FrontmatterRecord): SkillRequirement | undefined {
  const nested = frontmatter.requirements;
  if (nested !== undefined && !isFrontmatterRecord(nested)) {
    throw new TypeError("requirements must be a mapping");
  }
  const tools = optionalStringArray(nested?.tools, "requirements.tools");
  const hosts = optionalStringArray(
    nested?.hosts ?? frontmatter.interface,
    "requirements.hosts"
  );
  const platforms = optionalStringArray(
    nested?.platforms ?? frontmatter.platform,
    "requirements.platforms"
  );
  if (!tools && !hosts && !platforms) return undefined;
  return {
    ...(tools ? { tools } : {}),
    ...(hosts ? { hosts } : {}),
    ...(platforms ? { platforms } : {}),
  };
}

function parseProvenance(value: unknown): SkillProvenance | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isFrontmatterRecord(value)) {
    throw new TypeError("provenance must be a mapping");
  }
  const rawAnchors = optionalStringArray(value.anchors, "provenance.anchors");
  if (!rawAnchors || rawAnchors.length === 0) return undefined;
  const anchors: SkillProvenanceAnchor[] = rawAnchors.map((anchor) => ({
    kind: looksLikeFileAnchor(anchor) ? "file" : "symbol",
    value: anchor,
  }));
  return {
    ...(value.repo === undefined
      ? {}
      : { repositoryId: requiredString(value.repo, "provenance.repo") }),
    ...(value.package === undefined
      ? {}
      : { packageId: requiredString(value.package, "provenance.package") }),
    ...(value.version === undefined
      ? {}
      : { version: requiredString(value.version, "provenance.version") }),
    ...((value.pinned_at ?? value.pinnedAt) === undefined
      ? {}
      : {
          pinnedAt: requiredString(
            value.pinned_at ?? value.pinnedAt,
            "provenance.pinned_at"
          ),
        }),
    anchors,
  };
}

function readSupportingTree(skillDir: string): {
  entries: readonly SkillTreeEntry[];
  files: ReadonlyMap<string, { bytes: Uint8Array; contentHash: string }>;
} {
  const files = new Map<string, { bytes: Uint8Array; contentHash: string }>();
  const walk = (directory: string, prefix: string): SkillTreeEntry[] => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      compareOpaque(a.name, b.name)
    );
    const out: SkillTreeEntry[] = [];
    for (const entry of entries) {
      if (prefix.length === 0 && entry.name === MANIFEST) continue;
      if (entry.isSymbolicLink()) {
        throw new TypeError("Symbolic links are not valid skill files");
      }
      const absolutePath = join(directory, entry.name);
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!isDirectoryWithoutLinks(absolutePath)) {
          throw new TypeError("Linked supporting directory");
        }
        const real = realpathSync(absolutePath);
        if (!isInside(skillDir, real)) {
          throw new TypeError("Supporting directory escapes skill root");
        }
        out.push({
          kind: "directory",
          name: entry.name,
          path,
          children: walk(real, path),
        });
        continue;
      }
      if (!entry.isFile() || !isRegularFileWithoutLinks(absolutePath)) {
        throw new TypeError("Unsupported supporting file type");
      }
      const real = realpathSync(absolutePath);
      if (!isInside(skillDir, real)) {
        throw new TypeError("Supporting file escapes skill root");
      }
      const bytes = readVerifiedFile(skillDir, real);
      const contentHash = hashBytes(bytes);
      const file: SkillFileEntry = {
        kind: "file",
        name: entry.name,
        path,
        size: bytes.byteLength,
        contentHash,
      };
      out.push(file);
      files.set(path, { bytes, contentHash });
    }
    return out;
  };
  return { entries: walk(skillDir, ""), files };
}

function hashRevision(
  manifest: Uint8Array,
  files: ReadonlyMap<string, { bytes: Uint8Array; contentHash: string }>
): string {
  const hash = createHash("sha256");
  updateLengthPrefixed(hash, Buffer.from(MANIFEST, "utf8"));
  updateLengthPrefixed(hash, manifest);
  for (const [path, file] of [...files.entries()].sort(([a], [b]) => compareOpaque(a, b))) {
    updateLengthPrefixed(hash, Buffer.from(path, "utf8"));
    updateLengthPrefixed(hash, file.bytes);
  }
  return `sha256:${hash.digest("hex")}`;
}

function readVerifiedFile(root: string, path: string): Uint8Array {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new TypeError("Skill file must be a regular non-symbolic file");
  }
  const realBefore = realpathSync(path);
  if (!isInside(root, realBefore)) {
    throw new TypeError("Skill file escapes its root");
  }
  const descriptor = openSync(realBefore, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
      throw new TypeError("Skill file changed during verification");
    }
    const bytes = readFileSync(descriptor);
    const after = lstatSync(path);
    const realAfter = realpathSync(path);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      !isInside(root, realAfter)
    ) {
      throw new TypeError("Skill file changed during read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function updateLengthPrefixed(
  hash: ReturnType<typeof createHash>,
  value: Uint8Array
): void {
  const length = Buffer.allocUnsafe(8);
  length.writeBigUInt64BE(BigInt(value.byteLength));
  hash.update(length);
  hash.update(value);
}

function hashBytes(value: Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function firstById(definitions: readonly LoadedSkill[]): LoadedSkill[] {
  const seen = new Set<string>();
  const winners: LoadedSkill[] = [];
  for (const definition of definitions) {
    if (seen.has(definition.summary.id)) continue;
    seen.add(definition.summary.id);
    winners.push(definition);
  }
  return winners.sort((a, b) => compareOpaque(a.summary.id, b.summary.id));
}

function selectDefinition(
  definitions: readonly LoadedSkill[],
  scope: SkillScope | undefined
): LoadedSkill | undefined {
  return scope === undefined
    ? definitions[0]
    : definitions.find(({ summary }) => summary.scope === scope);
}

function captureListRequest(request: SkillListRequest): Readonly<SkillListRequest> {
  return Object.freeze({
    ...(request.scope === undefined ? {} : { scope: request.scope }),
    ...(request.includeFreshness === undefined
      ? {}
      : { includeFreshness: request.includeFreshness }),
  });
}

function captureGetRequest(request: SkillGetRequest): Readonly<SkillGetRequest> {
  return Object.freeze({
    id: request.id,
    ...(request.scope === undefined ? {} : { scope: request.scope }),
    ...(request.includeFreshness === undefined
      ? {}
      : { includeFreshness: request.includeFreshness }),
  });
}

function captureReadRequest(
  request: SkillReadRequest
): Readonly<Required<Pick<SkillReadRequest, "id" | "path">> & Pick<SkillReadRequest, "scope">> {
  return Object.freeze({
    id: request.id,
    path: request.path ?? MANIFEST,
    ...(request.scope === undefined ? {} : { scope: request.scope }),
  });
}

function isDirectoryWithoutLinks(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isRegularFileWithoutLinks(path: string): boolean {
  try {
    const stat = lstatSync(path);
    return stat.isFile() && !stat.isSymbolicLink();
  } catch {
    return false;
  }
}

function isInside(base: string, candidate: string): boolean {
  const rel = relative(resolve(base), resolve(candidate));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function compareOpaque(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new TypeError(`${label} must be boolean`);
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative integer`);
  }
  return value;
}

function optionalStringArray(
  value: unknown,
  label: string
): readonly string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && value.trim().length > 0) {
    return Object.freeze([value]);
  }
  if (
    !Array.isArray(value) ||
    !value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  ) {
    throw new TypeError(`${label} must be a non-empty string or an array of them`);
  }
  return Object.freeze([...new Set(value)]);
}

function isFrontmatterRecord(value: unknown): value is FrontmatterRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function looksLikeFileAnchor(anchor: string): boolean {
  return anchor.includes("/") || /\.[A-Za-z0-9]+$/.test(anchor);
}

function assertValidSync<T>(
  schema: {
    readonly "~standard": {
      validate(value: unknown):
        | { value: T; issues?: undefined }
        | { issues: readonly unknown[] }
        | Promise<{ value: T; issues?: undefined } | { issues: readonly unknown[] }>;
    };
  },
  value: unknown,
  label: string
): void {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TypeError(`${label} validator must be synchronous`);
  }
  if ("issues" in result && result.issues) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function isValidSync(
  schema: {
    readonly "~standard": {
      validate(value: unknown): unknown | Promise<unknown>;
    };
  },
  value: unknown
): boolean {
  const result = schema["~standard"].validate(value);
  return !(
    result instanceof Promise ||
    result === null ||
    typeof result !== "object" ||
    ("issues" in result && (result as { issues?: unknown }).issues)
  );
}
