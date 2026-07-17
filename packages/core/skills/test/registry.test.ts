import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";

import type { AuthContext } from "@gonk/auth";
import {
  collectToolOutcome,
  makeBaseContext,
  ToolRegistry,
} from "@gonk/tool-registry";
import { afterEach, describe, expect, it } from "vitest";

import {
  createSkillActivationContributor,
  createSkillToolDefinitions,
  FilesystemSkillLifecycleJournal,
  managedSkillDetailSchema,
  FilesystemManagedSkillRegistry,
  projectSkillTools,
  skillActivateResultSchema,
  skillActivationJournalRecordSchema,
  skillActivationReceiptSchema,
  skillCreateRequestSchema,
  skillFreshnessResultSchema,
  skillGetRequestSchema,
  skillListResultSchema,
  skillMutationResultSchema,
  skillMutationJournalRecordSchema,
  skillMutationReceiptSchema,
  skillResolveRequestSchema,
  skillToolProjectionSchema,
  type SkillArchiveRequest,
  type SkillActivationReceipt,
  type SkillLifecycleJournal,
  type SkillPatchRequest,
} from "../src/index.ts";
import { makeFilesystemHarness, type FilesystemHarness } from "./harness.ts";

const harnesses: FilesystemHarness[] = [];
const make = (...args: Parameters<typeof makeFilesystemHarness>) => {
  const harness = makeFilesystemHarness(...args);
  harnesses.push(harness);
  return harness;
};

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

describe("closed Standard Schema contracts", () => {
  it("accepts valid requests and rejects unknown fields and open-union values", () => {
    expect(valid(skillGetRequestSchema, { id: "good", scope: "project" })).toBe(true);
    expect(valid(skillGetRequestSchema, { id: "good", scope: "future" })).toBe(false);
    expect(valid(skillGetRequestSchema, { id: "good", extra: true })).toBe(false);
    expect(valid(skillGetRequestSchema, { id: "../escape" })).toBe(false);
    expect(valid(skillResolveRequestSchema, { id: "good" })).toBe(true);
    expect(valid(skillResolveRequestSchema, { id: "good", scope: "global" })).toBe(false);
    expect(
      valid(skillFreshnessResultSchema, { status: "fresh", checkedAt: "not-a-date" })
    ).toBe(false);
    expect(
      valid(skillFreshnessResultSchema, {
        status: "fresh",
        checkedAt: "2026-02-31T12:00:00Z",
      })
    ).toBe(false);
    expect(
      valid(skillFreshnessResultSchema, { status: "fresh", checkedAt: "2026-07-16" })
    ).toBe(false);
    const create = {
      auth: authContext(),
      idempotencyKey: "create-schema",
      id: "created",
      scope: "project",
      description: "created",
      body: "created body",
      tags: ["workflow", "review"],
      provenance: {
        repositoryId: "nightwork-dev/gonk",
        anchors: [{ kind: "symbol", value: "ManagedSkillRegistry" }],
      },
    };
    expect(valid(skillCreateRequestSchema, create)).toBe(true);
    expect(valid(skillCreateRequestSchema, { ...create, extra: true })).toBe(false);
  });

  it("rejects leaked fields at nested and result boundaries", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "clean" });
    const result = await harness.registry.list();
    expect(valid(skillListResultSchema, result)).toBe(true);
    expect(
      valid(skillListResultSchema, {
        ...result,
        skills: [{ ...result.skills[0], secret: "leak" }],
      })
    ).toBe(false);
    const detail = await harness.registry.get({ id: "clean" });
    expect(detail.status).toBe("found");
    if (detail.status === "found") {
      expect(valid(managedSkillDetailSchema, detail.skill)).toBe(true);
      expect(detail.skill).not.toHaveProperty("skillDir");
      expect(detail.skill).not.toHaveProperty("manifestPath");
      expect(valid(managedSkillDetailSchema, { ...detail.skill, extra: true })).toBe(false);
    }
  });
});

