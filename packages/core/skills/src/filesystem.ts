import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  cpSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  renameSync,
  symlinkSync,
  type Dirent,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  captureAuthContext,
  securityContextKey,
  type AuthContext,
  type AuthzAction,
  type AuthorizationDecision,
} from "@gonk/auth";
import type { ContextContributor } from "@gonk/context";
import {
  createScope,
  SCOPE_RESOLUTION_ORDER,
  resolveTierHomes,
  type ScopeName,
} from "@gonk/scope";
import { resolveStoreDir } from "@gonk/store";
import { ToolError, type ToolDefinition } from "@gonk/tool-registry";
import { stringify as stringifyYaml } from "yaml";

import { parseSkillDocument, type FrontmatterRecord } from "./frontmatter.ts";
import { isManagedSkillId, isManagedSkillPath } from "./identifiers.ts";
import { FilesystemSkillLifecycleJournal } from "./journal.ts";
import { isIsoDateOrTimestamp, isIsoTimestamp } from "./validation.ts";
import {
  skillActivateResultSchema,
  skillCreateRequestSchema,
  skillGetRequestSchema,
  skillGetResultSchema,
  skillListRequestSchema,
  skillListResultSchema,
  skillReadRequestSchema,
  skillReadResultSchema,
  skillResolveRequestSchema,
  skillResolveResultSchema,
  skillFreshnessResultSchema,
} from "./schemas.ts";
import type {
  FilesystemManagedSkillRegistryOptions,
  ManagedSkillDetail,
  ManagedSkillSummary,
  SkillArchiveEntry,
  SkillFileEntry,
  SkillFreshnessResult,
  SkillActivateRequest,
  SkillActivateResult,
  SkillActivationReceiptGetRequest,
  SkillActivationReceiptGetResult,
  SkillActivationReceiptListRequest,
  SkillActivationReceiptListResult,
  SkillActivationContributorOptions,
  SkillActivationReceipt,
  SkillArchiveRequest,
  SkillArchiveResult,
  SkillCreateRequest,
  SkillGetRequest,
  SkillGetResult,
  SkillListRequest,
  SkillListResult,
  SkillLifecycle,
  SkillLifecycleJournal,
  SkillMutationFailureReason,
  SkillMutationJournalQuery,
  SkillMutationResult,
  SkillMutationOperation,
  SkillMutationReceipt,
  SkillMutationReceiptReadResult,
  SkillMutationReceiptRequest,
  SkillPatchRequest,
  SkillPinRequest,
  SkillProvenance,
  SkillProvenanceAnchor,
  SkillPromoteRequest,
  SkillRecordUsageRequest,
  SkillReadRequest,
  SkillReadResult,
  SkillRequirement,
  SkillRestoreRequest,
  SkillRestoreResult,
  SkillResolveRequest,
  SkillResolveResult,
  SkillScope,
  SkillToolProjection,
  SkillHostToolCallback,
  SkillHostToolInput,
  SkillHostToolResult,
  SkillToolDefinitionFactoryOptions,
  SkillTreeEntry,
  WritableManagedSkillRegistry,
} from "./types.ts";

const SKILLS_DIR = "skills";
const MANIFEST = "SKILL.md";
const STAGING_DIR = ".staging";
const ARCHIVE_DIR = ".archive";
const READ_CAPABILITIES = Object.freeze(["read"] as const);

// ToolRegistry deliberately type-erases heterogeneous definitions at registration.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySkillToolDefinition = ToolDefinition<any, any>;

interface LoadedSkill {
  summary: ManagedSkillSummary;
  body: string;
  supportingFiles: readonly SkillTreeEntry[];
  provenance?: SkillProvenance;
  files: ReadonlyMap<string, { bytes: Uint8Array; contentHash: string }>;
}

export class FilesystemManagedSkillRegistry implements WritableManagedSkillRegistry {
  private readonly env: Readonly<FilesystemManagedSkillRegistryOptions["env"]>;
  private readonly freshnessProbe: FilesystemManagedSkillRegistryOptions["freshnessProbe"];
  private readonly now: () => string;
  private readonly promotionApprovalProvider: FilesystemManagedSkillRegistryOptions["promotionApprovalProvider"];
  private readonly lifecycleJournal: NonNullable<FilesystemManagedSkillRegistryOptions["lifecycleJournal"]>;
  private readonly transactionStore: FilesystemSkillTransactionStore;

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
    this.now = options.now ?? (() => new Date().toISOString());
    this.promotionApprovalProvider = options.promotionApprovalProvider;
    this.lifecycleJournal =
      options.lifecycleJournal ?? new FilesystemSkillLifecycleJournal(this.env);
    this.transactionStore = new FilesystemSkillTransactionStore(
      this.env,
      this.lifecycleJournal
    );
    this.transactionStore.recover();
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

  async resolve(request: SkillResolveRequest): Promise<SkillResolveResult> {
    assertValidSync(skillResolveRequestSchema, request, "SkillResolveRequest");
    const captured = captureResolveRequest(request);
    const definitions = this.scanDefinitions().filter(
      ({ summary }) => summary.id === captured.id
    );
    const selected = definitions[0];
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

  async create(request: SkillCreateRequest): Promise<SkillMutationResult> {
    const auth = captureMutationAuth(request.auth);
    const denied = await authorizeSkill(auth, "skill.manage", request.id, request.scope, request);
    if (denied) return mutationFailed(request.id, "denied", denied.reason);
    if (!isValidSync(skillCreateRequestSchema, request)) {
      return mutationFailed(request.id, "invalid", "Invalid skill create request");
    }
    const replay = this.replay<SkillMutationResult>(
      "create",
      auth,
      request.idempotencyKey,
      request,
      () => idempotencyConflict(request.id)
    );
    if (replay) return replay;
    if (!isManagedSkillId(request.id)) {
      return mutationFailed(request.id, "invalid", "Invalid skill id");
    }
    if (request.body.trim().length === 0 || request.description.trim().length === 0) {
      return mutationFailed(request.id, "invalid", "Skill body and description are required");
    }
    const base = this.lifecycleRoot(request.scope, request.staged === true ? "staged" : "active");
    const skillDir = join(base, request.id);
    const manifest = join(skillDir, MANIFEST);
    if (existsSync(manifest)) {
      return mutationFailed(request.id, "already-exists", "Skill already exists");
    }
    for (const file of request.files ?? []) {
      if (!isManagedSkillPath(file.path) || file.path === MANIFEST) {
        return mutationFailed(request.id, "invalid", "Invalid supporting file path");
      }
    }
    return this.transactMutation(
      "create",
      auth,
      request.idempotencyKey,
      request,
      request.scope,
      [skillDir],
      async () => {
        mkdirSync(base, { recursive: true });
        const temp = mkdtempSync(join(base, `.${request.id}.create-`));
        try {
          writeFileSync(
            join(temp, MANIFEST),
            renderSkillManifest(request.id, request, request.body, {
              createdAt: this.now(),
              updatedAt: this.now(),
              needsAudit: request.staged === true,
            }),
            "utf8"
          );
          for (const file of request.files ?? []) {
            const target = join(temp, file.path);
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, file.content, "utf8");
          }
          if (request.staged !== true) {
            readDefinition(request.scope, verifyDirectory(base, temp), request.id);
          }
          renameSync(temp, skillDir);
        } catch (error) {
          rmSync(temp, { recursive: true, force: true });
          throw error;
        }
        return this.mutationDetail(
          request.id,
          request.scope,
          request.staged === true ? "staged" : "active"
        );
      }
    );
  }

  async patch(request: SkillPatchRequest): Promise<SkillMutationResult> {
    const auth = captureMutationAuth(request.auth);
    const scope = request.scope ?? (await this.selectedScope(request.id));
    if (!scope) return mutationFailed(request.id, "not-found", "Skill not found");
    const denied = await authorizeSkill(auth, "skill.manage", request.id, scope, request);
    if (denied) return mutationFailed(request.id, "denied", denied.reason);
    const replay = this.replay<SkillMutationResult>(
      "patch",
      auth,
      request.idempotencyKey,
      request,
      () => idempotencyConflict(request.id)
    );
    if (replay) return replay;
    if (request.find.length === 0) return mutationFailed(request.id, "invalid", "Patch find string must be non-empty");
    const detail = await this.get({ id: request.id, scope });
    if (detail.status !== "found") return mutationFailed(request.id, "not-found", "Skill not found");
    const conflict = revisionConflict(request.id, request.expectedRevision, detail.skill.revision, [request.path ?? MANIFEST, ...(request.writeFiles ?? []).map(({ path }) => path), ...(request.removeFiles ?? [])]);
    if (conflict) return conflict;
    if (detail.skill.pinned === true) {
      return mutationFailed(request.id, "conflict", "Pinned skills must be explicitly unpinned before editing", detail.skill.revision, [request.path ?? MANIFEST]);
    }
    const skillDir = this.skillDir(scope, request.id);
    const path = request.path ?? MANIFEST;
    if (!isManagedSkillPath(path)) return mutationFailed(request.id, "invalid", "Invalid patch path");
    if (path === MANIFEST) {
      if (!detail.skill.body.includes(request.find)) {
        return mutationFailed(request.id, "not-found", "Patch target not found");
      }
      const body = detail.skill.body.split(request.find).join(request.replace);
      const metadata = metadataFromDetail(detail.skill, this.now());
      return this.transactMutation(
        "patch",
        auth,
        request.idempotencyKey,
        request,
        scope,
        [skillDir],
        async () => {
          this.atomicRewriteSkillDir(skillDir, (temp) => {
            writeFileSync(
              join(temp, MANIFEST),
              renderSkillManifest(request.id, metadata, body, {}),
              "utf8"
            );
            applyFileMutations(temp, request.writeFiles, request.removeFiles);
          });
          return this.mutationDetail(request.id, scope, "active");
        }
      );
    }
    const target = join(skillDir, path);
    if (!isInside(skillDir, target) || !existsSync(target)) {
      return mutationFailed(request.id, "not-found", "Supporting file not found");
    }
    const current = readFileSync(target, "utf8");
    if (!current.includes(request.find)) {
      return mutationFailed(request.id, "not-found", "Patch target not found");
    }
    return this.transactMutation(
      "patch",
      auth,
      request.idempotencyKey,
      request,
      scope,
      [skillDir],
      async () => {
        this.atomicRewriteSkillDir(skillDir, (temp) => {
          writeFileSync(
            join(temp, path),
            current.split(request.find).join(request.replace),
            "utf8"
          );
          applyFileMutations(temp, request.writeFiles, request.removeFiles);
        });
        return this.mutationDetail(request.id, scope, "active");
      }
    );
  }

