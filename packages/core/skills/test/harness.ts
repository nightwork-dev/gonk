import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { ScopeEnvironment } from "@gonk/scope";

import type {
  ManagedSkillConformanceHarness,
  ManagedSkillFixture,
} from "../src/conformance.ts";
import { FilesystemManagedSkillRegistry } from "../src/filesystem.ts";
import type { SkillFreshnessProbe, WritableManagedSkillRegistry } from "../src/types.ts";

export interface FilesystemHarness extends ManagedSkillConformanceHarness {
  registry: WritableManagedSkillRegistry;
  root: string;
  env: ScopeEnvironment;
  home(scope: ManagedSkillFixture["scope"]): string;
}

export function makeFilesystemHarness(
  freshnessProbe?: SkillFreshnessProbe
): FilesystemHarness {
  const root = mkdtempSync(join(tmpdir(), "gonk-skills-"));
  const homes = {
    global: join(root, "global"),
    persona: join(root, "persona"),
    project: join(root, "project"),
    directory: join(root, "project", "directory"),
    session: join(root, "session"),
  } as const;
  for (const home of Object.values(homes)) mkdirSync(home, { recursive: true });
  const env: ScopeEnvironment = {
    cwd: homes.directory,
    homeRoot: homes.global,
    personaHome: homes.persona,
    projectRoot: homes.project,
    sessionHome: homes.session,
    sessionId: "test-session",
  };
  return {
    root,
    env,
    registry: new FilesystemManagedSkillRegistry({
      env,
      ...(freshnessProbe === undefined ? {} : { freshnessProbe }),
    }),
    home: (scope) => homes[scope],
    seed(fixture) {
      const lifecycle = fixture.lifecycle ?? "active";
      const base =
        lifecycle === "active"
          ? join(homes[fixture.scope], "skills")
          : join(homes[fixture.scope], "skills", `.${lifecycle === "staged" ? "staging" : "archive"}`);
      const skillDir = join(base, fixture.id);
      mkdirSync(skillDir, { recursive: true });
      const frontmatter = fixture.frontmatter ?? [
        `id: ${fixture.id}`,
        `name: ${fixture.id}`,
        `description: ${fixture.description ?? `${fixture.id} fixture`}`,
      ].join("\n");
      writeFileSync(
        join(skillDir, "SKILL.md"),
        `---\n${frontmatter}\n---\n${fixture.body ?? `${fixture.id} body`}\n`,
        "utf8"
      );
      for (const [path, content] of Object.entries(fixture.files ?? {})) {
        const file = join(skillDir, path);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, content, "utf8");
      }
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