describe("authorized filesystem mutations", () => {
  it("fails closed when auth denies create before writing", async () => {
    const harness = make();
    const result = await harness.registry.create({
      auth: authContext("deny"),
      idempotencyKey: "create-denied",
      id: "blocked",
      scope: "project",
      description: "blocked",
      body: "blocked",
    });
    expect(result.status).toBe("failed");
    if (result.status !== "failed") throw new Error("expected failed create");
    expect(result.reason).toBe("denied");
    expect((await harness.registry.get({ id: "blocked" })).status).toBe("not-found");
  });

  it("creates active and staged skills without exposing staged material to reads", async () => {
    const harness = make();
    const active = await harness.registry.create({
      auth: authContext(),
      idempotencyKey: "create-active",
      id: "live",
      scope: "project",
      description: "live skill",
      body: "live body",
      tags: ["workflow", "review"],
      provenance: {
        repositoryId: "nightwork-dev/gonk",
        packageId: "@gonk/skills",
        version: "0.3.0",
        pinnedAt: "2026-07-16",
        anchors: [
          { kind: "symbol", value: "WritableManagedSkillRegistry" },
          { kind: "file", value: "packages/core/skills/src/types.ts" },
        ],
      },
      files: [{ path: "refs/a.md", content: "A" }],
    });
    expect(active.status).toBe("ok");
    expect(valid(skillMutationResultSchema, active)).toBe(true);
    expect((await harness.registry.read({ id: "live", path: "refs/a.md" })).status).toBe("found");
    const created = await harness.registry.get({ id: "live" });
    expect(created.status).toBe("found");
    if (created.status !== "found") throw new Error("expected created skill");
    expect(created.skill.tags).toEqual(["workflow", "review"]);
    expect(created.skill.provenance).toEqual({
      repositoryId: "nightwork-dev/gonk",
      packageId: "@gonk/skills",
      version: "0.3.0",
      pinnedAt: "2026-07-16",
      anchors: [
        { kind: "symbol", value: "WritableManagedSkillRegistry" },
        { kind: "file", value: "packages/core/skills/src/types.ts" },
      ],
    });
    expect(valid(managedSkillDetailSchema, created.skill)).toBe(true);

    const staged = await harness.registry.create({
      auth: authContext(),
      idempotencyKey: "create-staged",
      id: "drafted",
      scope: "project",
      description: "drafted skill",
      body: "drafted body",
      staged: true,
    });
    expect(staged.status).toBe("ok");
    expect(await harness.registry.get({ id: "drafted" })).toEqual({
      status: "not-found",
      id: "drafted",
    });
  });

  it("returns structured revision conflicts and idempotency mismatch conflicts", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "editable", body: "old body" });
    const current = await revisionOf(harness, "editable");
    const conflict = await harness.registry.patch({
      auth: authContext(),
      idempotencyKey: "patch-conflict",
      expectedRevision: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
      id: "editable",
      find: "old",
      replace: "new",
    });
    expect(conflict.status).toBe("failed");
    if (conflict.status !== "failed") throw new Error("expected conflict");
    expect(conflict.reason).toBe("conflict");
    expect(conflict.currentRevision).toBe(current);
    expect(conflict.affectedPaths).toEqual(["SKILL.md"]);

    const ok = await harness.registry.patch({
      auth: authContext(),
      idempotencyKey: "patch-once",
      expectedRevision: current,
      id: "editable",
      find: "old",
      replace: "new",
    });
    expect(ok.status).toBe("ok");
    const replay = await harness.registry.patch({
      auth: authContext(),
      idempotencyKey: "patch-once",
      expectedRevision: current,
      id: "editable",
      find: "old",
      replace: "new",
    });
    expect(replay).toEqual(ok);
    const mismatch = await harness.registry.patch({
      auth: authContext(),
      idempotencyKey: "patch-once",
      expectedRevision: current,
      id: "editable",
      find: "new",
      replace: "again",
    });
    expect(mismatch.status).toBe("failed");
    if (mismatch.status !== "failed") throw new Error("expected mismatch");
    expect(mismatch.reason).toBe("conflict");
  });

  it("authorizes every replay and namespaces idempotency by operation and principal", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "replay-safe", body: "old body" });
    const initial = await revisionOf(harness, "replay-safe");
    const request: SkillPatchRequest = {
      auth: authContext("allow", "agent:one"),
      idempotencyKey: "shared-key",
      expectedRevision: initial,
      id: "replay-safe",
      find: "old",
      replace: "new",
    };
    const first = await harness.registry.patch(request);
    expect(first.status).toBe("ok");
    expect(await harness.registry.patch(request)).toEqual(first);

    const deniedReplay = await harness.registry.patch({
      ...request,
      auth: authContext("deny", "agent:one"),
    });
    expect(deniedReplay).toMatchObject({ status: "failed", reason: "denied" });

    const otherPrincipal = await harness.registry.patch({
      ...request,
      auth: authContext("allow", "agent:two"),
    });
    expect(otherPrincipal).toMatchObject({ status: "failed", reason: "conflict" });

    const afterPatch = await revisionOf(harness, "replay-safe");
    const pin = await harness.registry.pin({
      auth: authContext("allow", "agent:one"),
      idempotencyKey: "shared-key",
      expectedRevision: afterPatch,
      id: "replay-safe",
      pinned: true,
    });
    expect(pin.status).toBe("ok");

    await harness.seed({ scope: "project", id: "archive-replay" });
    const archiveRequest: SkillArchiveRequest = {
      auth: authContext("allow", "agent:one"),
      idempotencyKey: "archive-replay-key",
      expectedRevision: await revisionOf(harness, "archive-replay"),
      id: "archive-replay",
    };
    const archived = await harness.registry.archive(archiveRequest);
    expect(archived.status).toBe("ok");
    expect(await harness.registry.archive(archiveRequest)).toEqual(archived);
  });

  it("recovers authorized mutation replay and receipts after process restart", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "durable-replay", body: "old body" });
    const request: SkillPatchRequest = {
      auth: authContext("allow", "agent:durable"),
      idempotencyKey: "durable-secret-key",
      expectedRevision: await revisionOf(harness, "durable-replay"),
      id: "durable-replay",
      find: "old",
      replace: "new",
    };
    const first = await harness.registry.patch(request);
    expect(first.status).toBe("ok");

    const restarted = new FilesystemManagedSkillRegistry({ env: harness.env });
    expect(await restarted.patch(request)).toEqual(first);

    const recovered = await restarted.getMutationReceipt({
      auth: authContext("allow", "agent:durable"),
      operation: "patch",
      idempotencyKey: request.idempotencyKey,
    });
    expect(recovered.status).toBe("found");
    if (recovered.status !== "found") throw new Error("expected mutation receipt");
    expect(recovered.receipt.result).toEqual(first);
    expect(valid(skillMutationReceiptSchema, recovered.receipt)).toBe(true);
    expect(recovered.receipt.requestFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);

    expect(
      await restarted.getMutationReceipt({
        auth: authContext("allow", "agent:other"),
        operation: "patch",
        idempotencyKey: request.idempotencyKey,
      })
    ).toEqual({ status: "not-found" });
    expect(
      await restarted.getMutationReceipt({
        auth: authContext("deny", "agent:durable"),
        operation: "patch",
        idempotencyKey: request.idempotencyKey,
      })
    ).toMatchObject({ status: "failed", reason: "denied" });
    expect(
      await restarted.patch({
        ...request,
        auth: authContext("allow", "agent:other"),
      })
    ).toMatchObject({ status: "failed", reason: "conflict" });

    const journalPath = join(
      harness.home("project"),
      ".agents",
      "store",
      "skills.lifecycle",
      "kv.json"
    );
    const raw = readFileSync(journalPath, "utf8");
    expect(raw).not.toContain(request.idempotencyKey);
    expect(raw).not.toContain("authorize");
    const persisted = JSON.parse(raw) as Record<string, { value?: unknown }>;
    const record = Object.values(persisted)
      .map((entry) => entry.value)
      .find(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as { kind?: unknown }).kind === "skill-mutation-journal"
      );
    expect(valid(skillMutationJournalRecordSchema, record)).toBe(true);
    expect(
      valid(skillMutationJournalRecordSchema, {
        ...(record as Record<string, unknown>),
        extra: true,
      })
    ).toBe(false);
    expect(readdirSync(dirname(journalPath)).some((name) => name.includes(".tmp"))).toBe(false);

    const persistedEntry = Object.entries(persisted).find(
      ([, entry]) => entry.value === record
    );
    if (!persistedEntry) throw new Error("expected persisted mutation entry");
    persisted[persistedEntry[0]] = {
      value: { ...(record as Record<string, unknown>), extra: true },
    };
    writeFileSync(journalPath, JSON.stringify(persisted), "utf8");
    const recoveredFromCorruptJournal = new FilesystemManagedSkillRegistry({
      env: harness.env,
    });
    expect(
      await recoveredFromCorruptJournal.getMutationReceipt({
        auth: authContext("allow", "agent:durable"),
        operation: "patch",
        idempotencyKey: request.idempotencyKey,
      })
    ).toEqual({ status: "not-found" });
  });

  it("rolls back a mutation when its journal commit fails and retries after restart", async () => {
    const harness = make();
    const crash = pendingTransactionCrashImage(harness, "journal-rollback");
    let concurrentConstructionObservedPendingState = false;
    const registry = new FilesystemManagedSkillRegistry({
      env: harness.env,
      lifecycleJournal: journalFailingOnce(
        harness.env,
        "mutation",
        () => {
          crash.capture();
          expect(
            () => new FilesystemManagedSkillRegistry({ env: harness.env })
          ).toThrow("Another skill transaction is active in scope: project");
          concurrentConstructionObservedPendingState = existsSync(
            join(harness.home("project"), "skills", "journal-rollback")
          );
        }
      ),
    });
    const request = {
      auth: authContext("allow", "agent:mutation-rollback"),
      idempotencyKey: "mutation-journal-failure",
      id: "journal-rollback",
      scope: "project" as const,
      description: "journal rollback",
      body: "must not survive a failed receipt write",
    };

    await expect(registry.create(request)).rejects.toThrow(
      "injected mutation journal failure"
    );
    expect(concurrentConstructionObservedPendingState).toBe(true);
    expect(await registry.get({ id: request.id, scope: request.scope })).toEqual({
      status: "not-found",
      id: request.id,
    });
    expect(
      existsSync(join(harness.home("project"), "skills", request.id))
    ).toBe(false);

    crash.restore();
    expect(
      existsSync(join(harness.home("project"), "skills", request.id))
    ).toBe(true);
    const restarted = new FilesystemManagedSkillRegistry({ env: harness.env });
    expect(await restarted.get({ id: request.id, scope: request.scope })).toEqual({
      status: "not-found",
      id: request.id,
    });
    const retried = await restarted.create(request);
    expect(retried.status).toBe("ok");
    expect(
      await restarted.getMutationReceipt({
        auth: request.auth,
        operation: "create",
        idempotencyKey: request.idempotencyKey,
      })
    ).toMatchObject({ status: "found", receipt: { result: retried } });
  });

  it("rejects pinned edits and archives even when untyped callers pass allowPinned", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "pinned",
      body: "do not edit",
      frontmatter: "id: pinned\ndescription: pinned\npinned: true",
    });
    const revision = await revisionOf(harness, "pinned");
    const edit = await harness.registry.patch({
      auth: authContext(),
      idempotencyKey: "patch-pinned",
      expectedRevision: revision,
      id: "pinned",
      find: "do",
      replace: "please",
      allowPinned: true,
    } as unknown as SkillPatchRequest);
    expect(edit.status).toBe("failed");
    if (edit.status !== "failed") throw new Error("expected pinned edit failure");
    expect(edit.reason).toBe("conflict");
    const archive = await harness.registry.archive({
      auth: authContext(),
      idempotencyKey: "archive-pinned",
      expectedRevision: revision,
      id: "pinned",
      allowPinned: true,
    } as unknown as SkillArchiveRequest);
    expect(archive.status).toBe("failed");
    if (archive.status !== "failed") throw new Error("expected pinned archive failure");
    expect(archive.reason).toBe("conflict");
  });

  it("patches body plus supporting file writes and removals through one real directory rewrite", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "files-mutate",
      body: "old body",
      files: { "remove.txt": "bye", "keep.txt": "stay" },
    });
    const revision = await revisionOf(harness, "files-mutate");
    const result = await harness.registry.patch({
      auth: authContext(),
      idempotencyKey: "patch-files",
      expectedRevision: revision,
      id: "files-mutate",
      find: "old",
      replace: "new",
      writeFiles: [{ path: "added/readme.md", content: "added" }],
      removeFiles: ["remove.txt"],
    });
    expect(result.status).toBe("ok");
    expect((await harness.registry.read({ id: "files-mutate" })).status).toBe("found");
    expect((await harness.registry.read({ id: "files-mutate", path: "added/readme.md" })).status).toBe("found");
    expect(await harness.registry.read({ id: "files-mutate", path: "remove.txt" })).toMatchObject({
      status: "not-found",
      reason: "file-not-found",
    });
  });

  it("validates archived content before atomic restore and cleans failed temp state", async () => {
    const harness = make();
    const archiveId = "broken-2026-07-16T00-00-00-000Z";
    const skillsRoot = join(harness.home("project"), "skills");
    const archiveDir = join(skillsRoot, ".archive", archiveId);
    mkdirSync(archiveDir, { recursive: true });
    writeFileSync(
      join(archiveDir, "SKILL.md"),
      "---\nid: wrong-id\ndescription: broken\n---\nbroken\n",
      "utf8"
    );

    const result = await harness.registry.restore({
      auth: authContext(),
      idempotencyKey: "restore-broken",
      id: "broken",
      scope: "project",
      archiveId,
    });
    expect(result).toMatchObject({ status: "failed", reason: "invalid" });
    expect(existsSync(join(skillsRoot, "broken"))).toBe(false);
    expect(existsSync(join(archiveDir, ".restored"))).toBe(false);
    expect(
      readdirSync(skillsRoot).filter((name) => name.startsWith(".broken.restore-"))
    ).toEqual([]);
  });

  it("requires an injected approval provider before promoting staged skills", async () => {
    const harness = make();
    await harness.registry.create({
      auth: authContext(),
      idempotencyKey: "stage-for-promotion",
      id: "needs-approval",
      scope: "project",
      description: "needs approval",
      body: "needs approval body",
      staged: true,
    });
    const denied = await harness.registry.promote({
      auth: authContext(),
      idempotencyKey: "promote-denied",
      id: "needs-approval",
      approval: approval(),
    });
    expect(denied.status).toBe("failed");
    if (denied.status !== "failed") throw new Error("expected promotion denial");
    expect(denied.reason).toBe("denied");
    expect((await harness.registry.get({ id: "needs-approval" })).status).toBe("not-found");

    const approved = new FilesystemManagedSkillRegistry({
      env: harness.env,
      promotionApprovalProvider: {
        decide: () => ({ outcome: "approved", reason: "reviewed" }),
      },
    });
    const promoted = await approved.promote({
      auth: authContext(),
      idempotencyKey: "promote-approved",
      id: "needs-approval",
      approval: approval(),
    });
    expect(promoted.status).toBe("ok");
    expect((await approved.get({ id: "needs-approval" })).status).toBe("found");
  });

  it("activates only ready skills and projects activation through a context contributor", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "ready", body: "ready body" });
    await harness.seed({
      scope: "project",
      id: "missing-tools",
      frontmatter: [
        "id: missing-tools",
        "description: missing tools",
        "requirements:",
        "  tools:",
        "    - external-tool",
      ].join("\n"),
    });
    const missing = await harness.registry.activate({
      auth: authContext(),
      id: "missing-tools",
      trigger: "manual",
      reason: "test",
    });
    expect(missing.status).toBe("missing-requirements");

    const result = await harness.registry.activate({
      auth: authContext(),
      id: "ready",
      requestId: "activation-1",
      trigger: "manual",
      reason: "test",
    });
    expect(result.status).toBe("ready");
    expect(valid(skillActivateResultSchema, result)).toBe(true);
    if (result.status !== "ready") throw new Error("expected ready activation");
    const contributor = createSkillActivationContributor({
      registry: harness.registry,
      activations: () => [result.receipt],
    });
    const discovered = await contributor.discover({
      requestId: "ctx",
      audience: "model",
      principal: authContext().principal,
    });
    expect(discovered).toHaveLength(1);
    const resolved = await contributor.resolve({
      requestId: "ctx",
      audience: "model",
      principal: authContext().principal,
      candidate: discovered[0]!,
    });
    expect(resolved?.content.trim()).toBe("ready body");
  });

  it("recovers multiple same-request activation receipts and resolves them after restart", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "restart-one", body: "one body" });
    await harness.seed({ scope: "project", id: "restart-two", body: "two body" });
    const auth = authContext("allow", "agent:activation-restart");
    const first = await harness.registry.activate({
      auth,
      id: "restart-one",
      requestId: "compiler-request",
      trigger: "manual",
      reason: "restart test",
    });
    const second = await harness.registry.activate({
      auth,
      id: "restart-two",
      requestId: "compiler-request",
      trigger: "manual",
      reason: "restart test",
    });
    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    if (first.status !== "ready" || second.status !== "ready") {
      throw new Error("expected ready activations");
    }
    expect(first.receipt.activationId).not.toBe(second.receipt.activationId);
    expect(valid(skillActivationReceiptSchema, first.receipt)).toBe(true);
    expect(valid(skillActivationReceiptSchema, second.receipt)).toBe(true);

    const restarted = new FilesystemManagedSkillRegistry({ env: harness.env });
    const listed = await restarted.listActivationReceipts({ auth });
    expect(listed.receipts).toHaveLength(2);
    expect(new Set(listed.receipts.map(({ id }) => id))).toEqual(
      new Set(["restart-one", "restart-two"])
    );
    expect(
      await restarted.getActivationReceipt({
        auth,
        activationId: first.receipt.activationId,
      })
    ).toEqual({ status: "found", receipt: first.receipt });
    expect(
      await restarted.listActivationReceipts({
        auth: authContext("allow", "agent:other"),
      })
    ).toEqual({ status: "ok", receipts: [] });
    expect(
      await restarted.getActivationReceipt({
        auth: authContext("allow", "agent:other"),
        activationId: first.receipt.activationId,
      })
    ).toEqual({ status: "not-found" });

    const contributor = createSkillActivationContributor({
      registry: restarted,
      activations: () => listed.receipts,
    });
    const candidates = await contributor.discover({
      requestId: "restarted-context",
      audience: "model",
      principal: auth.principal,
    });
    expect(candidates).toHaveLength(2);
    const contents = new Set<string>();
    for (const candidate of candidates) {
      const resolved = await contributor.resolve({
        requestId: "restarted-context",
        audience: "model",
        principal: auth.principal,
        candidate,
      });
      if (resolved) contents.add(resolved.content.trim());
    }
    expect(contents).toEqual(new Set(["one body", "two body"]));

    const journalPath = join(
      harness.home("project"),
      ".agents",
      "store",
      "skills.lifecycle",
      "kv.json"
    );
    const persisted = JSON.parse(readFileSync(journalPath, "utf8")) as Record<
      string,
      { value?: unknown }
    >;
    const activationRecords = Object.values(persisted)
      .map((entry) => entry.value)
      .filter(
        (value) =>
          value !== null &&
          typeof value === "object" &&
          (value as { kind?: unknown }).kind === "skill-activation-journal"
      );
    expect(activationRecords).toHaveLength(2);
    expect(
      activationRecords.every((record) =>
        valid(skillActivationJournalRecordSchema, record)
      )
    ).toBe(true);
  });

  it("does not return ready or persist a receipt when activation usage is denied", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "usage-denied", body: "body" });
    const base = authContext("allow", "agent:usage-denied");
    let activationChecks = 0;
    const auth: AuthContext = {
      principal: base.principal,
      authorize: async (request) => {
        if (request.action === "skill.activate") {
          activationChecks += 1;
          if (activationChecks === 2) {
            return { outcome: "deny", reason: "usage write denied" };
          }
        }
        return { outcome: "allow", reason: "test allow" };
      },
    };
    const result = await harness.registry.activate({
      auth,
      id: "usage-denied",
      requestId: "usage-denied-request",
      trigger: "manual",
      reason: "test",
    });
    expect(result).toMatchObject({
      status: "failed",
      reason: "denied",
      message: "usage write denied",
    });
    const skill = await harness.registry.get({ id: "usage-denied" });
    expect(skill.status === "found" ? skill.skill.useCount : undefined).toBeUndefined();
    expect(await harness.registry.listActivationReceipts({ auth })).toEqual({
      status: "ok",
      receipts: [],
    });
  });

  it("rolls back activation usage when receipt persistence fails and retries after restart", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "activation-rollback",
      body: "activation rollback body",
    });
    const auth = authContext("allow", "agent:activation-rollback");
    const before = await harness.registry.get({
      id: "activation-rollback",
      scope: "project",
    });
    if (before.status !== "found") throw new Error("expected seeded skill");
    const crash = pendingTransactionCrashImage(harness, "activation-rollback");
    const registry = new FilesystemManagedSkillRegistry({
      env: harness.env,
      lifecycleJournal: journalFailingOnce(
        harness.env,
        "activation",
        crash.capture
      ),
    });
    const request = {
      auth,
      id: "activation-rollback",
      requestId: "activation-journal-failure",
      trigger: "manual" as const,
      reason: "receipt failure rollback",
    };

    expect(await registry.activate(request)).toMatchObject({
      status: "failed",
      reason: "invalid",
      message: "Activation receipt could not be persisted",
    });
    const rolledBack = await registry.get({ id: request.id, scope: "project" });
    expect(rolledBack.status).toBe("found");
    if (rolledBack.status !== "found") throw new Error("expected rolled back skill");
    expect(rolledBack.skill.revision).toBe(before.skill.revision);
    expect(rolledBack.skill.useCount).toBeUndefined();

    crash.restore();
    const interrupted = await registry.get({ id: request.id, scope: "project" });
    expect(interrupted.status === "found" ? interrupted.skill.useCount : undefined).toBe(1);
    const restarted = new FilesystemManagedSkillRegistry({ env: harness.env });
    const recovered = await restarted.get({ id: request.id, scope: "project" });
    expect(recovered.status).toBe("found");
    if (recovered.status !== "found") throw new Error("expected recovered skill");
    expect(recovered.skill.revision).toBe(before.skill.revision);
    expect(recovered.skill.useCount).toBeUndefined();
    expect(await restarted.listActivationReceipts({ auth })).toEqual({
      status: "ok",
      receipts: [],
    });
    const retried = await restarted.activate(request);
    expect(retried.status).toBe("ready");
    const after = await restarted.get({ id: request.id, scope: "project" });
    expect(after.status === "found" ? after.skill.useCount : undefined).toBe(1);
    expect((await restarted.listActivationReceipts({ auth })).receipts).toHaveLength(1);
  });

  it("projects distinct operations and registers only executable tool definitions", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "tool-ready", body: "tool body" });
    expect(projectSkillTools().map(({ operation }) => operation)).toEqual([
      "read",
      "attach",
      "activate",
      "test",
    ]);
    expect(projectSkillTools().map(({ name }) => name)).not.toContain("skill-invoke");
    expect(projectSkillTools().every((tool) => valid(skillToolProjectionSchema, tool))).toBe(true);

    const definitions = createSkillToolDefinitions({ registry: harness.registry });
    expect(definitions.map(({ name }) => name)).toEqual([
      "skill-read",
      "skill-activate",
    ]);
    expect(definitions.every((tool) => tool.inputJsonSchema?.additionalProperties === false)).toBe(true);
    expect(definitions.map(({ name }) => name)).not.toContain("skill-attach");
    expect(definitions.map(({ name }) => name)).not.toContain("skill-test");

    const registry = executableToolRegistry();
    registry.register([...definitions]);
    const missingAuth = await collectToolOutcome(
      registry.invoke("skill-read", { id: "tool-ready" }, makeBaseContext())
    );
    expect(missingAuth).toMatchObject({
      ok: false,
      code: "AUTHORIZATION_DENIED",
    });

    const context = makeBaseContext({ auth: authContext() });
    const read = await collectToolOutcome(
      registry.invoke("skill-read", { id: "tool-ready" }, context)
    );
    expect(read).toMatchObject({
      ok: true,
      data: { status: "found", id: "tool-ready", content: "tool body\n" },
    });
    const activate = await collectToolOutcome(
      registry.invoke(
        "skill-activate",
        {
          id: "tool-ready",
          requestId: "tool-activation",
          trigger: "manual",
          reason: "registry test",
        },
        context
      )
    );
    expect(activate).toMatchObject({
      ok: true,
      data: {
        status: "ready",
        receipt: { activationId: expect.stringMatching(/^sha256:[0-9a-f]{64}$/) },
      },
    });
  });

  it("registers and invokes host attach/test tools only when callbacks exist", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "hosted" });
    const called: string[] = [];
    const definitions = createSkillToolDefinitions({
      registry: harness.registry,
      attach: async (input) => {
        called.push(`attach:${input.id}`);
        return {
          status: "ok",
          operation: "attach",
          id: input.id,
          message: "attached",
        };
      },
      test: async (input) => {
        called.push(`test:${input.id}`);
        return {
          status: "ok",
          operation: "test",
          id: input.id,
          message: "passed",
        };
      },
    });
    expect(definitions.map(({ name }) => name)).toEqual([
      "skill-read",
      "skill-activate",
      "skill-attach",
      "skill-test",
    ]);
    const registry = executableToolRegistry();
    registry.register([...definitions]);
    const context = makeBaseContext({ auth: authContext() });
    expect(
      await collectToolOutcome(
        registry.invoke("skill-attach", { id: "hosted" }, context)
      )
    ).toMatchObject({ ok: true, data: { status: "ok", operation: "attach" } });
    expect(
      await collectToolOutcome(
        registry.invoke("skill-test", { id: "hosted" }, context)
      )
    ).toMatchObject({ ok: true, data: { status: "ok", operation: "test" } });
    expect(called).toEqual(["attach:hosted", "test:hosted"]);
  });
});

