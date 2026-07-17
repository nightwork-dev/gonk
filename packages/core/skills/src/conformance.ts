import { describe, expect, it } from "vitest";

import type { ManagedSkillRegistry, SkillScope } from "./types.ts";

export interface ManagedSkillFixture {
  scope: SkillScope;
  id: string;
  description?: string;
  body?: string;
  lifecycle?: "active" | "staged" | "archived";
  frontmatter?: string;
  files?: Readonly<Record<string, string>>;
}

export interface ManagedSkillConformanceHarness {
  registry: ManagedSkillRegistry;
  seed(fixture: ManagedSkillFixture): void | Promise<void>;
  cleanup(): void | Promise<void>;
}

/**
 * Reusable behavioral contract for managed skill registry implementations.
 * The factory must return a fresh empty harness for every invocation.
 */
export function managedSkillRegistryConformance(
  makeHarness:
    | (() => ManagedSkillConformanceHarness)
    | (() => Promise<ManagedSkillConformanceHarness>)
): void {
  const run = async (
    test: (harness: ManagedSkillConformanceHarness) => Promise<void>
  ): Promise<void> => {
    const harness = await makeHarness();
    try {
      await test(harness);
    } finally {
      await harness.cleanup();
    }
  };

  describe("ManagedSkillRegistry conformance", () => {
    it("lists active skills deterministically and omits hidden lifecycle stores", () =>
      run(async (harness) => {
        await harness.seed({ scope: "project", id: "zeta" });
        await harness.seed({ scope: "project", id: "alpha" });
        await harness.seed({ scope: "project", id: "draft", lifecycle: "staged" });
        await harness.seed({ scope: "project", id: "retired", lifecycle: "archived" });

        const result = await harness.registry.list();
        expect(result.skills.map(({ id }) => id)).toEqual(["alpha", "zeta"]);
      }));

    it("uses deterministic scope precedence and exposes every shadowed definition", () =>
      run(async (harness) => {
        await harness.seed({ scope: "global", id: "shared", body: "global" });
        await harness.seed({ scope: "project", id: "shared", body: "project" });
        await harness.seed({ scope: "session", id: "shared", body: "session" });

        const found = await harness.registry.get({ id: "shared" });
        expect(found.status).toBe("found");
        if (found.status !== "found") return;
        expect(found.skill.scope).toBe("session");
        expect(found.skill.body.trim()).toBe("session");
        expect(found.skill.shadowed.map(({ scope }) => scope)).toEqual([
          "project",
          "global",
        ]);

        const resolution = await harness.registry.resolve({ id: "shared" });
        expect(resolution.status).toBe("found");
        if (resolution.status !== "found") return;
        expect(resolution.definitions.map(({ scope }) => scope)).toEqual([
          "session",
          "project",
          "global",
        ]);
      }));

    it("supports exact-scope reads without changing the default winner", () =>
      run(async (harness) => {
        await harness.seed({ scope: "global", id: "shared", body: "global" });
        await harness.seed({ scope: "project", id: "shared", body: "project" });

        const scoped = await harness.registry.get({ id: "shared", scope: "global" });
        expect(scoped.status).toBe("found");
        if (scoped.status === "found") expect(scoped.skill.body.trim()).toBe("global");

        const winner = await harness.registry.get({ id: "shared" });
        expect(winner.status).toBe("found");
        if (winner.status === "found") expect(winner.skill.body.trim()).toBe("project");
      }));

    it("normalizes a supporting-file tree and reads only declared relative paths", () =>
      run(async (harness) => {
        await harness.seed({
          scope: "project",
          id: "files",
          files: {
            "notes/z.md": "zed",
            "notes/a.txt": "aye",
            "root.md": "root",
          },
        });

        const detail = await harness.registry.get({ id: "files" });
        expect(detail.status).toBe("found");
        if (detail.status !== "found") return;
        expect(detail.skill.supportingFiles.map(({ path }) => path)).toEqual([
          "notes",
          "root.md",
        ]);
        const notes = detail.skill.supportingFiles[0];
        expect(notes?.kind).toBe("directory");
        if (notes?.kind === "directory") {
          expect(notes.children.map(({ path }) => path)).toEqual([
            "notes/a.txt",
            "notes/z.md",
          ]);
        }

        const read = await harness.registry.read({ id: "files", path: "notes/a.txt" });
        expect(read).toMatchObject({
          status: "found",
          content: "aye",
          mediaType: "text/plain",
        });
      }));

    it("returns structured not-found results", () =>
      run(async (harness) => {
        expect(await harness.registry.get({ id: "missing" })).toEqual({
          status: "not-found",
          id: "missing",
        });
        expect(await harness.registry.read({ id: "missing", path: "x.txt" })).toEqual({
          status: "not-found",
          id: "missing",
          path: "x.txt",
          reason: "skill-not-found",
        });
        await harness.seed({ scope: "project", id: "present" });
        expect(await harness.registry.read({ id: "present", path: "x.txt" })).toEqual({
          status: "not-found",
          id: "present",
          path: "x.txt",
          reason: "file-not-found",
        });
      }));

    it("keeps revisions stable and permits concurrent reads", () =>
      run(async (harness) => {
        await harness.seed({
          scope: "project",
          id: "stable",
          body: "stable body",
          files: { "reference.txt": "stable reference" },
        });
        const [a, b, c] = await Promise.all([
          harness.registry.get({ id: "stable" }),
          harness.registry.get({ id: "stable" }),
          harness.registry.read({ id: "stable", path: "reference.txt" }),
        ]);
        expect(a.status).toBe("found");
        expect(b.status).toBe("found");
        expect(c.status).toBe("found");
        if (a.status === "found" && b.status === "found" && c.status === "found") {
          expect(a.skill.revision).toBe(b.skill.revision);
          expect(c.skillRevision).toBe(a.skill.revision);
        }
      }));
  });
}
