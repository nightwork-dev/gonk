import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import type { AuthContext } from "@gonk/auth";
import type { ScopeEnvironment, ScopeName } from "@gonk/scope";
import type { GonkSyncState, GonkSyncStateSource } from "@gonk/store";
import { InMemoryKv } from "@mirk/store";
import { afterEach, describe, expect, it } from "vitest";

import {
  FilesystemManagedSkillRegistry,
  FilesystemSkillLifecycleJournal,
  type SkillMutationJournalWrite,
  type SkillMutationReceipt,
} from "../src/index.ts";
import { makeFilesystemHarness, type FilesystemHarness } from "./harness.ts";

// Regressions found when gonk-extensions moved every skill read and write onto
// this registry (gonk-extensions cleanup lane 8, 2026-11-20).

const harnesses: FilesystemHarness[] = [];
const make = () => {
  const harness = makeFilesystemHarness();
  harnesses.push(harness);
  return harness;
};

afterEach(() => {
  for (const harness of harnesses.splice(0)) harness.cleanup();
});

const REAL_SKILL = readFileSync(
  join(import.meta.dirname, "fixtures", "real-tick-simulation-debugging.SKILL.md"),
  "utf8"
);
const REAL_ID = "tick-simulation-debugging";

/** The real skill with a valid provenance date, a hand comment and fields
 *  this registry does not know. */
const WITH_UNKNOWN_FIELDS = REAL_SKILL.replace("  pinned_at: 2026-07\n", "  pinned_at: 2026-07-21\n")
  .replace(
    "agent_created: true\n",
    [
      "agent_created: true",
      "# kept by hand: the licence came from the source repo",
      "license: MIT",
      "related:",
      "  - git-worktree-branch-consolidation",
      "x-team-note: keep me exactly as written",
      "",
    ].join("\n")
  );

describe("rewrites keep every frontmatter field they did not mean to change", () => {
  const cases: {
    name: string;
    changed: readonly string[];
    run(harness: FilesystemHarness, revision: string): Promise<{ status: string }>;
  }[] = [
    {
      name: "pin",
      changed: ["pinned"],
      run: (harness, revision) =>
        harness.registry.pin({
          auth: authContext(),
          idempotencyKey: "pin",
          id: REAL_ID,
          scope: "project",
          pinned: true,
          expectedRevision: revision,
        }),
    },
    {
      name: "record usage",
      changed: ["use_count", "last_used_at"],
      run: (harness, revision) =>
        harness.registry.recordUsage({
          auth: authContext(),
          idempotencyKey: "usage",
          id: REAL_ID,
          scope: "project",
          expectedRevision: revision,
        }),
    },
    {
      name: "activate",
      changed: ["use_count", "last_used_at"],
      run: (harness) =>
        harness.registry.activate({
          auth: authContext(),
          id: REAL_ID,
          scope: "project",
          requestId: "activate",
          trigger: "manual",
          reason: "test",
        }),
    },
    {
      name: "patch the body",
      changed: ["updated_at"],
      run: (harness, revision) =>
        harness.registry.patch({
          auth: authContext(),
          idempotencyKey: "patch",
          id: REAL_ID,
          scope: "project",
          find: "Tick-simulation",
          replace: "Tick simulation",
          expectedRevision: revision,
        }),
    },
  ];

  for (const manifest of [
    { label: "the real skill", text: REAL_SKILL },
    { label: "unknown fields and a comment", text: WITH_UNKNOWN_FIELDS },
  ]) {
    for (const testCase of cases) {
      it(`${testCase.name} keeps ${manifest.label} byte for byte`, async () => {
        const harness = make();
        const path = writeManifest(harness, "project", REAL_ID, manifest.text);
        const before = await harness.registry.get({ id: REAL_ID, scope: "project" });
        expect(before.status).toBe("found");
        if (before.status !== "found") return;

        const result = await testCase.run(harness, before.skill.revision);
        expect(result.status).not.toBe("failed");

        const after = readFileSync(path, "utf8");
        expect(withoutKeys(after, testCase.changed)).toEqual(
          withoutKeys(manifest.text, testCase.changed)
        );
        for (const key of testCase.changed) {
          expect(topLevelKeys(after)).toContain(key);
        }
      });
    }
  }

  it("promote removes needs_audit and keeps every other field", async () => {
    const harness = make();
    const staged = WITH_UNKNOWN_FIELDS.replace(
      "agent_created: true\n",
      "agent_created: true\nneeds_audit: true\n"
    );
    const path = writeManifest(harness, "project", REAL_ID, staged, ".staging");
    const registry = new FilesystemManagedSkillRegistry({
      env: harness.env,
      stateSource: harness.stateSource,
      promotionApprovalProvider: { decide: () => ({ outcome: "approved", reason: "test" }) },
    });
    const result = await registry.promote({
      auth: authContext(),
      idempotencyKey: "promote",
      id: REAL_ID,
      scope: "project",
      approval: approval(),
    });
    expect(result.status).toBe("ok");
    const live = readFileSync(join(dirname(dirname(dirname(path))), REAL_ID, "SKILL.md"), "utf8");
    expect(topLevelKeys(live)).not.toContain("needs_audit");
    expect(withoutKeys(live, ["updated_at"])).toEqual(
      withoutKeys(staged, ["updated_at", "needs_audit"])
    );
  });

  it("writes the canonical key in place of a camelCase alias instead of adding a second one", async () => {
    const harness = make();
    const text = REAL_SKILL.replace("agent_created: true\n", "agent_created: true\nuseCount: 2\n");
    const path = writeManifest(harness, "project", REAL_ID, text);
    const revision = await revisionOf(harness, REAL_ID);
    const result = await harness.registry.recordUsage({
      auth: authContext(),
      idempotencyKey: "usage-alias",
      id: REAL_ID,
      scope: "project",
      expectedRevision: revision,
    });
    expect(result.status).toBe("ok");
    const after = readFileSync(path, "utf8");
    expect(topLevelKeys(after)).not.toContain("useCount");
    expect(after).toContain("agent_created: true\nuse_count: 3\n");
  });
});