describe("filesystem safety and parsing", () => {
  it("snapshots static scope inputs at construction", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "anchored" });
    harness.env.projectRoot = join(harness.root, "different-project");
    expect((await harness.registry.get({ id: "anchored" })).status).toBe("found");
  });

  it("rebinds the persona tier through the live resolver", async () => {
    const harness = make();
    const personaA = join(harness.root, "persona-a");
    const personaB = join(harness.root, "persona-b");
    writeSkill(personaA, "persona-live", "persona A");
    writeSkill(personaB, "persona-live", "persona B");
    let active = personaA;
    const registry = new FilesystemManagedSkillRegistry({
      env: {
        cwd: harness.home("directory"),
        homeRoot: harness.home("global"),
        projectRoot: harness.home("project"),
        resolvePersonaHome: () => active,
      },
    });
    const a = await registry.get({ id: "persona-live" });
    expect(a.status === "found" ? a.skill.body.trim() : undefined).toBe("persona A");
    active = personaB;
    const b = await registry.get({ id: "persona-live" });
    expect(b.status === "found" ? b.skill.body.trim() : undefined).toBe("persona B");
  });

  it("rejects traversal, absolute paths, reserved IDs, and malformed IDs before I/O", async () => {
    const registry = make().registry;
    await expect(registry.get({ id: "../escape" })).rejects.toThrow("Invalid SkillGetRequest");
    await expect(registry.read({ id: ".staging" })).rejects.toThrow("Invalid SkillReadRequest");
    await expect(registry.read({ id: "valid", path: "../secret" })).rejects.toThrow(
      "Invalid SkillReadRequest"
    );
    await expect(registry.read({ id: "valid", path: "/tmp/secret" })).rejects.toThrow(
      "Invalid SkillReadRequest"
    );
  });

  it("skips malformed frontmatter without hiding valid neighbors", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "valid" });
    const bad = join(harness.home("project"), "skills", "bad");
    mkdirSync(bad, { recursive: true });
    writeFileSync(join(bad, "SKILL.md"), "---\ndescription: [unterminated\nbody", "utf8");

    const result = await harness.registry.list();
    expect(result.skills.map(({ id }) => id)).toEqual(["valid"]);
  });

  it("rejects invalid metadata timestamps", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "bad-time",
      frontmatter: "id: bad-time\ndescription: invalid time\nupdated_at: yesterday",
    });
    expect(await harness.registry.get({ id: "bad-time" })).toEqual({
      status: "not-found",
      id: "bad-time",
    });

    await harness.seed({
      scope: "project",
      id: "date-only-update",
      frontmatter:
        "id: date-only-update\ndescription: invalid operational date\nupdated_at: 2026-07-16",
    });
    expect(await harness.registry.get({ id: "date-only-update" })).toEqual({
      status: "not-found",
      id: "date-only-update",
    });
  });

  it("rejects manifest and supporting-file symlinks, including in-tree links", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "linked", files: { "real.txt": "safe" } });
    const dir = join(harness.home("project"), "skills", "linked");
    symlinkSync(join(dir, "real.txt"), join(dir, "alias.txt"));
    expect((await harness.registry.get({ id: "linked" })).status).toBe("not-found");

    const target = join(harness.root, "outside.md");
    writeFileSync(target, "outside", "utf8");
    const manifestDir = join(harness.home("project"), "skills", "manifest-link");
    mkdirSync(manifestDir, { recursive: true });
    symlinkSync(target, join(manifestDir, "SKILL.md"));
    expect((await harness.registry.get({ id: "manifest-link" })).status).toBe("not-found");
  });

  it("does not expose needs_audit material from an active directory", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "audit",
      frontmatter: "id: audit\ndescription: staged\nneeds_audit: true",
    });
    expect(await harness.registry.get({ id: "audit" })).toEqual({
      status: "not-found",
      id: "audit",
    });
  });

  it("contains concurrent directory renames and treats raced entries as absent", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "race",
      body: "coherent",
      files: { "support.txt": "coherent support" },
    });
    const from = join(harness.home("project"), "skills", "race");
    const away = join(harness.home("project"), "skills", "race-away");
    const worker = new Worker(
      `const { parentPort, workerData } = require("node:worker_threads");
       const { renameSync } = require("node:fs");
       for (let i = 0; i < 1000; i += 1) {
         try { renameSync(workerData.from, workerData.away); } catch {}
         try { renameSync(workerData.away, workerData.from); } catch {}
       }
       parentPort.postMessage("done");`,
      { eval: true, workerData: { from, away } }
    );
    const done = new Promise<void>((resolve, reject) => {
      worker.once("message", () => resolve());
      worker.once("error", reject);
    });
    const scans = await Promise.all(
      Array.from({ length: 150 }, () => harness.registry.get({ id: "race" }))
    );
    await done;
    await worker.terminate();
    for (const result of scans) {
      if (result.status === "found") {
        expect(result.skill.body.trim()).toBe("coherent");
        expect(result.skill.supportingFiles).toHaveLength(1);
      } else {
        expect(result).toEqual({ status: "not-found", id: "race" });
      }
    }
  });
});