  async archive(request: SkillArchiveRequest): Promise<SkillArchiveResult> {
    const auth = captureMutationAuth(request.auth);
    const scope =
      request.scope ??
      (await this.selectedScope(request.id)) ??
      this.archiveEntries(request.id).at(-1)?.scope;
    if (!scope) return archiveFailed(request.id, "not-found", "Skill not found");
    const denied = await authorizeSkill(auth, "skill.manage", request.id, scope, request);
    if (denied) return archiveFailed(request.id, "denied", denied.reason);
    const replay = this.replay<SkillArchiveResult>(
      "archive",
      auth,
      request.idempotencyKey,
      request,
      () => archiveFailed(request.id, "conflict", "Idempotency key already used with a different request")
    );
    if (replay) return replay;
    const detail = await this.get({ id: request.id, scope });
    if (detail.status !== "found") return archiveFailed(request.id, "not-found", "Skill not found");
    const conflict = archiveRevisionConflict(request.id, request.expectedRevision, detail.skill.revision, [MANIFEST]);
    if (conflict) return conflict;
    if (detail.skill.pinned === true) {
      return archiveFailed(request.id, "conflict", "Pinned skills must be unpinned before archive");
    }
    const archivedAt = this.now();
    const archiveId = archiveName(request.id, archivedAt);
    const source = this.skillDir(scope, request.id);
    const dest = join(this.lifecycleRoot(scope, "archived"), archiveId);
    return this.transactMutation(
      "archive",
      auth,
      request.idempotencyKey,
      request,
      scope,
      [source, dest],
      () => {
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(source, dest, { recursive: true });
        rmSync(source, { recursive: true, force: true });
        return { status: "ok", id: request.id, scope, archiveId, archivedAt };
      }
    );
  }

  async restore(request: SkillRestoreRequest): Promise<SkillRestoreResult> {
    const auth = captureMutationAuth(request.auth);
    const candidates = this.archiveEntries(request.id, request.scope);
    const chosen = request.archiveId
      ? candidates.find((entry) => entry.archiveId === request.archiveId)
      : candidates.at(-1);
    if (!chosen) return restoreFailed(request.id, "not-found", "Archive entry not found");
    const denied = await authorizeSkill(auth, "skill.manage", request.id, chosen.scope, request);
    if (denied) return restoreFailed(request.id, "denied", denied.reason);
    const replay = this.replay<SkillRestoreResult>(
      "restore",
      auth,
      request.idempotencyKey,
      request,
      () => restoreFailed(request.id, "conflict", "Idempotency key already used with a different request")
    );
    if (replay) return replay;
    const dest = this.skillDir(chosen.scope, request.id);
    if (existsSync(dest)) return restoreFailed(request.id, "already-exists", "Live skill already exists");
    const parent = dirname(dest);
    const archiveDir = join(this.lifecycleRoot(chosen.scope, "archived"), chosen.archiveId);
    return this.transactMutation(
      "restore",
      auth,
      request.idempotencyKey,
      request,
      chosen.scope,
      [dest, join(archiveDir, ".restored")],
      () => {
        mkdirSync(parent, { recursive: true });
        const temp = mkdtempSync(join(parent, `.${request.id}.restore-`));
        let restored: LoadedSkill;
        try {
          cpSync(archiveDir, temp, { recursive: true });
          rmSync(join(temp, ".restored"), { force: true });
          restored = readDefinition(
            chosen.scope,
            verifyDirectory(parent, temp),
            request.id
          );
          if (existsSync(dest)) {
            return restoreFailed(
              request.id,
              "already-exists",
              "Live skill already exists"
            );
          }
          renameSync(temp, dest);
          try {
            writeFileAtomic(join(archiveDir, ".restored"), this.now());
          } catch {
            rmSync(dest, { recursive: true, force: true });
            return restoreFailed(
              request.id,
              "invalid",
              "Archive restore marker could not be recorded"
            );
          }
        } catch {
          return restoreFailed(
            request.id,
            "invalid",
            "Archived skill failed validation"
          );
        } finally {
          rmSync(temp, { recursive: true, force: true });
        }
        return {
          status: "ok",
          id: request.id,
          scope: chosen.scope,
          archiveId: chosen.archiveId,
          revision: restored.summary.revision,
        };
      }
    );
  }

  async promote(request: SkillPromoteRequest): Promise<SkillMutationResult> {
    const auth = captureMutationAuth(request.auth);
    const staged = this.stagedSkillDir(request.id, request.scope);
    const scope = staged?.scope ?? request.scope ?? (await this.selectedScope(request.id));
    if (!scope) return mutationFailed(request.id, "not-found", "Staged skill not found");
    const denied = await authorizeSkill(auth, "skill.manage", request.id, scope, request);
    if (denied) return mutationFailed(request.id, "denied", denied.reason);
    const replay = this.replay<SkillMutationResult>(
      "promote",
      auth,
      request.idempotencyKey,
      request,
      () => idempotencyConflict(request.id)
    );
    if (replay) return replay;
    if (!staged) return mutationFailed(request.id, "not-found", "Staged skill not found");
    const approval = await this.approvePromotion(auth, request, staged.scope);
    if (approval) return approval;
    const live = this.skillDir(staged.scope, request.id);
    if (existsSync(live)) return mutationFailed(request.id, "already-exists", "Live skill already exists");
    return this.transactMutation(
      "promote",
      auth,
      request.idempotencyKey,
      request,
      staged.scope,
      [staged.path, live],
      async () => {
        mkdirSync(dirname(live), { recursive: true });
        renameSync(staged.path, live);
        const parsed = safeParseExisting(join(live, MANIFEST));
        if (parsed) {
          writeFileSync(
            join(live, MANIFEST),
            renderSkillManifest(request.id, parsed, parsed.body, {
              updatedAt: this.now(),
              needsAudit: false,
            }),
            "utf8"
          );
        } else {
          const manifest = join(live, MANIFEST);
          writeFileSync(
            manifest,
            readFileSync(manifest, "utf8").replace(/^needs_audit: true\n/m, ""),
            "utf8"
          );
        }
        return this.mutationDetail(request.id, staged.scope, "active");
      }
    );
  }

  async pin(request: SkillPinRequest): Promise<SkillMutationResult> {
    const auth = captureMutationAuth(request.auth);
    const scope = request.scope ?? (await this.selectedScope(request.id));
    if (!scope) return mutationFailed(request.id, "not-found", "Skill not found");
    const denied = await authorizeSkill(auth, "skill.manage", request.id, scope, request);
    if (denied) return mutationFailed(request.id, "denied", denied.reason);
    const replay = this.replay<SkillMutationResult>(
      "pin",
      auth,
      request.idempotencyKey,
      request,
      () => idempotencyConflict(request.id)
    );
    if (replay) return replay;
    return this.transactMutation(
      "pin",
      auth,
      request.idempotencyKey,
      request,
      scope,
      [this.skillDir(scope, request.id)],
      () =>
        this.rewriteOperationalMetadata(
          auth,
          request.id,
          scope,
          { pinned: request.pinned },
          request
        )
    );
  }

  async recordUsage(request: SkillRecordUsageRequest): Promise<SkillMutationResult> {
    const auth = captureMutationAuth(request.auth);
    const scope = request.scope ?? (await this.selectedScope(request.id));
    if (!scope) return mutationFailed(request.id, "not-found", "Skill not found");
    const denied = await authorizeSkill(auth, "skill.manage", request.id, scope, request);
    if (denied) return mutationFailed(request.id, "denied", denied.reason);
    const replay = this.replay<SkillMutationResult>(
      "record-usage",
      auth,
      request.idempotencyKey,
      request,
      () => idempotencyConflict(request.id)
    );
    if (replay) return replay;
    const found = await this.get({ id: request.id, scope });
    if (found.status !== "found") return mutationFailed(request.id, "not-found", "Skill not found");
    return this.transactMutation(
      "record-usage",
      auth,
      request.idempotencyKey,
      request,
      scope,
      [this.skillDir(scope, request.id)],
      () =>
        this.rewriteOperationalMetadata(
          auth,
          request.id,
          scope,
          {
            lastUsedAt: request.usedAt ?? this.now(),
            useCount: (found.skill.useCount ?? 0) + 1,
          },
          request
        )
    );
  }

