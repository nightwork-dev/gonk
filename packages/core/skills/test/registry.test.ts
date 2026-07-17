import {
  mkdirSync,
  readFileSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import { afterEach, describe, expect, it } from "vitest";

import {
  managedSkillDetailSchema,
  FilesystemManagedSkillRegistry,
  skillFreshnessResultSchema,
  skillGetRequestSchema,
  skillListResultSchema,
  skillResolveRequestSchema,
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