describe("revision identity", () => {
  it("changes for manifest bytes, supporting bytes, and supporting paths", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "revision",
      body: "body one",
      files: { "reference.txt": "reference one" },
    });
    const first = await revisionOf(harness, "revision");
    await harness.seed({ scope: "project", id: "revision", body: "body two" });
    const manifestChanged = await revisionOf(harness, "revision");
    expect(manifestChanged).not.toBe(first);

    const skillDir = join(harness.home("project"), "skills", "revision");
    writeFileSync(join(skillDir, "reference.txt"), "reference two", "utf8");
    const bytesChanged = await revisionOf(harness, "revision");
    expect(bytesChanged).not.toBe(manifestChanged);

    renameSync(join(skillDir, "reference.txt"), join(skillDir, "renamed.txt"));
    const pathChanged = await revisionOf(harness, "revision");
    expect(pathChanged).not.toBe(bytesChanged);
  });
});

describe("provenance and freshness", () => {
  const provenance = [
    "id: sourced",
    "description: sourced fixture",
    "provenance:",
    "  repo: nightwork-dev/gonk",
    "  package: '@gonk/example'",
    "  version: 1.2.3",
    "  pinned_at: 2026-07-16T00:00:00Z",
    "  anchors:",
    "    - src/index.ts",
    "    - ExampleSymbol",
  ].join("\n");

  it("normalizes legacy provenance anchors and returns unknown without a probe", async () => {
    const harness = make();
    await harness.seed({ scope: "project", id: "sourced", frontmatter: provenance });
    const result = await harness.registry.get({ id: "sourced", includeFreshness: true });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.skill.provenance).toEqual({
      repositoryId: "nightwork-dev/gonk",
      packageId: "@gonk/example",
      version: "1.2.3",
      pinnedAt: "2026-07-16T00:00:00Z",
      anchors: [
        { kind: "file", value: "src/index.ts" },
        { kind: "symbol", value: "ExampleSymbol" },
      ],
    });
    expect(result.skill.freshness).toEqual({ status: "unknown" });
  });

  it("rejects impossible date-only provenance values", async () => {
    const harness = make();
    await harness.seed({
      scope: "project",
      id: "impossible-provenance-date",
      frontmatter: provenance
        .replace("id: sourced", "id: impossible-provenance-date")
        .replace("2026-07-16T00:00:00Z", "2026-02-31"),
    });
    expect(await harness.registry.get({ id: "impossible-provenance-date" })).toEqual({
      status: "not-found",
      id: "impossible-provenance-date",
    });
  });

  it("uses an injected probe and normalizes failures to unprobeable", async () => {
    const fresh = make({
      probe: async () => ({
        status: "fresh",
        checkedAt: "2026-07-16T17:45:00.000Z",
      }),
    });
    await fresh.seed({ scope: "project", id: "sourced", frontmatter: provenance });
    const good = await fresh.registry.get({ id: "sourced", includeFreshness: true });
    expect(good.status === "found" ? good.skill.freshness : undefined).toEqual({
      status: "fresh",
      checkedAt: "2026-07-16T17:45:00.000Z",
    });

    const failed = make({ probe: () => { throw new Error("offline"); } });
    await failed.seed({ scope: "project", id: "sourced", frontmatter: provenance });
    const bad = await failed.registry.get({ id: "sourced", includeFreshness: true });
    expect(bad.status === "found" ? bad.skill.freshness : undefined).toEqual({
      status: "unprobeable",
      summary: "Freshness probe failed",
    });
  });
});