  async getMutationReceipt(
    request: SkillMutationReceiptRequest
  ): Promise<SkillMutationReceiptReadResult> {
    const auth = captureMutationAuth(request.auth);
    const receipt = this.lifecycleJournal.readMutation({
      operation: request.operation,
      securityContextKey: securityContextKey({ principal: auth.principal }),
      idempotencyKey: request.idempotencyKey,
    });
    if (!receipt) return { status: "not-found" };
    const denied = await authorizeSkill(
      auth,
      "skill.manage",
      receipt.id,
      receipt.scope,
      request
    );
    if (denied) {
      return { status: "failed", reason: "denied", message: denied.reason };
    }
    return { status: "found", receipt };
  }

  async getActivationReceipt(
    request: SkillActivationReceiptGetRequest
  ): Promise<SkillActivationReceiptGetResult> {
    const auth = captureMutationAuth(request.auth);
    const receipt = this.lifecycleJournal.readActivation({
      securityContextKey: securityContextKey({ principal: auth.principal }),
      activationId: request.activationId,
    });
    if (!receipt) return { status: "not-found" };
    const denied = await authorizeSkill(
      auth,
      "skill.activate",
      receipt.id,
      receipt.scope,
      request
    );
    if (denied) {
      return { status: "failed", reason: "denied", message: denied.reason };
    }
    return { status: "found", receipt };
  }

  async listActivationReceipts(
    request: SkillActivationReceiptListRequest
  ): Promise<SkillActivationReceiptListResult> {
    const auth = captureMutationAuth(request.auth);
    const receipts = this.lifecycleJournal.listActivations(
      securityContextKey({ principal: auth.principal })
    );
    const authorized: SkillActivationReceipt[] = [];
    for (const receipt of receipts) {
      if (request.id !== undefined && receipt.id !== request.id) continue;
      if (request.scope !== undefined && receipt.scope !== request.scope) continue;
      const denied = await authorizeSkill(
        auth,
        "skill.activate",
        receipt.id,
        receipt.scope,
        request
      );
      if (!denied) authorized.push(receipt);
    }
    return { status: "ok", receipts: authorized };
  }

  async activate(request: SkillActivateRequest): Promise<SkillActivateResult> {
    const auth = captureMutationAuth(request.auth);
    const found = await this.get({ id: request.id, ...(request.scope === undefined ? {} : { scope: request.scope }) });
    if (found.status !== "found") return { status: "failed", id: request.id, reason: "not-found", message: "Skill not found" };
    const denied = await authorizeSkill(auth, "skill.activate", request.id, found.skill.scope, request);
    if (denied) return { status: "failed", id: request.id, reason: "denied", message: denied.reason };
    if (found.skill.requirements?.tools && found.skill.requirements.tools.length > 0) {
      return { status: "missing-requirements", id: request.id, missing: found.skill.requirements.tools, message: "Skill has unresolved tool requirements" };
    }
    const timestamp = this.now();
    const securityKey = securityContextKey({ principal: auth.principal });
    const snapshot = this.transactionStore.begin(
      found.skill.scope,
      [this.skillDir(found.skill.scope, request.id)],
      { kind: "rollback" }
    );
    let usage: SkillMutationResult;
    try {
      usage = await this.rewriteOperationalMetadata(
        auth,
        request.id,
        found.skill.scope,
        { lastUsedAt: timestamp, useCount: (found.skill.useCount ?? 0) + 1 },
        { expectedRevision: found.skill.revision },
        "skill.activate"
      );
    } catch (error) {
      rollbackOrThrow(snapshot, error, "Activation metadata rollback failed");
      throw error;
    }
    if (usage.status === "failed") {
      snapshot.rollback();
      return {
        status: "failed",
        id: request.id,
        reason: usage.reason,
        message: usage.message,
      };
    }
    const receipt: SkillActivationReceipt = {
      kind: "skill-activation",
      receiptVersion: 1,
      activationId: skillActivationId(
        request.requestId ?? timestamp,
        request.id,
        found.skill.scope,
        usage.revision
      ),
      timestamp,
      id: request.id,
      scope: found.skill.scope,
      revision: usage.revision,
      resourceKey: skillResourceKey(request.id, found.skill.scope, usage.revision),
      principal: { id: auth.principal.id, kind: auth.principal.kind },
    };
    snapshot.setProbe({
      kind: "activation",
      securityContextKey: securityKey,
      activationId: receipt.activationId,
    });
    try {
      this.lifecycleJournal.writeActivation({
        securityContextKey: securityKey,
        receipt,
      });
      snapshot.commit();
    } catch (error) {
      const durable = this.readExactActivationReceipt(securityKey, receipt);
      if (durable) {
        snapshot.commit();
      } else {
        rollbackOrThrow(snapshot, error, "Activation metadata rollback failed");
        return {
          status: "failed",
          id: request.id,
          reason: "invalid",
          message: "Activation receipt could not be persisted",
        };
      }
    }
    return {
      status: "ready",
      receipt,
      candidate: {
        candidateId: receipt.activationId,
        contributorId: "gonk.skills.activation",
        resourceKey: receipt.resourceKey,
        revisionHint: receipt.revision,
        necessity: "required",
        priority: 1000,
        estimatedTokens: Math.max(1, Math.ceil(found.skill.body.length / 4)),
        estimateQuality: "fallback",
      },
    };
  }

  private replay<T>(
    operation: SkillMutationOperation,
    auth: AuthContext,
    key: string,
    request: unknown,
    conflict: () => T
  ): T | undefined {
    const fingerprint = stableFingerprint(request);
    const previous = this.lifecycleJournal.readMutation({
      operation,
      securityContextKey: securityContextKey({ principal: auth.principal }),
      idempotencyKey: key,
    });
    if (!previous) return undefined;
    if (previous.requestFingerprint === fingerprint) return previous.result as T;
    return conflict();
  }

  private async transactMutation<T extends SkillMutationReceipt["result"]>(
    operation: SkillMutationOperation,
    auth: AuthContext,
    key: string,
    request: unknown,
    scope: SkillScope,
    paths: readonly string[],
    mutate: () => T | Promise<T>
  ): Promise<T> {
    const securityKey = securityContextKey({ principal: auth.principal });
    const query = {
      operation,
      securityContextKey: securityKey,
      idempotencyKey: key,
    };
    const snapshot = this.transactionStore.begin(scope, paths, {
      kind: "mutation",
      receiptId: this.lifecycleJournal.mutationReceiptId(query),
    });
    const fingerprint = stableFingerprint(request);
    let result: T | undefined;
    let hasResult = false;
    try {
      result = await mutate();
      hasResult = true;
      if (result.status === "failed") snapshot.rollback();
      const remembered = this.remember(
        operation,
        auth,
        key,
        request,
        scope,
        result
      );
      if (result.status !== "failed") snapshot.commit();
      return remembered;
    } catch (error) {
      if (
        hasResult &&
        result !== undefined &&
        this.readExactMutationReceipt(query, fingerprint, scope, result)
      ) {
        if (result.status !== "failed") snapshot.commit();
        return result;
      }
      rollbackOrThrow(snapshot, error, "Skill mutation rollback failed");
      throw error;
    }
  }

  private readExactMutationReceipt<T extends SkillMutationReceipt["result"]>(
    query: SkillMutationJournalQuery,
    fingerprint: string,
    scope: SkillScope,
    result: T
  ): boolean {
    try {
      const receipt = this.lifecycleJournal.readMutation(query);
      return (
        receipt?.requestFingerprint === fingerprint &&
        receipt.scope === scope &&
        receipt.id === result.id &&
        JSON.stringify(receipt.result) === JSON.stringify(result)
      );
    } catch {
      return false;
    }
  }

  private readExactActivationReceipt(
    securityContextKey: string,
    receipt: SkillActivationReceipt
  ): boolean {
    try {
      const durable = this.lifecycleJournal.readActivation({
        securityContextKey,
        activationId: receipt.activationId,
      });
      return JSON.stringify(durable) === JSON.stringify(receipt);
    } catch {
      return false;
    }
  }

  private remember<T extends SkillMutationReceipt["result"]>(
    operation: SkillMutationOperation,
    auth: AuthContext,
    key: string,
    request: unknown,
    scope: SkillScope,
    result: T
  ): T {
    this.lifecycleJournal.writeMutation({
      operation,
      securityContextKey: securityContextKey({ principal: auth.principal }),
      idempotencyKey: key,
      timestamp: this.now(),
      requestFingerprint: stableFingerprint(request),
      id: result.id,
      scope,
      result,
    });
    return result;
  }

  private lifecycleRoot(scope: SkillScope, lifecycle: SkillLifecycle): string {
    const home = resolveTierHomes(this.env).get(scope);
    if (!home) throw new Error(`Cannot resolve skill scope home: ${scope}`);
    const root = join(home, SKILLS_DIR);
    if (lifecycle === "active") return root;
    return join(root, lifecycle === "staged" ? STAGING_DIR : ARCHIVE_DIR);
  }

  private skillDir(scope: SkillScope, id: string): string {
    return join(this.lifecycleRoot(scope, "active"), id);
  }