describe("a bad optional field is reported, not a reason to hide the skill", () => {
  it("lists the real skill with pinned_at: 2026-07 and warns about that field", async () => {
    const harness = make();
    const path = writeManifest(harness, "global", REAL_ID, REAL_SKILL);
    const listed = await harness.registry.list();
    const summary = listed.skills.find((skill) => skill.id === REAL_ID);
    expect(summary).toBeDefined();
    expect(summary?.warnings).toEqual([
      { field: "provenance.pinned_at", message: expect.stringContaining("ISO 8601") },
    ]);
    const detail = await harness.registry.get({ id: REAL_ID });
    expect(detail.status).toBe("found");
    if (detail.status !== "found") return;
    expect(detail.skill.provenance?.anchors).toHaveLength(5);
    expect(detail.skill.provenance?.pinnedAt).toBeUndefined();

    const used = await harness.registry.recordUsage({
      auth: authContext(),
      idempotencyKey: "usage-bad-field",
      id: REAL_ID,
      expectedRevision: detail.skill.revision,
    });
    expect(used.status).toBe("ok");
    expect(readFileSync(path, "utf8")).toContain("  pinned_at: 2026-07\n");
  });

  it("keeps listing a skill whose use_count is not a number", async () => {
    const harness = make();
    writeManifest(
      harness,
      "project",
      "odd-count",
      "---\nid: odd-count\ndescription: odd count\nuse_count: lots\n---\nbody\n"
    );
    const listed = await harness.registry.list();
    const summary = listed.skills.find((skill) => skill.id === "odd-count");
    expect(summary?.useCount).toBeUndefined();
    expect(summary?.warnings).toEqual([
      { field: "use_count", message: expect.any(String) },
    ]);
  });
});

describe("restore, promote and archive skip tiers that have no home", () => {
  it("works without a scope when no persona is active", async () => {
    const harness = make();
    const { personaHome: _noPersona, ...env } = harness.env satisfies ScopeEnvironment;
    const registry = new FilesystemManagedSkillRegistry({
      env,
      stateSource: harness.stateSource,
      promotionApprovalProvider: { decide: () => ({ outcome: "approved", reason: "test" }) },
    });
    await harness.seed({ scope: "project", id: "kept" });
    const revision = await revisionOf(harness, "kept");
    const archived = await registry.archive({
      auth: authContext(),
      idempotencyKey: "archive",
      id: "kept",
      expectedRevision: revision,
    });
    expect(archived.status).toBe("ok");
    const restored = await registry.restore({
      auth: authContext(),
      idempotencyKey: "restore",
      id: "kept",
    });
    expect(restored.status).toBe("ok");

    await harness.seed({
      scope: "project",
      id: "staged-one",
      lifecycle: "staged",
      frontmatter: "id: staged-one\ndescription: staged\nneeds_audit: true",
    });
    const promoted = await registry.promote({
      auth: authContext(),
      idempotencyKey: "promote",
      id: "staged-one",
      approval: approval(),
    });
    expect(promoted.status).toBe("ok");
  });
});