describe("extension fixture parity", () => {
  it("reads a golden SKILL.md emitted by the actual legacy registry", async () => {
    const harness = make();
    const skillDir = join(harness.home("project"), "skills", "legacy-wrapped");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      readFileSync(
        new URL("./fixtures/legacy-registry-wrapped.SKILL.md", import.meta.url),
        "utf8"
      ),
      "utf8"
    );
    const result = await harness.registry.get({ id: "legacy-wrapped" });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.skill.description).toBe(
      "A deliberately long description emitted by the actual legacy SkillRegistry so yaml.stringify wraps this scalar across physical lines while preserving one logical value for compatibility testing."
    );
    expect(result.skill.requirements).toEqual({
      hosts: ["cli", "mcp"],
      platforms: ["macos", "linux"],
    });
  });

  it("reads date-only provenance emitted by the actual legacy registry", async () => {
    const harness = make();
    const skillDir = join(harness.home("project"), "skills", "legacy-date-only");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      readFileSync(
        new URL("./fixtures/legacy-registry-date-only.SKILL.md", import.meta.url),
        "utf8"
      ),
      "utf8"
    );
    const result = await harness.registry.get({ id: "legacy-date-only" });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.skill.provenance?.pinnedAt).toBe("2026-07-16");
    expect(valid(managedSkillDetailSchema, result.skill)).toBe(true);
  });

  it("reads the skill-creator legacy frontmatter vocabulary without importing it", async () => {
    const harness = make();
    await harness.seed({
      scope: "persona",
      id: "legacy-fixture",
      frontmatter: [
        "name: legacy-fixture",
        "description: fixture mined from extension skill-creator",
        "version: 0.3.0",
        "author: tester",
        "interface: [codex, pi]",
        "platform: darwin",
        "pinned: true",
        "agent_created: true",
        "use_count: 7",
      ].join("\n"),
    });
    const result = await harness.registry.get({ id: "legacy-fixture" });
    expect(result.status).toBe("found");
    if (result.status !== "found") return;
    expect(result.skill).toMatchObject({
      id: "legacy-fixture",
      scope: "persona",
      pinned: true,
      agentCreated: true,
      useCount: 7,
      requirements: { hosts: ["codex", "pi"], platforms: ["darwin"] },
    });
  });
});