  private stagedSkillDir(
    id: string,
    scope?: SkillScope
  ): { scope: SkillScope; path: string } | undefined {
    for (const current of SCOPE_RESOLUTION_ORDER) {
      if (scope !== undefined && current !== scope) continue;
      const path = join(this.lifecycleRoot(current, "staged"), id);
      if (existsSync(join(path, MANIFEST))) return { scope: current, path };
    }
    return undefined;
  }

  private archiveEntries(id: string, scope?: SkillScope): SkillArchiveEntry[] {
    const entries: SkillArchiveEntry[] = [];
    for (const current of SCOPE_RESOLUTION_ORDER) {
      if (scope !== undefined && current !== scope) continue;
      const root = this.lifecycleRoot(current, "archived");
      if (!existsSync(root)) continue;
      for (const name of readdirSync(root).sort(compareOpaque)) {
        const archivedAt = parseArchiveName(id, name);
        if (!archivedAt) continue;
        entries.push({
          id,
          archiveId: name,
          scope: current,
          archivedAt,
          ...(existsSync(join(root, name, ".restored"))
            ? { restoredAt: readFileSync(join(root, name, ".restored"), "utf8").trim() }
            : {}),
        });
      }
    }
    return entries.sort((a, b) => compareOpaque(a.archivedAt, b.archivedAt));
  }

  private async selectedScope(id: string): Promise<SkillScope | undefined> {
    const found = await this.get({ id });
    return found.status === "found" ? found.skill.scope : undefined;
  }

  private async mutationDetail(
    id: string,
    scope: SkillScope,
    lifecycle: SkillLifecycle
  ): Promise<SkillMutationResult> {
    if (lifecycle === "staged") {
      const manifest = join(this.lifecycleRoot(scope, "staged"), id, MANIFEST);
      return {
        status: "ok",
        id,
        scope,
        lifecycle,
        revision: hashBytes(readFileSync(manifest)),
      };
    }
    const found = await this.get({ id, scope });
    if (found.status !== "found") {
      return mutationFailed(id, "invalid", "Mutated skill failed validation");
    }
    return {
      status: "ok",
      id,
      scope,
      lifecycle,
      revision: found.skill.revision,
    };
  }

  private async rewriteOperationalMetadata(
    authInput: AuthContext,
    id: string,
    scope: SkillScope,
    patch: Partial<Pick<ManagedSkillSummary, "pinned" | "lastUsedAt" | "useCount">>,
    originalRequest: { expectedRevision: string },
    action: AuthzAction = "skill.manage"
  ): Promise<SkillMutationResult> {
    const auth = captureMutationAuth(authInput);
    const found = await this.get({ id, scope });
    if (found.status !== "found") return mutationFailed(id, "not-found", "Skill not found");
    const conflict = revisionConflict(id, originalRequest.expectedRevision, found.skill.revision, [MANIFEST]);
    if (conflict) return conflict;
    const denied = await authorizeSkill(auth, action, id, scope, { id, scope, ...patch });
    if (denied) return mutationFailed(id, "denied", denied.reason);
    this.atomicRewriteSkillDir(this.skillDir(scope, id), (temp) => {
      writeFileSync(
        join(temp, MANIFEST),
        renderSkillManifest(id, { ...metadataFromDetail(found.skill, found.skill.updatedAt), ...patch }, found.skill.body, {}),
        "utf8"
      );
    });
    return this.mutationDetail(id, scope, "active");
  }

  private atomicRewriteSkillDir(skillDir: string, mutate: (temp: string) => void): void {
    const temp = `${skillDir}.tmp-${process.pid}-${Date.now()}`;
    const backup = `${skillDir}.bak-${process.pid}-${Date.now()}`;
    cpSync(skillDir, temp, { recursive: true });
    try {
      mutate(temp);
      renameSync(skillDir, backup);
      renameSync(temp, skillDir);
      rmSync(backup, { recursive: true, force: true });
    } catch (error) {
      rmSync(temp, { recursive: true, force: true });
      if (existsSync(backup) && !existsSync(skillDir)) renameSync(backup, skillDir);
      throw error;
    }
  }