describe("crash recovery when hosts keep separate journals", () => {
  it("does not roll back a committed mutation found by a host with a different journal", async () => {
    const harness = make();
    writeManifest(harness, "project", REAL_ID, WITH_UNKNOWN_FIELDS);
    const crash = crashImage(harness, REAL_ID);
    const writer = new FilesystemManagedSkillRegistry({
      env: harness.env,
      lifecycleJournal: new JournalCapturingAfterWrite(harness.state, crash.capture),
    });
    const before = await writer.get({ id: REAL_ID, scope: "project" });
    if (before.status !== "found") throw new Error("missing fixture");
    const patched = await writer.patch({
      auth: authContext(),
      idempotencyKey: "cross-journal",
      id: REAL_ID,
      scope: "project",
      find: "Tick-simulation",
      replace: "Committed edit",
      expectedRevision: before.skill.revision,
    });
    expect(patched.status).toBe("ok");
    // The disk now looks as it would if the writer died after its journal
    // recorded the receipt and before it removed the pending transaction.
    crash.restore();

    const otherHost = new FilesystemManagedSkillRegistry({
      env: harness.env,
      stateSource: separateStateSource(),
    });
    const seen = await otherHost.get({ id: REAL_ID, scope: "project" });
    expect(seen.status === "found" ? seen.skill.body : "").toContain("# Committed edit");
    expect(pendingTransactions(harness)).toEqual([]);

    const writerAgain = new FilesystemManagedSkillRegistry({
      env: harness.env,
      stateSource: harness.stateSource,
    });
    const replayed = await writerAgain.getMutationReceipt({
      auth: authContext(),
      operation: "patch",
      idempotencyKey: "cross-journal",
    });
    expect(replayed.status).toBe("found");
    const final = await writerAgain.get({ id: REAL_ID, scope: "project" });
    expect(final.status === "found" ? final.skill.body : "").toContain("# Committed edit");
  });

  it("restores files another host's writer had not finished", async () => {
    const harness = make();
    const path = writeManifest(harness, "project", REAL_ID, WITH_UNKNOWN_FIELDS);
    const crash = crashImage(harness, REAL_ID);
    const writer = new FilesystemManagedSkillRegistry({
      env: harness.env,
      lifecycleJournal: new JournalCapturingAfterWrite(harness.state, crash.capture),
    });
    const before = await writer.get({ id: REAL_ID, scope: "project" });
    if (before.status !== "found") throw new Error("missing fixture");
    await writer.patch({
      auth: authContext(),
      idempotencyKey: "unfinished",
      id: REAL_ID,
      scope: "project",
      find: "Tick-simulation",
      replace: "Half-written edit",
      expectedRevision: before.skill.revision,
    });
    crash.restore();
    // As if the writer died part way through changing the files.
    for (const name of pendingTransactions(harness)) {
      const markerPath = join(transactionRoot(harness), name, "transaction.json");
      const marker = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
      delete marker.applied;
      writeFileSync(markerPath, JSON.stringify(marker), "utf8");
    }

    new FilesystemManagedSkillRegistry({ env: harness.env, stateSource: separateStateSource() });
    expect(readFileSync(path, "utf8")).toBe(WITH_UNKNOWN_FIELDS);
    expect(pendingTransactions(harness)).toEqual([]);
  });

  it("opens without throwing while another registry holds a live transaction", async () => {
    const harness = make();
    writeManifest(harness, "project", REAL_ID, WITH_UNKNOWN_FIELDS);
    let openedDuringWrite: unknown;
    const writer = new FilesystemManagedSkillRegistry({
      env: harness.env,
      lifecycleJournal: new JournalCapturingAfterWrite(harness.state, () => {
        try {
          openedDuringWrite = new FilesystemManagedSkillRegistry({
            env: harness.env,
            stateSource: separateStateSource(),
          });
        } catch (error) {
          openedDuringWrite = error;
        }
      }),
    });
    const revision = (await writer.get({ id: REAL_ID, scope: "project" }));
    if (revision.status !== "found") throw new Error("missing fixture");
    const result = await writer.pin({
      auth: authContext(),
      idempotencyKey: "live-pin",
      id: REAL_ID,
      scope: "project",
      pinned: true,
      expectedRevision: revision.skill.revision,
    });
    expect(result.status).toBe("ok");
    expect(openedDuringWrite).toBeInstanceOf(FilesystemManagedSkillRegistry);
    const after = await writer.get({ id: REAL_ID, scope: "project" });
    expect(after.status === "found" ? after.skill.pinned : undefined).toBe(true);
  });
});

