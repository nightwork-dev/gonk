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

export interface ManagedSkillConformanceCase {
  name: string;
  run(
    makeHarness:
      | (() => ManagedSkillConformanceHarness)
      | (() => Promise<ManagedSkillConformanceHarness>)
  ): Promise<void>;
}

/** Runner-neutral cases. Test frameworks adapt these names and async functions. */
export function managedSkillRegistryConformanceCases(): readonly ManagedSkillConformanceCase[] {
  return [
    conformanceCase(
      "lists active skills deterministically and omits hidden lifecycle stores",
      async (harness) => {
        await harness.seed({ scope: "project", id: "zeta" });
        await harness.seed({ scope: "project", id: "alpha" });
        await harness.seed({ scope: "project", id: "draft", lifecycle: "staged" });
        await harness.seed({ scope: "project", id: "retired", lifecycle: "archived" });
        const result = await harness.registry.list();
        equal(result.skills.map(({ id }) => id), ["alpha", "zeta"]);
      }
    ),
    conformanceCase(
      "uses deterministic scope precedence and explains every definition",
      async (harness) => {
        await harness.seed({ scope: "global", id: "shared", body: "global" });
        await harness.seed({ scope: "project", id: "shared", body: "project" });
        await harness.seed({ scope: "session", id: "shared", body: "session" });

        const found = await harness.registry.get({ id: "shared" });
        assert(found.status === "found", "expected shared skill");
        equal(found.skill.scope, "session");
        equal(found.skill.body.trim(), "session");
        equal(found.skill.otherDefinitions.map(({ scope }) => scope), [
          "project",
          "global",
        ]);

        const resolution = await harness.registry.resolve({ id: "shared" });
        assert(resolution.status === "found", "expected shared resolution");
        equal(resolution.active.scope, "session");
        equal(resolution.definitions.map(({ scope }) => scope), [
          "session",
          "project",
          "global",
        ]);
      }
    ),
    conformanceCase(
      "supports exact-scope inspection without changing resolution",
      async (harness) => {
        await harness.seed({ scope: "global", id: "shared", body: "global" });
        await harness.seed({ scope: "project", id: "shared", body: "project" });
        const scoped = await harness.registry.get({ id: "shared", scope: "global" });
        assert(scoped.status === "found", "expected scoped definition");
        equal(scoped.skill.body.trim(), "global");
        equal(scoped.skill.otherDefinitions.map(({ scope }) => scope), ["project"]);
        const resolution = await harness.registry.resolve({ id: "shared" });
        assert(resolution.status === "found", "expected resolution");
        equal(resolution.active.scope, "project");
      }
    ),
    conformanceCase(
      "normalizes a supporting-file tree and reads relative paths",
      async (harness) => {
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
        assert(detail.status === "found", "expected file skill");
        equal(detail.skill.supportingFiles.map(({ path }) => path), [
          "notes",
          "root.md",
        ]);
        const notes = detail.skill.supportingFiles[0];
        assert(notes?.kind === "directory", "expected notes directory");
        equal(notes.children.map(({ path }) => path), [
          "notes/a.txt",
          "notes/z.md",
        ]);
        const read = await harness.registry.read({ id: "files", path: "notes/a.txt" });
        assert(read.status === "found", "expected supporting file");
        equal(read.content, "aye");
        equal(read.mediaType, "text/plain");
      }
    ),
    conformanceCase("returns structured not-found results", async (harness) => {
      equal(await harness.registry.get({ id: "missing" }), {
        status: "not-found",
        id: "missing",
      });
      equal(await harness.registry.read({ id: "missing", path: "x.txt" }), {
        status: "not-found",
        id: "missing",
        path: "x.txt",
        reason: "skill-not-found",
      });
      await harness.seed({ scope: "project", id: "present" });
      equal(await harness.registry.read({ id: "present", path: "x.txt" }), {
        status: "not-found",
        id: "present",
        path: "x.txt",
        reason: "file-not-found",
      });
    }),
    conformanceCase("keeps revisions stable across concurrent reads", async (harness) => {
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
      assert(a.status === "found" && b.status === "found", "expected stable skill");
      assert(c.status === "found", "expected stable reference");
      equal(a.skill.revision, b.skill.revision);
      equal(c.skillRevision, a.skill.revision);
    }),
  ];
}

function conformanceCase(
  name: string,
  test: (harness: ManagedSkillConformanceHarness) => Promise<void>
): ManagedSkillConformanceCase {
  return {
    name,
    async run(makeHarness) {
      const harness = await makeHarness();
      try {
        await test(harness);
      } finally {
        await harness.cleanup();
      }
    },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Conformance mismatch: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`
    );
  }
}