function journalFailingOnce(
  env: FilesystemHarness["env"],
  target: "mutation" | "activation",
  beforeFailure?: () => void
): SkillLifecycleJournal {
  const delegate = new FilesystemSkillLifecycleJournal(env);
  let failed = false;
  return {
    mutationReceiptId: (query) => delegate.mutationReceiptId(query),
    readMutation: (query) => delegate.readMutation(query),
    readMutationByReceiptId: (scope, receiptId) =>
      delegate.readMutationByReceiptId(scope, receiptId),
    writeMutation: (input) => {
      if (target === "mutation" && !failed) {
        failed = true;
        beforeFailure?.();
        throw new Error("injected mutation journal failure");
      }
      return delegate.writeMutation(input);
    },
    readActivation: (query) => delegate.readActivation(query),
    listActivations: (securityContextKey) =>
      delegate.listActivations(securityContextKey),
    writeActivation: (input) => {
      if (target === "activation" && !failed) {
        failed = true;
        beforeFailure?.();
        throw new Error("injected activation journal failure");
      }
      delegate.writeActivation(input);
    },
  };
}

function pendingTransactionCrashImage(
  harness: FilesystemHarness,
  id: string
): { capture(): void; restore(): void } {
  const transactionRoot = join(
    harness.home("project"),
    ".agents",
    "store",
    "skills.lifecycle-transactions"
  );
  const skillDir = join(harness.home("project"), "skills", id);
  const imageRoot = join(harness.root, `crash-${id}`);
  const transactionImage = join(imageRoot, "transactions");
  const skillImage = join(imageRoot, "skill");
  return {
    capture() {
      mkdirSync(imageRoot, { recursive: true });
      cpSync(transactionRoot, transactionImage, { recursive: true });
      cpSync(skillDir, skillImage, { recursive: true });
    },
    restore() {
      rmSync(transactionRoot, { recursive: true, force: true });
      rmSync(skillDir, { recursive: true, force: true });
      mkdirSync(dirname(transactionRoot), { recursive: true });
      mkdirSync(dirname(skillDir), { recursive: true });
      cpSync(transactionImage, transactionRoot, { recursive: true });
      cpSync(skillImage, skillDir, { recursive: true });
      const lockPath = join(transactionRoot, ".lock");
      rmSync(lockPath, { force: true });
      symlinkSync(
        "99999999:00000000-0000-4000-8000-000000000000",
        lockPath
      );
    },
  };
}