  private async approvePromotion(
    auth: AuthContext,
    request: SkillPromoteRequest,
    scope: SkillScope
  ): Promise<SkillMutationResult | undefined> {
    if (!this.promotionApprovalProvider) {
      return mutationFailed(request.id, "denied", "Promotion approval provider is required");
    }
    const decision = await this.promotionApprovalProvider.decide({
      principal: auth.principal,
      tool: promotionApprovalTool,
      input: request,
      resource: skillResource(request.id, scope),
      approval: {
        tier: "write",
        override: false,
        reason: "Staged skill promotion requires independent approval",
      },
    });
    if (decision.outcome === "approved") return undefined;
    return mutationFailed(
      request.id,
      "denied",
      decision.outcome === "required" ? decision.reason : decision.reason
    );
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
      try {
        const root = verifyDirectory(home, skillsRoot);
        const entries: Dirent[] = readdirSync(root.realPath, {
          withFileTypes: true,
        });
        entries.sort((a, b) => compareOpaque(a.name, b.name));
        const scopeDefinitions: LoadedSkill[] = [];
        const scopeDirs: string[] = [];
        for (const entry of entries) {
          if (
            entry.name.startsWith(".") ||
            !entry.isDirectory() ||
            entry.isSymbolicLink() ||
            !isManagedSkillId(entry.name)
          ) {
            continue;
          }
          try {
            const directory = verifyDirectory(
              root.realPath,
              join(root.realPath, entry.name)
            );
            if (seenSkillDirs.has(directory.realPath)) continue;
            const loaded = readDefinition(currentScope, directory, entry.name);
            assertDirectoryUnchanged(directory);
            scopeDefinitions.push(loaded);
            scopeDirs.push(directory.realPath);
          } catch {
            // A renamed, malformed, or unsafe entry is absent from this scan.
          }
        }
        assertDirectoryUnchanged(root);
        for (let index = 0; index < scopeDefinitions.length; index += 1) {
          const directory = scopeDirs[index]!;
          if (seenSkillDirs.has(directory)) continue;
          seenSkillDirs.add(directory);
          out.push(scopeDefinitions[index]!);
        }
      } catch {
        // A raced or unsafe root contributes no partial entries.
        continue;
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
    const alternatives = await Promise.all(
      otherDefinitions.map((definition) =>
        this.summaryWithFreshness(definition, includeFreshness)
      )
    );
    return {
      ...summary,
      body: skill.body,
      supportingFiles: skill.supportingFiles,
      ...(skill.provenance === undefined
        ? {}
        : { provenance: skill.provenance }),
      otherDefinitions: alternatives,
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

const alwaysValidSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "gonk",
    validate: (value: unknown) => ({ value }),
  },
};

const promotionApprovalTool: ToolDefinition<unknown, unknown> = {
  name: "skill-promote",
  description: "Promote a staged managed skill after independent approval.",
  input: alwaysValidSchema,
  handler: async () => ({ data: {} }),
  category: "skills",
};

function captureMutationAuth(auth: AuthContext): AuthContext {
  try {
    return captureAuthContext(auth);
  } catch {
    return {
      principal: {
        id: "invalid-auth-context",
        kind: "service",
        identity: {
          issuer: "gonk",
          subject: "invalid-auth-context",
          method: "local",
        },
        roles: [],
        scopes: [],
      },
      authorize: () => ({
        outcome: "deny",
        reason: "Invalid authenticated principal",
      }),
    };
  }
}

function requireToolAuth(auth: AuthContext | undefined): AuthContext {
  if (!auth) {
    throw new ToolError(
      "AUTHORIZATION_DENIED",
      "Authenticated skill access is required"
    );
  }
  try {
    return captureAuthContext(auth);
  } catch {
    throw new ToolError("AUTHORIZATION_DENIED", "Invalid authenticated principal");
  }
}

async function authorizeSkill(
  auth: AuthContext,
  action: AuthzAction,
  id: string,
  scope: SkillScope,
  input: unknown
): Promise<AuthorizationDecision | undefined> {
  try {
    const decision = await auth.authorize({
      action,
      resource: skillResource(id, scope),
      input,
    });
    if (decision.outcome === "allow") return undefined;
    return decision;
  } catch {
    return { outcome: "deny", reason: "Authorization policy failed" };
  }
}

function skillResource(id: string, scope: SkillScope) {
  return {
    kind: "skill" as const,
    target: id,
    scope,
  };
}

function mutationFailed(
  id: string,
  reason: SkillMutationFailureReason,
  message: string,
  currentRevision?: string,
  affectedPaths?: readonly string[]
): SkillMutationResult {
  return {
    status: "failed",
    id,
    reason,
    message,
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(affectedPaths === undefined ? {} : { affectedPaths }),
  };
}

function archiveFailed(
  id: string,
  reason: SkillMutationFailureReason,
  message: string,
  currentRevision?: string,
  affectedPaths?: readonly string[]
): SkillArchiveResult {
  return {
    status: "failed",
    id,
    reason,
    message,
    ...(currentRevision === undefined ? {} : { currentRevision }),
    ...(affectedPaths === undefined ? {} : { affectedPaths }),
  };
}

function restoreFailed(
  id: string,
  reason: SkillMutationFailureReason,
  message: string
): SkillRestoreResult {
  return { status: "failed", id, reason, message };
}

function revisionConflict(
  id: string,
  expectedRevision: string,
  currentRevision: string,
  affectedPaths: readonly string[]
): SkillMutationResult | undefined {
  return expectedRevision === currentRevision
    ? undefined
    : mutationFailed(
        id,
        "conflict",
        "Expected revision does not match current revision",
        currentRevision,
        affectedPaths
      );
}

function archiveRevisionConflict(
  id: string,
  expectedRevision: string,
  currentRevision: string,
  affectedPaths: readonly string[]
): SkillArchiveResult | undefined {
  return expectedRevision === currentRevision
    ? undefined
    : archiveFailed(
        id,
        "conflict",
        "Expected revision does not match current revision",
        currentRevision,
        affectedPaths
      );
}

function renderSkillManifest(
  id: string,
  metadata: {
    description: string;
    body?: string;
    name?: string;
    version?: string;
    author?: string;
    tags?: readonly string[];
    provenance?: SkillProvenance;
    pinned?: boolean;
    agentCreated?: boolean;
    useCount?: number;
    lastUsedAt?: string;
    updatedAt?: string;
  },
  body: string,
  options: { createdAt?: string; updatedAt?: string; needsAudit?: boolean }
): string {
  const frontmatter: Record<string, unknown> = {
    id,
    ...(metadata.name === undefined ? {} : { name: metadata.name }),
    description: metadata.description,
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    ...(metadata.tags === undefined ? {} : { tags: metadata.tags }),
    ...(metadata.provenance === undefined
      ? {}
      : { provenance: renderProvenance(metadata.provenance) }),
    ...(options.createdAt === undefined ? {} : { created_at: options.createdAt }),
    updated_at: options.updatedAt ?? metadata.updatedAt,
    ...(metadata.pinned === undefined ? {} : { pinned: metadata.pinned }),
    ...(metadata.agentCreated === undefined
      ? {}
      : { agent_created: metadata.agentCreated }),
    ...(metadata.useCount === undefined ? {} : { use_count: metadata.useCount }),
    ...(metadata.lastUsedAt === undefined
      ? {}
      : { last_used_at: metadata.lastUsedAt }),
    ...(options.needsAudit === true ? { needs_audit: true } : {}),
  };
  return `---\n${stringifyYaml(frontmatter)}---\n${body.endsWith("\n") ? body : `${body}\n`}`;
}

function metadataFromDetail(
  skill: ManagedSkillDetail,
  updatedAt: string | undefined
): {
  description: string;
  name?: string;
  version?: string;
  author?: string;
  tags?: readonly string[];
  provenance?: SkillProvenance;
  pinned?: boolean;
  agentCreated?: boolean;
  useCount?: number;
  lastUsedAt?: string;
  updatedAt?: string;
} {
  return {
    description: skill.description,
    ...(skill.name === undefined ? {} : { name: skill.name }),
    ...(skill.version === undefined ? {} : { version: skill.version }),
    ...(skill.author === undefined ? {} : { author: skill.author }),
    ...(skill.tags === undefined ? {} : { tags: skill.tags }),
    ...(skill.provenance === undefined ? {} : { provenance: skill.provenance }),
    ...(skill.pinned === undefined ? {} : { pinned: skill.pinned }),
    ...(skill.agentCreated === undefined ? {} : { agentCreated: skill.agentCreated }),
    ...(skill.useCount === undefined ? {} : { useCount: skill.useCount }),
    ...(skill.lastUsedAt === undefined ? {} : { lastUsedAt: skill.lastUsedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  };
}

function safeParseExisting(path: string):
  | (ReturnType<typeof parseMetadata> & { body: string; createdAt?: string })
  | undefined {
  try {
    const document = parseSkillDocument(readFileSync(path, "utf8"));
    const id = optionalString(document.frontmatter.id, "id");
    const metadata = parseMetadata(document.frontmatter, id ?? "");
    const createdRaw = document.frontmatter.created_at ?? document.frontmatter.createdAt;
    return {
      ...metadata,
      body: document.body,
      ...(createdRaw === undefined
        ? {}
        : { createdAt: requiredIsoTimestamp(createdRaw, "created_at") }),
    };
  } catch {
    return undefined;
  }
}

function archiveName(id: string, timestamp: string): string {
  return `${id}-${timestamp.replace(/[:.]/g, "-")}`;
}

function parseArchiveName(id: string, name: string): string | undefined {
  if (!name.startsWith(`${id}-`)) return undefined;
  const raw = name.slice(id.length + 1);
  const timestamp = raw.replace(
    /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3}Z)$/,
    "$1:$2:$3.$4"
  );
  return isIsoTimestamp(timestamp) ? timestamp : undefined;
}

function skillResourceKey(id: string, scope: SkillScope, revision: string): string {
  return `gonk:skill:${scope}:${id}:${revision}`;
}

function skillActivationId(
  requestId: string,
  id: string,
  scope: SkillScope,
  revision: string
): string {
  const hash = createHash("sha256");
  for (const part of ["skill-activation-v1", requestId, id, scope, revision]) {
    updateLengthPrefixed(hash, Buffer.from(part, "utf8"));
  }
  return `sha256:${hash.digest("hex")}`;
}

function applyFileMutations(
  skillDir: string,
  writeFiles: readonly { path: string; content: string }[] | undefined,
  removeFiles: readonly string[] | undefined
): void {
  for (const path of removeFiles ?? []) {
    if (!isManagedSkillPath(path) || path === MANIFEST) {
      throw new TypeError("Invalid remove file path");
    }
    rmSync(join(skillDir, path), { force: true });
  }
  for (const file of writeFiles ?? []) {
    if (!isManagedSkillPath(file.path) || file.path === MANIFEST) {
      throw new TypeError("Invalid write file path");
    }
    const target = join(skillDir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content, "utf8");
  }
}

function writeFileAtomic(path: string, content: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  const tempDirectory = mkdtempSync(join(directory, ".write-"));
  const temp = join(tempDirectory, "value");
  try {
    writeFileSync(temp, content, "utf8");
    renameSync(temp, path);
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

interface FilesystemSnapshot {
  setProbe(probe: SkillTransactionProbe): void;
  commit(): void;
  rollback(): void;
}

type SkillTransactionProbe =
  | { kind: "rollback" }
  | { kind: "mutation"; receiptId: string }
  | {
      kind: "activation";
      securityContextKey: string;
      activationId: string;
    };

interface SkillTransactionMarker {
  markerVersion: 1;
  scope: SkillScope;
  probe: SkillTransactionProbe;
  entries: readonly {
    path: string;
    backup: string;
    existed: boolean;
    directory: boolean;
  }[];
}

const SKILL_TRANSACTION_NAMESPACE = "skills.lifecycle-transactions";
const SKILL_TRANSACTION_MARKER = "transaction.json";
const SKILL_TRANSACTION_LOCK = ".lock";

class FilesystemSkillTransactionStore {
  constructor(
    private readonly env: FilesystemManagedSkillRegistryOptions["env"],
    private readonly journal: SkillLifecycleJournal
  ) {}

  begin(
    scope: SkillScope,
    paths: readonly string[],
    probe: SkillTransactionProbe
  ): FilesystemSnapshot {
    const configuredHome = this.home(scope);
    const home = ensureTransactionHome(configuredHome);
    const namespace = this.namespace(scope, home);
    mkdirSync(namespace, { recursive: true });
    const releaseLock = this.tryAcquireLock(scope, namespace);
    if (!releaseLock) {
      throw new Error(`Another skill transaction is active in scope: ${scope}`);
    }
    const root = mkdtempSync(join(namespace, ".pending-"));
    const entries: SkillTransactionMarker["entries"][number][] = [];
    try {
      for (const [index, path] of [...new Set(paths)].entries()) {
        const relativePath = safeTransactionPath(configuredHome, path);
        const target = verifiedTransactionTarget(home, relativePath);
        const targetStat = lstatIfExists(target);
        const existed = targetStat !== undefined;
        const directory = targetStat?.isDirectory() === true;
        const backup = String(index);
        if (existed) {
          cpSync(target, join(root, backup), {
            recursive: directory,
            dereference: false,
            preserveTimestamps: true,
          });
        }
        entries.push({
          path: relativePath,
          backup,
          existed,
          directory,
        });
      }
      const marker: SkillTransactionMarker = {
        markerVersion: 1,
        scope,
        probe,
        entries,
      };
      writeTransactionMarker(root, marker);
      return persistentSnapshot(root, home, marker, releaseLock);
    } catch (error) {
      rmSync(root, { recursive: true, force: true });
      releaseLock();
      throw error;
    }
  }

  recover(): void {
    for (const scope of SCOPE_RESOLUTION_ORDER) {
      const home = resolveTierHomes(this.env).get(scope);
      if (!home || !lstatIfExists(home)) continue;
      const namespace = this.namespace(scope, home);
      if (!existsSync(namespace)) continue;
      const releaseLock = this.tryAcquireLock(scope, namespace);
      if (!releaseLock) {
        throw new Error(`Another skill transaction is active in scope: ${scope}`);
      }
      try {
        for (const name of readdirSync(namespace).sort(compareOpaque)) {
          const root = join(namespace, name);
          if (!lstatSync(root).isDirectory()) continue;
          const markerPath = join(root, SKILL_TRANSACTION_MARKER);
          const markerStat = lstatIfExists(markerPath);
          if (!markerStat) {
            rmSync(root, { recursive: true, force: true });
            continue;
          }
          if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
            throw new Error(`Invalid pending skill transaction: ${root}`);
          }
          const marker = parseTransactionMarker(readFileSync(markerPath, "utf8"));
          if (!marker || marker.scope !== scope) {
            throw new Error(`Invalid pending skill transaction: ${root}`);
          }
          const snapshot = persistentSnapshot(root, home, marker);
          if (this.isCommitted(marker)) snapshot.commit();
          else snapshot.rollback();
        }
      } finally {
        releaseLock();
      }
    }
  }

  private isCommitted(marker: SkillTransactionMarker): boolean {
    if (marker.probe.kind === "rollback") return false;
    if (marker.probe.kind === "mutation") {
      return (
        this.journal.readMutationByReceiptId(
          marker.scope,
          marker.probe.receiptId
        ) !== undefined
      );
    }
    return (
      this.journal.readActivation({
        securityContextKey: marker.probe.securityContextKey,
        activationId: marker.probe.activationId,
      }) !== undefined
    );
  }

  private home(scope: ScopeName): string {
    const home = resolveTierHomes(this.env).get(scope);
    if (!home) throw new Error(`Cannot resolve skill transaction home: ${scope}`);
    return home;
  }

  private namespace(scope: ScopeName, home: string): string {
    return verifiedTransactionNamespace(
      home,
      resolveStoreDir(
        createScope(this.env),
        scope,
        SKILL_TRANSACTION_NAMESPACE
      )
    );
  }

  private tryAcquireLock(
    scope: ScopeName,
    namespace: string
  ): (() => void) | undefined {
    mkdirSync(namespace, { recursive: true });
    const lockPath = join(namespace, SKILL_TRANSACTION_LOCK);
    const token = `${process.pid}:${randomUUID()}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        symlinkSync(token, lockPath);
        let released = false;
        return () => {
          if (released) return;
          if (readlinkSync(lockPath) !== token) {
            throw new Error(`Skill transaction lock ownership changed: ${scope}`);
          }
          unlinkSync(lockPath);
          released = true;
        };
      } catch (error) {
        if (!isNodeError(error) || error.code !== "EEXIST") throw error;
        const owner = readSkillTransactionLock(lockPath);
        if (owner !== undefined && processIsAlive(owner)) return undefined;
        try {
          unlinkSync(lockPath);
        } catch (unlinkError) {
          if (!isNodeError(unlinkError) || unlinkError.code !== "ENOENT") {
            throw unlinkError;
          }
        }
      }
    }
    return undefined;
  }
}

function persistentSnapshot(
  root: string,
  home: string,
  initialMarker: SkillTransactionMarker,
  releaseLock: () => void = () => undefined
): FilesystemSnapshot {
  let marker = initialMarker;
  let settled = false;
  validateTransactionTargets(home, marker.entries);
  return {
    setProbe(probe) {
      if (settled) throw new Error("Skill transaction is already settled");
      marker = { ...marker, probe };
      writeTransactionMarker(root, marker);
    },
    commit() {
      if (settled) return;
      rmSync(root, { recursive: true, force: true });
      settled = true;
      releaseLock();
    },
    rollback() {
      if (settled) return;
      const entries = prepareTransactionRollback(root, home, marker.entries);
      for (const { entry, target, backup } of [...entries].reverse()) {
        rmSync(target, { recursive: true, force: true });
        if (!entry.existed) continue;
        mkdirSync(dirname(target), { recursive: true });
        cpSync(backup, target, {
          recursive: entry.directory,
          dereference: false,
          preserveTimestamps: true,
        });
      }
      rmSync(root, { recursive: true, force: true });
      settled = true;
      releaseLock();
    },
  };
}

function readSkillTransactionLock(lockPath: string): number | undefined {
  try {
    const match = /^(\d+):[0-9a-f-]+$/.exec(readlinkSync(lockPath));
    return match ? Number(match[1]) : undefined;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function writeTransactionMarker(
  root: string,
  marker: SkillTransactionMarker
): void {
  writeFileAtomic(
    join(root, SKILL_TRANSACTION_MARKER),
    `${JSON.stringify(marker)}\n`
  );
}

function parseTransactionMarker(content: string): SkillTransactionMarker | undefined {
  try {
    const value = JSON.parse(content) as unknown;
    if (!isRecord(value) || !hasOnlyKeys(value, ["markerVersion", "scope", "probe", "entries"])) {
      return undefined;
    }
    if (value.markerVersion !== 1 || !isSkillScope(value.scope)) return undefined;
    const probe = parseTransactionProbe(value.probe);
    if (!probe || !Array.isArray(value.entries)) return undefined;
    const entries = value.entries.map(parseTransactionEntry);
    if (entries.some((entry) => entry === undefined)) return undefined;
    return {
      markerVersion: 1,
      scope: value.scope,
      probe,
      entries: entries as SkillTransactionMarker["entries"],
    };
  } catch {
    return undefined;
  }
}

function parseTransactionProbe(value: unknown): SkillTransactionProbe | undefined {
  if (!isRecord(value) || typeof value.kind !== "string") return undefined;
  if (value.kind === "rollback" && hasOnlyKeys(value, ["kind"])) {
    return { kind: "rollback" };
  }
  if (
    value.kind === "mutation" &&
    hasOnlyKeys(value, ["kind", "receiptId"]) &&
    isOpaqueHash(value.receiptId)
  ) {
    return { kind: "mutation", receiptId: value.receiptId };
  }
  if (
    value.kind === "activation" &&
    hasOnlyKeys(value, ["kind", "securityContextKey", "activationId"]) &&
    typeof value.securityContextKey === "string" &&
    isOpaqueHash(value.activationId)
  ) {
    return {
      kind: "activation",
      securityContextKey: value.securityContextKey,
      activationId: value.activationId,
    };
  }
  return undefined;
}

function parseTransactionEntry(
  value: unknown
): SkillTransactionMarker["entries"][number] | undefined {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["path", "backup", "existed", "directory"]) ||
    typeof value.path !== "string" ||
    !/^\d+$/.test(String(value.backup)) ||
    typeof value.existed !== "boolean" ||
    typeof value.directory !== "boolean"
  ) {
    return undefined;
  }
  return {
    path: value.path,
    backup: String(value.backup),
    existed: value.existed,
    directory: value.directory,
  };
}

function safeTransactionPath(home: string, path: string): string {
  const candidate = relative(home, path);
  if (
    candidate.length === 0 ||
    isAbsolute(candidate) ||
    candidate === ".." ||
    candidate.startsWith(`..${sep}`) ||
    (candidate !== SKILLS_DIR && !candidate.startsWith(`${SKILLS_DIR}${sep}`))
  ) {
    throw new Error("Skill transaction path escapes its scope home");
  }
  return candidate;
}

function verifiedTransactionTarget(home: string, relativePath: string): string {
  if (
    relativePath !== SKILLS_DIR &&
    !relativePath.startsWith(`${SKILLS_DIR}${sep}`)
  ) {
    throw new Error("Skill transaction target is outside the skills tree");
  }
  return verifiedRelativePath(home, relativePath, "target");
}

function verifiedTransactionNamespace(home: string, path: string): string {
  const relativePath = relative(home, path);
  if (
    relativePath !== `.agents${sep}store${sep}${SKILL_TRANSACTION_NAMESPACE}` &&
    relativePath !== `.gonk${sep}store${sep}${SKILL_TRANSACTION_NAMESPACE}` &&
    relativePath !== `store${sep}${SKILL_TRANSACTION_NAMESPACE}`
  ) {
    throw new Error("Skill transaction namespace escapes its scope home");
  }
  return verifiedRelativePath(home, relativePath, "namespace");
}

function verifiedRelativePath(
  home: string,
  relativePath: string,
  label: "home" | "target" | "namespace"
): string {
  let cursor = realpathSync(home);
  const parts = relativePath.split(sep);
  for (let index = 0; index < parts.length; index += 1) {
    cursor = join(cursor, parts[index]!);
    const stat = lstatIfExists(cursor);
    if (!stat) return join(cursor, ...parts.slice(index + 1));
    if (stat.isSymbolicLink()) {
      throw new Error(`Skill transaction ${label} contains a symbolic link`);
    }
    if (index < parts.length - 1 && !stat.isDirectory()) {
      throw new Error(`Skill transaction ${label} parent is not a directory`);
    }
  }
  return cursor;
}

function ensureTransactionHome(home: string): string {
  const requestedHome = resolve(home);
  let ancestor = requestedHome;
  while (!lstatIfExists(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      throw new Error("Cannot resolve skill transaction home ancestor");
    }
    ancestor = parent;
  }
  const canonicalAncestor = realpathSync(ancestor);
  if (!lstatSync(canonicalAncestor).isDirectory()) {
    throw new Error("Skill transaction home ancestor is not a directory");
  }
  const suffix = relative(ancestor, requestedHome);
  const prospectiveHome = suffix
    ? verifiedRelativePath(canonicalAncestor, suffix, "home")
    : canonicalAncestor;
  mkdirSync(prospectiveHome, { recursive: true });
  return suffix
    ? verifiedRelativePath(canonicalAncestor, suffix, "home")
    : canonicalAncestor;
}

function validateTransactionTargets(
  home: string,
  entries: SkillTransactionMarker["entries"]
): void {
  const paths = new Set<string>();
  const backups = new Set<string>();
  for (const entry of entries) {
    if (paths.has(entry.path) || backups.has(entry.backup)) {
      throw new Error("Skill transaction marker contains duplicate entries");
    }
    paths.add(entry.path);
    backups.add(entry.backup);
    verifiedTransactionTarget(home, entry.path);
  }
}

function prepareTransactionRollback(
  root: string,
  home: string,
  entries: SkillTransactionMarker["entries"]
): {
  entry: SkillTransactionMarker["entries"][number];
  target: string;
  backup: string;
}[] {
  return entries.map((entry) => {
    const target = verifiedTransactionTarget(home, entry.path);
    const backup = join(root, entry.backup);
    const backupStat = lstatIfExists(backup);
    if (!entry.existed) {
      if (backupStat) {
        throw new Error(`Unexpected skill transaction backup: ${backup}`);
      }
      return { entry, target, backup };
    }
    if (
      !backupStat ||
      backupStat.isSymbolicLink() ||
      (entry.directory ? !backupStat.isDirectory() : !backupStat.isFile())
    ) {
      throw new Error(`Invalid skill transaction backup: ${backup}`);
    }
    return { entry, target, backup };
  });
}

function lstatIfExists(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function isOpaqueHash(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isSkillScope(value: unknown): value is SkillScope {
  return (
    typeof value === "string" &&
    (SCOPE_RESOLUTION_ORDER as readonly string[]).includes(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[]
): boolean {
  const expected = new Set(keys);
  return Object.keys(value).every((key) => expected.has(key)) &&
    keys.every((key) => key in value);
}

function rollbackOrThrow(
  snapshot: FilesystemSnapshot,
  cause: unknown,
  message: string
): void {
  try {
    snapshot.rollback();
  } catch (rollbackError) {
    throw new AggregateError([cause, rollbackError], message, { cause });
  }
}

function idempotencyConflict(id: string): SkillMutationResult {
  return mutationFailed(
    id,
    "conflict",
    "Idempotency key already used with a different request"
  );
}

function stableFingerprint(value: unknown): string {
  const canonical = JSON.stringify(
    redactAuth(value),
    Object.keys(flattenKeys(value)).sort()
  );
  return hashBytes(Buffer.from(canonical, "utf8"));
}

function flattenKeys(value: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out[key] = true;
      flattenKeys(child, out);
    }
  }
  return out;
}

function redactAuth(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuth);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      if (key === "auth") {
        out.auth = "[AuthContext]";
      } else {
        out[key] = redactAuth(child);
      }
    }
    return out;
  }
  return value;
}

export function createSkillActivationContributor(
  options: SkillActivationContributorOptions
): ContextContributor {
  const contributorId = options.contributorId ?? "gonk.skills.activation";
  return {
    id: contributorId,
    discover(request: Parameters<ContextContributor["discover"]>[0]) {
      if (request.audience !== "model") return [];
      return options.activations().map((receipt) => ({
        candidateId: receipt.activationId,
        contributorId,
        resourceKey: receipt.resourceKey,
        revisionHint: receipt.revision,
        necessity: "required" as const,
        priority: 1000,
        estimatedTokens: 256,
        estimateQuality: "fallback" as const,
      }));
    },
    async resolve(request: Parameters<ContextContributor["resolve"]>[0]) {
      const receipt = options
        .activations()
        .find((entry) => entry.resourceKey === request.candidate.resourceKey);
      if (!receipt) return null;
      const read = await options.registry.read({ id: receipt.id, scope: receipt.scope });
      if (read.status !== "found" || read.skillRevision !== receipt.revision) return null;
      return {
        candidateId: request.candidate.candidateId,
        contributorId,
        resourceKey: receipt.resourceKey,
        revision: receipt.revision,
        necessity: request.candidate.necessity,
        priority: request.candidate.priority,
        audience: "model" as const,
        content: read.content,
        resource: skillResource(receipt.id, receipt.scope),
      };
    },
  };
}

export function projectSkillTools(): readonly SkillToolProjection[] {
  return [
    toolProjection("skill-read", "read", "Read a skill manifest or supporting file."),
    toolProjection("skill-attach", "attach", "Attach a skill file through a host-provided callback."),
    toolProjection("skill-activate", "activate", "Activate a skill through context projection."),
    toolProjection("skill-test", "test", "Run checks through a host-provided callback."),
  ];
}

interface SkillActivateToolInput {
  id: string;
  scope?: SkillScope;
  requestId?: string;
  trigger: SkillActivateRequest["trigger"];
  reason: string;
}

export function createSkillToolDefinitions(
  options: SkillToolDefinitionFactoryOptions
): readonly AnySkillToolDefinition[] {
  const definitions: AnySkillToolDefinition[] = [
    {
      name: "skill-read",
      description: "Read a managed skill manifest or supporting file.",
      category: "skills",
      input: skillToolInputSchema,
      output: skillReadResultSchema,
      validateOutput: "strict",
      inputJsonSchema: skillToolInputJsonSchema,
      handler: async (input, context) => {
        const auth = requireToolAuth(context.auth);
        const found = await options.registry.get({
          id: input.id,
          ...(input.scope === undefined ? {} : { scope: input.scope }),
        });
        if (found.status === "found") {
          const denied = await authorizeSkill(
            auth,
            "skill.read",
            input.id,
            found.skill.scope,
            input
          );
          if (denied) throw new ToolError("AUTHORIZATION_DENIED", denied.reason);
        }
        return { data: await options.registry.read(input) };
      },
      tags: ["skills", "read"],
      approval: "read",
      authorization: { authLevel: "skill.read" },
      authorizationResource: {
        required: true,
        kind: "skill",
        requiredFields: ["target"],
      },
      capabilities: { readsFs: true, idempotent: true },
      hints: {
        mcp: {
          annotations: {
            readOnly: true,
            destructive: false,
            idempotent: true,
            openWorld: false,
          },
        },
      },
    } as ToolDefinition<SkillHostToolInput, SkillReadResult>,
    {
      name: "skill-activate",
      description: "Authorize and activate a managed skill for context projection.",
      category: "skills",
      input: skillActivateToolInputSchema,
      output: skillActivateResultSchema,
      validateOutput: "strict",
      inputJsonSchema: skillActivateToolInputJsonSchema,
      handler: async (input, context) => {
        const auth = requireToolAuth(context.auth);
        return {
          data: await options.registry.activate({
            auth,
            id: input.id,
            ...(input.scope === undefined ? {} : { scope: input.scope }),
            ...(input.requestId === undefined ? {} : { requestId: input.requestId }),
            trigger: input.trigger,
            reason: input.reason,
          }),
        };
      },
      tags: ["skills", "activate"],
      approval: {
        tier: "write",
        reason: "Activation records usage and projects skill content into context",
      },
      authorization: { authLevel: "skill.activate" },
      authorizationResource: {
        required: true,
        kind: "skill",
        requiredFields: ["target"],
      },
      capabilities: { readsFs: true, writesFs: true },
      hints: {
        mcp: {
          annotations: {
            readOnly: false,
            destructive: false,
            idempotent: false,
            openWorld: false,
          },
        },
      },
    } as ToolDefinition<SkillActivateToolInput, SkillActivateResult>,
  ];
  if (options.attach) {
    definitions.push(hostSkillToolDefinition(options.registry, "attach", options.attach));
  }
  if (options.test) {
    definitions.push(hostSkillToolDefinition(options.registry, "test", options.test));
  }
  return definitions;
}

function toolProjection(
  name: string,
  operation: SkillToolProjection["operation"],
  description: string
): SkillToolProjection {
  return {
    name,
    operation,
    description,
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        scope: { type: "string" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  };
}

function hostSkillToolDefinition(
  registry: WritableManagedSkillRegistry,
  operation: "attach" | "test",
  callback: SkillHostToolCallback
): ToolDefinition<SkillHostToolInput, SkillHostToolResult> {
  const authorizationAction: AuthzAction =
    operation === "attach" ? "skill.activate" : "skill.manage";
  return {
    name: `skill-${operation}`,
    description:
      operation === "attach"
        ? "Attach a managed skill file through the configured host callback."
        : "Run managed skill checks through the configured host callback.",
    category: "skills",
    input: skillToolInputSchema,
    output: skillHostToolResultSchema,
    validateOutput: "strict",
    inputJsonSchema: skillToolInputJsonSchema,
    handler: async (input, context) => {
      const auth = requireToolAuth(context.auth);
      const found = await registry.get({
        id: input.id,
        ...(input.scope === undefined ? {} : { scope: input.scope }),
      });
      if (found.status !== "found") {
        return {
          data: {
            status: "failed",
            operation,
            id: input.id,
            message: "Skill not found",
          },
        };
      }
      const denied = await authorizeSkill(
        auth,
        authorizationAction,
        input.id,
        found.skill.scope,
        input
      );
      if (denied) throw new ToolError("AUTHORIZATION_DENIED", denied.reason);
      const result = await callback(input, context);
      if (result.operation !== operation) {
        throw new ToolError("OUTPUT_INVALID", "Host skill callback returned the wrong operation");
      }
      return { data: result };
    },
    tags: ["skills", operation],
    approval:
      operation === "attach"
        ? { tier: "write", reason: "Attaching changes a host surface" }
        : { tier: "exec", reason: "Skill tests may execute host-provided checks" },
    authorization: { authLevel: authorizationAction },
    authorizationResource: {
      required: true,
      kind: "skill",
      requiredFields: ["target"],
    },
    hints: {
      mcp: {
        annotations: {
          readOnly: false,
          destructive: false,
          idempotent: false,
          openWorld: operation === "test",
        },
      },
    },
  };
}

function isOneOf(value: unknown, options: readonly string[]): value is string {
  return typeof value === "string" && options.includes(value);
}

const skillToolInputSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "gonk",
    validate: (value: unknown) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) => ["id", "scope", "path"].includes(key)) &&
      isManagedSkillId((value as { id?: unknown }).id) &&
      ((value as { scope?: unknown }).scope === undefined ||
        isOneOf((value as { scope?: unknown }).scope, SCOPE_RESOLUTION_ORDER)) &&
      ((value as { path?: unknown }).path === undefined ||
        isManagedSkillPath((value as { path?: unknown }).path))
        ? { value: value as { id: string; scope?: SkillScope; path?: string } }
        : { issues: [{ message: "Invalid skill tool input" }] },
  },
};

const skillToolInputJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: [...SCOPE_RESOLUTION_ORDER] },
    path: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

const skillActivateToolInputSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "gonk",
    validate: (value: unknown) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) =>
        ["id", "scope", "requestId", "trigger", "reason"].includes(key)
      ) &&
      isManagedSkillId((value as { id?: unknown }).id) &&
      ((value as { scope?: unknown }).scope === undefined ||
        isOneOf((value as { scope?: unknown }).scope, SCOPE_RESOLUTION_ORDER)) &&
      ((value as { requestId?: unknown }).requestId === undefined ||
        typeof (value as { requestId?: unknown }).requestId === "string") &&
      isOneOf((value as { trigger?: unknown }).trigger, [
        "manual",
        "rule",
        "startup",
        "session",
      ]) &&
      typeof (value as { reason?: unknown }).reason === "string" &&
      (value as { reason: string }).reason.trim().length > 0
        ? { value: value as SkillActivateToolInput }
        : { issues: [{ message: "Invalid skill activate tool input" }] },
  },
};

const skillActivateToolInputJsonSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    scope: { type: "string", enum: [...SCOPE_RESOLUTION_ORDER] },
    requestId: { type: "string" },
    trigger: { type: "string", enum: ["manual", "rule", "startup", "session"] },
    reason: { type: "string" },
  },
  required: ["id", "trigger", "reason"],
  additionalProperties: false,
} as const;

const skillHostToolResultSchema = {
  "~standard": {
    version: 1 as const,
    vendor: "gonk",
    validate: (value: unknown) =>
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).every((key) =>
        ["status", "operation", "id", "message"].includes(key)
      ) &&
      isOneOf((value as { status?: unknown }).status, ["ok", "failed"]) &&
      isOneOf((value as { operation?: unknown }).operation, ["attach", "test"]) &&
      isManagedSkillId((value as { id?: unknown }).id) &&
      typeof (value as { message?: unknown }).message === "string"
        ? { value: value as SkillHostToolResult }
        : { issues: [{ message: "Invalid host skill tool output" }] },
  },
};

function readDefinition(
  scope: ScopeName,
  skillDirectory: VerifiedDirectory,
  directoryId: string
): LoadedSkill {
  const skillDir = skillDirectory.realPath;
  const manifestPath = join(skillDir, MANIFEST);
  const manifestBytes = readVerifiedFile(skillDir, manifestPath);
  const document = parseSkillDocument(
    new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)
  );
  const metadata = parseMetadata(document.frontmatter, directoryId);
  const tree = readSupportingTree(skillDir);
  assertDirectoryUnchanged(skillDirectory);
  const contentHash = hashBytes(Buffer.from(document.body, "utf8"));
  const revision = hashRevision(manifestBytes, tree.files);
  const summary: ManagedSkillSummary = {
    id: metadata.id,
    ...(metadata.name === undefined ? {} : { name: metadata.name }),
    description: metadata.description,
    ...(metadata.version === undefined ? {} : { version: metadata.version }),
    ...(metadata.author === undefined ? {} : { author: metadata.author }),
    ...(metadata.tags === undefined ? {} : { tags: metadata.tags }),
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
  tags?: readonly string[];
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
  if (frontmatter.created_at !== undefined || frontmatter.createdAt !== undefined) {
    requiredIsoTimestamp(
      frontmatter.created_at ?? frontmatter.createdAt,
      "created_at"
    );
  }
  const requirements = parseRequirements(frontmatter);
  const provenance = parseProvenance(frontmatter.provenance);
  const tags = optionalStringArray(frontmatter.tags, "tags");
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
    ...(tags === undefined ? {} : { tags }),
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
          lastUsedAt: requiredIsoTimestamp(
            frontmatter.last_used_at ?? frontmatter.lastUsedAt,
            "last_used_at"
          ),
        }),
    ...((frontmatter.updated_at ?? frontmatter.updatedAt) === undefined
      ? {}
      : {
          updatedAt: requiredIsoTimestamp(
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
  const anchors = parseProvenanceAnchors(value.anchors);
  if (anchors.length === 0) return undefined;
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
          pinnedAt: requiredIsoDateOrTimestamp(
            value.pinned_at ?? value.pinnedAt,
            "provenance.pinned_at"
          ),
        }),
    anchors,
  };
}

function parseProvenanceAnchors(value: unknown): readonly SkillProvenanceAnchor[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("provenance.anchors must be a non-empty array");
  }
  return Object.freeze(
    value.map((anchor): SkillProvenanceAnchor => {
      if (typeof anchor === "string" && anchor.trim().length > 0) {
        return {
          kind: looksLikeFileAnchor(anchor) ? "file" as const : "symbol" as const,
          value: anchor,
        };
      }
      if (
        isFrontmatterRecord(anchor) &&
        (anchor.kind === "file" || anchor.kind === "symbol")
      ) {
        return {
          kind: anchor.kind,
          value: requiredString(anchor.value, "provenance.anchors.value"),
        };
      }
      throw new TypeError("provenance.anchors entries must be strings or typed anchors");
    })
  );
}

function renderProvenance(provenance: SkillProvenance): Record<string, unknown> {
  return {
    ...(provenance.repositoryId === undefined ? {} : { repo: provenance.repositoryId }),
    ...(provenance.packageId === undefined ? {} : { package: provenance.packageId }),
    ...(provenance.version === undefined ? {} : { version: provenance.version }),
    ...(provenance.pinnedAt === undefined ? {} : { pinned_at: provenance.pinnedAt }),
    anchors: provenance.anchors.map((anchor) => ({
      kind: anchor.kind,
      value: anchor.value,
    })),
  };
}

function readSupportingTree(skillDir: string): {
  entries: readonly SkillTreeEntry[];
  files: ReadonlyMap<string, { bytes: Uint8Array; contentHash: string }>;
} {
  const files = new Map<string, { bytes: Uint8Array; contentHash: string }>();
  const walk = (directory: string, prefix: string): SkillTreeEntry[] => {
    const verified = verifyDirectory(skillDir, directory);
    const entries = readdirSync(verified.realPath, {
      withFileTypes: true,
    }).sort((a, b) => compareOpaque(a.name, b.name));
    const out: SkillTreeEntry[] = [];
    for (const entry of entries) {
      if (prefix.length === 0 && entry.name === MANIFEST) continue;
      if (entry.isSymbolicLink()) {
        throw new TypeError("Symbolic links are not valid skill files");
      }
      const absolutePath = join(verified.realPath, entry.name);
      const path = prefix.length === 0 ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        const child = verifyDirectory(skillDir, absolutePath);
        out.push({
          kind: "directory",
          name: entry.name,
          path,
          children: walk(child.realPath, path),
        });
        continue;
      }
      if (!entry.isFile()) {
        throw new TypeError("Unsupported supporting file type");
      }
      const bytes = readVerifiedFile(skillDir, absolutePath);
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
    assertDirectoryUnchanged(verified);
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

interface VerifiedDirectory {
  path: string;
  realPath: string;
  dev: number;
  ino: number;
}

function verifyDirectory(root: string, path: string): VerifiedDirectory {
  const before = lstatSync(path);
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new TypeError("Skill directory must be a real directory");
  }
  const realRoot = realpathSync(root);
  const realPath = realpathSync(path);
  if (!isInside(realRoot, realPath)) {
    throw new TypeError("Skill directory escapes its root");
  }
  const after = lstatSync(path);
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    before.dev !== after.dev ||
    before.ino !== after.ino ||
    realpathSync(path) !== realPath
  ) {
    throw new TypeError("Skill directory changed during verification");
  }
  return { path, realPath, dev: before.dev, ino: before.ino };
}

function assertDirectoryUnchanged(directory: VerifiedDirectory): void {
  const after = lstatSync(directory.path);
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.dev !== directory.dev ||
    after.ino !== directory.ino ||
    realpathSync(directory.path) !== directory.realPath
  ) {
    throw new TypeError("Skill directory changed during read");
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

function captureResolveRequest(
  request: SkillResolveRequest
): Readonly<SkillResolveRequest> {
  return Object.freeze({
    id: request.id,
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

function requiredIsoTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label);
  if (!isIsoTimestamp(timestamp)) {
    throw new TypeError(`${label} must be an ISO 8601 timestamp`);
  }
  return timestamp;
}

function requiredIsoDateOrTimestamp(value: unknown, label: string): string {
  const timestamp = requiredString(value, label);
  if (!isIsoDateOrTimestamp(timestamp)) {
    throw new TypeError(`${label} must be an ISO 8601 date or timestamp`);
  }
  return timestamp;
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