class JournalCapturingAfterWrite extends FilesystemSkillLifecycleJournal {
  private fired = false;

  constructor(
    state: GonkSyncState,
    private readonly afterWrite: () => void
  ) {
    super(state);
  }

  override writeMutation(input: SkillMutationJournalWrite): SkillMutationReceipt {
    const receipt = super.writeMutation(input);
    if (!this.fired) {
      this.fired = true;
      this.afterWrite();
    }
    return receipt;
  }
}

function separateStateSource(): GonkSyncStateSource {
  const stores = new Map<ScopeName, InMemoryKv>();
  return {
    kv(scope) {
      let store = stores.get(scope);
      if (!store) {
        store = new InMemoryKv();
        stores.set(scope, store);
      }
      return store;
    },
  };
}

function writeManifest(
  harness: FilesystemHarness,
  scope: "global" | "project",
  id: string,
  text: string,
  area?: ".staging"
): string {
  const directory = area
    ? join(harness.home(scope), "skills", area, id)
    : join(harness.home(scope), "skills", id);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "SKILL.md");
  writeFileSync(path, text, "utf8");
  return path;
}

/** Top-level frontmatter entries as [key, raw text], comments attached to the
 *  entry that follows them. */
function frontmatterEntries(text: string): [string, string][] {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  const entries: [string, string][] = [];
  let pending = "";
  for (const line of lines.slice(1, end)) {
    const key = /^([A-Za-z_][\w-]*):/.exec(line)?.[1];
    if (key) {
      entries.push([key, `${pending}${line}\n`]);
      pending = "";
    } else if (line.startsWith("#")) {
      pending += `${line}\n`;
    } else {
      const last = entries.at(-1);
      if (last) last[1] += `${line}\n`;
    }
  }
  return entries;
}

function topLevelKeys(text: string): string[] {
  return frontmatterEntries(text).map(([key]) => key);
}

/** The manifest with the named top-level entries removed: everything else,
 *  frontmatter and body, must survive a rewrite unchanged. */
function withoutKeys(text: string, keys: readonly string[]): string {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  const kept = frontmatterEntries(text)
    .filter(([key]) => !keys.includes(key))
    .map(([, raw]) => raw)
    .join("");
  // The patch case edits the heading on purpose; undo it so only the
  // frontmatter is compared for that case.
  const body = lines.slice(end + 1).join("\n").replace("# Tick simulation", "# Tick-simulation");
  return `${kept}---\n${body}`;
}

async function revisionOf(harness: FilesystemHarness, id: string): Promise<string> {
  const result = await harness.registry.get({ id });
  if (result.status !== "found") throw new Error(`Missing fixture: ${id}`);
  return result.skill.revision;
}

function transactionRoot(harness: FilesystemHarness): string {
  return join(harness.home("project"), ".agents", "store", "skills.lifecycle-transactions");
}

function pendingTransactions(harness: FilesystemHarness): string[] {
  const root = transactionRoot(harness);
  return existsSync(root) ? readdirSync(root).filter((name) => name.startsWith(".pending-")) : [];
}

function crashImage(harness: FilesystemHarness, id: string) {
  const root = transactionRoot(harness);
  const skillDir = join(harness.home("project"), "skills", id);
  const image = join(harness.root, `crash-${id}`);
  return {
    capture() {
      mkdirSync(image, { recursive: true });
      cpSync(root, join(image, "transactions"), { recursive: true });
      cpSync(skillDir, join(image, "skill"), { recursive: true });
    },
    restore() {
      rmSync(root, { recursive: true, force: true });
      rmSync(skillDir, { recursive: true, force: true });
      cpSync(join(image, "transactions"), root, { recursive: true });
      cpSync(join(image, "skill"), skillDir, { recursive: true });
      const lock = join(root, ".lock");
      rmSync(lock, { force: true });
      symlinkSync("99999999:00000000-0000-4000-8000-000000000000", lock);
    },
  };
}

function authContext(): AuthContext {
  return {
    principal: {
      id: "agent:test",
      kind: "agent",
      identity: { issuer: "test", subject: "agent:test", method: "local" },
      roles: ["tester"],
      scopes: ["skills"],
    },
    authorize: async () => ({ outcome: "allow", reason: "test allow" }),
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