function valid(
  schema: { readonly "~standard": { validate(value: unknown): unknown } },
  value: unknown
): boolean {
  const result = schema["~standard"].validate(value);
  return !!result && typeof result === "object" && !("issues" in result);
}

function writeSkill(home: string, id: string, body: string): void {
  const directory = join(home, "skills", id);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, "SKILL.md"),
    `---\nid: ${id}\ndescription: ${id}\n---\n${body}\n`,
    "utf8"
  );
}

async function revisionOf(harness: FilesystemHarness, id: string): Promise<string> {
  const result = await harness.registry.get({ id });
  if (result.status !== "found") throw new Error(`Missing fixture: ${id}`);
  return result.skill.revision;
}

function executableToolRegistry(): ToolRegistry {
  return new ToolRegistry({
    security: {
      approvalMode: "bypass",
      resourceResolver: {
        resolve: ({ input }) => {
          const candidate = input as { id?: unknown; scope?: unknown };
          if (typeof candidate.id !== "string") return null;
          return {
            kind: "skill",
            target: candidate.id,
            ...(typeof candidate.scope === "string"
              ? { scope: candidate.scope as "global" | "persona" | "project" | "directory" | "session" }
              : {}),
          };
        },
      },
    },
  });
}

function authContext(
  mode: "allow" | "deny" = "allow",
  principalId = "agent:test"
): AuthContext {
  return {
    principal: {
      id: principalId,
      kind: "agent",
      identity: {
        issuer: "test",
        subject: principalId,
        method: "local",
      },
      roles: ["tester"],
      scopes: ["skills"],
    },
    authorize: async () =>
      mode === "allow"
        ? { outcome: "allow", reason: "test allow" }
        : { outcome: "deny", reason: "test deny" },
  };
}

function approval() {
  return {
    assertion: "approved-for-promotion" as const,
    approvedBy: "reviewer:test",
    approvedAt: "2026-07-16T00:00:00Z",
    reason: "reviewed in test",
  };
}
