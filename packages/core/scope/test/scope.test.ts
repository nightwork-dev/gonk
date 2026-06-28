import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import {
  FsScopeStore,
  MemoryScopeStore,
  SCOPE_RESOLUTION_ORDER,
  bindRoots,
  canonical,
  findProjectRoot,
  resolveTierHomes,
  scanDocuments,
  scopeStateHome,
  type ScopeEnvironment,
} from "../src/index.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "gonk-scope-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function envWith(extras: Partial<ScopeEnvironment> = {}): ScopeEnvironment {
  return {
    cwd: extras.cwd ?? join(tmp, "cwd"),
    homeRoot: extras.homeRoot ?? join(tmp, "home"),
    ...(extras.personaHome ? { personaHome: extras.personaHome } : {}),
    ...(extras.sessionId ? { sessionId: extras.sessionId } : {}),
    ...(extras.projectRoot ? { projectRoot: extras.projectRoot } : {}),
    ...(extras.sessionHome ? { sessionHome: extras.sessionHome } : {}),
    ...(extras.rootKinds ? { rootKinds: extras.rootKinds } : {}),
  };
}

function mkroot(home: string, kind: string): string {
  const path = join(home, kind);
  mkdirSync(path, { recursive: true });
  return path;
}

describe("MemoryScopeStore", () => {
  it("walks chain most→least specific by default", () => {
    const s = new MemoryScopeStore();
    s.set("test.k", "g", "global");
    s.set("test.k", "p", "persona");
    s.set("test.k", "se", "session");
    expect(s.get("test.k")).toBe("se");
    s.delete("test.k", "session");
    expect(s.get("test.k")).toBe("p");
  });

  it("resolve returns whole chain ordered by specificity", () => {
    const s = new MemoryScopeStore();
    s.set("test.k", "G", "global");
    s.set("test.k", "P", "persona");
    s.set("test.k", "S", "session");
    const chain = s.resolve("test.k").map((e) => [e.scope, e.value]);
    expect(chain).toEqual([
      ["session", "S"],
      ["persona", "P"],
      ["global", "G"],
    ]);
  });

  it("blob round-trip with mimeType", async () => {
    const s = new MemoryScopeStore();
    const data = new Uint8Array([1, 2, 3]);
    const h = await s.putBlob("voice-sample.wav", data, "persona", { mimeType: "audio/wav" });
    expect(h.scope).toBe("persona");
    expect(h.size).toBe(3);
    expect(h.mimeType).toBe("audio/wav");
    expect(await s.readBlob("voice-sample.wav")).toEqual(data);
  });
});

describe("findProjectRoot", () => {
  it("finds .gonk marker", () => {
    const root = join(tmp, "proj");
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    mkdirSync(join(root, ".gonk"), { recursive: true });
    expect(findProjectRoot(join(root, "src", "deep"))).toBe(root);
  });

  it("finds .claude as a project marker", () => {
    const root = join(tmp, "claude-proj");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, ".claude"), { recursive: true });
    expect(findProjectRoot(join(root, "src"))).toBe(root);
  });

  it("finds agents/ as a project marker", () => {
    const root = join(tmp, "agents-proj");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    expect(findProjectRoot(join(root, "src"))).toBe(root);
  });

  it("falls back to .git", () => {
    const root = join(tmp, "git-only");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, ".git"), { recursive: true });
    expect(findProjectRoot(join(root, "src"))).toBe(root);
  });

  it("a .agents holding ONLY auto-spawned substrate does NOT mark a project", () => {
    // Writing `<dir>/.agents/memory` (a cache) must not promote <dir> to a
    // project root — otherwise it hijacks project-tier resolution.
    const dir = join(tmp, "substrate-only");
    mkdirSync(join(dir, ".agents", "memory"), { recursive: true });
    expect(findProjectRoot(dir)).toBeUndefined();
  });

  it("a .agents holding ONLY a store/ substrate does NOT mark a project", () => {
    // The @gonk/store backend writes `<dir>/.agents/store/<ns>`. Like memory,
    // `store` is auto-spawned substrate and must NOT promote <dir> to a project
    // root (regression for the SUBSTRATE_KINDS-excludes-"store" footgun).
    const dir = join(tmp, "store-only");
    mkdirSync(join(dir, ".agents", "store"), { recursive: true });
    expect(findProjectRoot(dir)).toBeUndefined();
  });

  it("a .agents holding memory/ substrate still does NOT mark a project", () => {
    // Confirms the SUBSTRATE_KINDS set still excludes the pre-existing kinds
    // after adding "store".
    const dir = join(tmp, "memory-only-after-store");
    mkdirSync(join(dir, ".agents", "memory"), { recursive: true });
    expect(findProjectRoot(dir)).toBeUndefined();
  });

  it("a .agents holding a bound root (settings/) DOES mark a project", () => {
    const root = join(tmp, "bound-root");
    mkdirSync(join(root, "src"), { recursive: true });
    mkdirSync(join(root, ".agents", "settings"), { recursive: true });
    expect(findProjectRoot(join(root, "src"))).toBe(root);
  });

  it("substrate in a monorepo subpackage does not shadow the repo-root project", () => {
    const repo = join(tmp, "monorepo");
    const pkg = join(repo, "packages", "foo");
    mkdirSync(join(repo, ".git"), { recursive: true });
    mkdirSync(join(pkg, ".agents", "memory"), { recursive: true }); // cache only
    // findProjectRoot ascends past the substrate-only .agents to the repo root.
    expect(findProjectRoot(pkg)).toBe(repo);
  });
});

describe("resolveTierHomes", () => {
  it("binds global, directory; persona only when personaHome given", () => {
    const env = envWith();
    const homes = resolveTierHomes(env);
    expect(homes.has("global")).toBe(true);
    expect(homes.has("directory")).toBe(true);
    expect(homes.has("persona")).toBe(false);

    mkdirSync(join(tmp, "home", "agents", "gimble"), { recursive: true });
    const env2 = envWith({ personaHome: join(tmp, "home", "agents", "gimble") });
    expect(resolveTierHomes(env2).has("persona")).toBe(true);
  });

  it("binds session only when sessionId given", () => {
    expect(resolveTierHomes(envWith()).has("session")).toBe(false);
    expect(resolveTierHomes(envWith({ sessionId: "s1" })).has("session")).toBe(true);
  });

  it("defaults session home to ~/.agents/sessions/<id> when no legacy path exists", () => {
    const home = join(tmp, "home");
    mkdirSync(home, { recursive: true });
    const env = envWith({ homeRoot: home, sessionId: "s1" });
    const homes = resolveTierHomes(env);
    expect(homes.get("session")).toBe(canonical(join(home, ".agents", "sessions", "s1")));
  });

  it("falls back to ~/.gonk/sessions/<id> when that legacy path already exists", () => {
    const home = join(tmp, "home");
    const legacy = join(home, ".gonk", "sessions", "s1");
    mkdirSync(legacy, { recursive: true });
    const env = envWith({ homeRoot: home, sessionId: "s1" });
    const homes = resolveTierHomes(env);
    expect(homes.get("session")).toBe(canonical(legacy));
  });
});

describe("bindRoots", () => {
  it("binds known directory names in broad→narrow order", () => {
    const home = join(tmp, "h");
    mkroot(home, "agents");
    mkroot(home, ".claude");
    mkroot(home, ".gonk");
    const bindings = bindRoots(home, envWith());
    expect(bindings.map((b) => b.kind)).toEqual(["agents", ".claude", ".gonk"]);
  });

  it("dedupes symlinked roots that resolve to the same canonical path", () => {
    const home = join(tmp, "h");
    mkdirSync(home, { recursive: true });
    const realDir = join(tmp, "shared-target");
    mkdirSync(realDir, { recursive: true });
    symlinkSync(realDir, join(home, ".claude"));
    symlinkSync(realDir, join(home, ".gonk"));
    const bindings = bindRoots(home, envWith());
    expect(bindings.length).toBe(1);
  });

  it("ignores roots not in the configured order", () => {
    const home = join(tmp, "h");
    mkroot(home, "agents");
    mkroot(home, ".randomtool");
    const bindings = bindRoots(home, envWith());
    expect(bindings.map((b) => b.kind)).toEqual(["agents"]);
  });
});

describe("scanDocuments", () => {
  it("identifies persona-bearing and context-bearing docs", () => {
    const dir = join(tmp, "scope-home");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "AGENTS.md"), "context content");
    writeFileSync(
      join(dir, "PERSONA.md"),
      "---\nname: Gimble\n---\nI keep your config level no matter which host you tilt through. Named for a gimbal — though between us, I suspect that's just a flattering story someone told to cover a typo.",
    );
    writeFileSync(join(dir, "SOUL.md"), "Soul content.");
    writeFileSync(join(dir, "README.md"), "ignored");
    const docs = scanDocuments(dir, "directory");
    const map = new Map(docs.map((d) => [d.kind, d.role]));
    expect(map.get("AGENTS")).toBe("context");
    expect(map.get("PERSONA")).toBe("persona");
    expect(map.get("SOUL")).toBe("persona");
    expect(map.has("CLAUDE")).toBe(false);
    expect(docs.length).toBe(3);
  });

  it("matches case-insensitively (AGENTS.MD, agents.md, etc.)", () => {
    const dir = join(tmp, "scope-home");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "AGENTS.MD"), "uppercase variant");
    writeFileSync(join(dir, "claude.md"), "lowercase variant");
    const docs = scanDocuments(dir, "directory");
    const kinds = docs.map((d) => d.kind).sort();
    expect(kinds).toEqual(["AGENTS", "CLAUDE"]);
  });

  it("captures content", () => {
    const dir = join(tmp, "scope-home");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CLAUDE.md"), "Claude says hi.");
    const docs = scanDocuments(dir, "global");
    expect(docs[0]?.content).toBe("Claude says hi.");
  });
});

describe("FsScopeStore — multi-root", () => {
  it("read returns last-found across broad→narrow roots within a tier", () => {
    const home = join(tmp, "home");
    mkroot(home, "agents");
    mkroot(home, ".claude");
    mkroot(home, ".gonk");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    s.set("test.k", "from-agents", "global", { kind: "agents" });
    s.set("test.k", "from-claude", "global", { kind: ".claude" });
    s.set("test.k", "from-gonk", "global", { kind: ".gonk" });
    // Narrowest (.gonk at end of broad→narrow) wins.
    expect(s.get("test.k", "global")).toBe("from-gonk");
  });

  it("default-write target prefers .agents/ when bound", () => {
    const home = join(tmp, "home");
    mkroot(home, ".agents");
    mkroot(home, ".claude");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    s.set("test.k", "v", "global"); // no kind
    const resolved = s.resolve("test.k");
    expect(resolved[0]?.rootKind).toBe(".agents");
  });

  it("default-write target prefers agents/ when .agents/ is absent", () => {
    const home = join(tmp, "home");
    mkroot(home, "agents");
    mkroot(home, ".claude");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    s.set("test.k", "v", "global"); // no kind
    const resolved = s.resolve("test.k");
    expect(resolved[0]?.rootKind).toBe("agents");
  });

  it("default-write target falls back to narrowest when no agents root is bound", () => {
    const home = join(tmp, "home");
    mkroot(home, ".claude");
    mkroot(home, ".gonk");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    s.set("test.k", "v", "global");
    const resolved = s.resolve("test.k");
    // .gonk is narrower than .claude in DEFAULT_ROOT_ORDER
    expect(resolved[0]?.rootKind).toBe(".gonk");
  });

  it("write auto-creates an .agents root when none is bound, instead of failing", () => {
    const home = join(tmp, "home");
    mkdirSync(home, { recursive: true });
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    // Previously threw "No roots bound"; now it mounts the storage target so a
    // persona whose home predates root scaffolding can still record state.
    expect(() => s.set("test.k", "v", "global")).not.toThrow();
    expect(existsSync(join(home, ".agents"))).toBe(true);
    expect(s.get("test.k", "global")).toBe("v");
    expect(s.resolve("test.k")[0]?.rootKind).toBe(".agents");
  });

  it("explicit kind that's not bound throws with guidance", () => {
    const home = join(tmp, "home");
    mkroot(home, "agents");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    expect(() => s.set("test.k", "v", "global", { kind: ".claude" })).toThrow(/not bound/);
  });

  it("merges plain-object values across roots within a tier, narrower wins per sub-key", () => {
    const home = join(tmp, "home");
    mkroot(home, ".agents");
    mkroot(home, ".claude");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    // Each root contributes different providers; the merged view should
    // contain both, with overlapping sub-keys won by the narrower root.
    s.set(
      "voice.tts.providers",
      { openai: { url: "x" }, eleven: { url: "y-broad" } },
      "global",
      { kind: ".agents" },
    );
    s.set(
      "voice.tts.providers",
      { whisper: { url: "z" }, eleven: { url: "y-narrow" } },
      "global",
      { kind: ".claude" },
    );
    const got = s.get<Record<string, { url: string }>>(
      "voice.tts.providers",
      "global",
    );
    expect(got).toBeDefined();
    expect(Object.keys(got!).sort()).toEqual(["eleven", "openai", "whisper"]);
    expect(got!.eleven?.url).toBe("y-narrow"); // narrower (.claude) wins overlap
  });

  it("scalar values across roots still use last-found-wins", () => {
    const home = join(tmp, "home");
    mkroot(home, ".agents");
    mkroot(home, ".claude");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    s.set("voice.tts.provider", "broad", "global", { kind: ".agents" });
    s.set("voice.tts.provider", "narrow", "global", { kind: ".claude" });
    expect(s.get("voice.tts.provider", "global")).toBe("narrow");
  });

  it("resolve returns multi-definition view across roots", () => {
    const home = join(tmp, "home");
    mkroot(home, "agents");
    mkroot(home, ".claude");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    s.set("test.k", "broad", "global", { kind: "agents" });
    s.set("test.k", "narrow", "global", { kind: ".claude" });
    const r = s.resolve<string>("test.k");
    expect(r).toHaveLength(2);
    expect(r.map((e) => [e.rootKind, e.value])).toEqual([
      ["agents", "broad"],
      [".claude", "narrow"],
    ]);
  });

  it("dedupes tiers when canonical paths collide (cwd === project root)", () => {
    const root = join(tmp, "proj");
    mkdirSync(join(root, ".claude"), { recursive: true });
    const env = envWith({
      cwd: root,
      projectRoot: root,
      homeRoot: join(tmp, "home"),
    });
    const s = new FsScopeStore(env);
    // directory is most specific; project drops out of the chain.
    expect(s.available()).toContain("directory");
    expect(s.available()).not.toContain("project");
  });

  it("documents() includes ambient docs at the tier home", () => {
    const home = join(tmp, "home");
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, "AGENTS.md"), "global agents");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    const docs = s.documents("global");
    expect(docs.map((d) => d.kind)).toEqual(["AGENTS"]);
  });

  it("documents() also scans inside known roots", () => {
    const home = join(tmp, "home");
    mkroot(home, ".claude");
    writeFileSync(join(home, ".claude", "CLAUDE.md"), "claude root context");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    const docs = s.documents("global");
    expect(docs.some((d) => d.kind === "CLAUDE")).toBe(true);
  });

  it("rootsAt exposes the bound roots at a tier", () => {
    const home = join(tmp, "home");
    mkroot(home, "agents");
    mkroot(home, ".gonk");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    const roots = s.rootsAt("global");
    expect(roots.map((r) => r.kind)).toEqual(["agents", ".gonk"]);
  });

  it("blob round-trip persists across instances and surfaces canonical root", async () => {
    const home = join(tmp, "home");
    mkroot(home, ".gonk");
    const env = envWith({ homeRoot: home });
    const a = new FsScopeStore(env);
    const data = new Uint8Array([9, 9, 9]);
    const h = await a.putBlob("sample.wav", data, "global", { mimeType: "audio/wav" });
    expect(h.scope).toBe("global");
    expect(h.rootKind).toBe(".gonk");

    const b = new FsScopeStore(env);
    expect(await b.readBlob("sample.wav")).toEqual(data);
  });

  it("rejects blob keys that escape the root", async () => {
    const home = join(tmp, "home");
    mkroot(home, ".gonk");
    const env = envWith({ homeRoot: home });
    const s = new FsScopeStore(env);
    await expect(s.putBlob("../../escape", new Uint8Array([1]), "global")).rejects.toThrow();
  });

  it("canonical resolves symlinks", () => {
    const real = join(tmp, "real");
    mkdirSync(real, { recursive: true });
    const link = join(tmp, "link");
    symlinkSync(real, link);
    expect(canonical(link)).toBe(canonical(real));
  });

  it("canonical folds differently-cased paths on case-insensitive filesystems", () => {
    if (process.platform !== "darwin" && process.platform !== "win32") return;

    const realDir = mkdtempSync(join(tmpdir(), "GonkScopeCase-"));
    try {
      const parent = dirname(realDir);
      const name = basename(realDir);
      const swappedName = [...name]
        .map((ch) => {
          const upper = ch.toUpperCase();
          const lower = ch.toLowerCase();
          return ch === upper ? lower : upper;
        })
        .join("");
      const differentlyCased = join(parent, swappedName);

      if (!existsSync(differentlyCased)) return;
      const realStat = statSync(realDir);
      const casedStat = statSync(differentlyCased);
      if (realStat.dev !== casedStat.dev || realStat.ino !== casedStat.ino) return;

      expect(canonical(differentlyCased)).toBe(canonical(realDir));
    } finally {
      rmSync(realDir, { recursive: true, force: true });
    }
  });

  it("works across all five tiers including persona and session", () => {
    const home = join(tmp, "home");
    const cwd = join(tmp, "cwd");
    const proj = join(tmp, "proj");
    const personaDir = join(tmp, "gimble");
    const sessionDir = join(tmp, "ses");
    mkroot(home, ".gonk");
    mkroot(cwd, ".gonk");
    mkroot(proj, ".gonk");
    mkroot(personaDir, ".gonk");
    mkroot(sessionDir, ".gonk");
    const env = envWith({
      homeRoot: home,
      cwd,
      projectRoot: proj,
      personaHome: personaDir,
      sessionId: "s1",
      sessionHome: sessionDir,
    });
    const s = new FsScopeStore(env);
    for (const tier of SCOPE_RESOLUTION_ORDER) {
      s.set("test.k", `from-${tier}`, tier);
    }
    expect(s.get("test.k")).toBe("from-session");
    const chain = s.resolve<string>("test.k").map((e) => [e.scope, e.value]);
    expect(chain).toEqual([
      ["session", "from-session"],
      ["directory", "from-directory"],
      ["project", "from-project"],
      ["persona", "from-persona"],
      ["global", "from-global"],
    ]);
  });
});

describe("ScopeStore.home() + scopeStateHome", () => {
  it("home(tier) resolves the scope home even when NO root subdir is bound", () => {
    // A fresh homeRoot with no .gonk/.agents/… created in it: rootsAt is empty,
    // but home() still resolves the tier's base dir. This is the property the
    // curator/reflector rely on — without it they fell back to process.homedir()
    // and wrote operational state onto the real user home.
    const home = join(tmp, "bare-home");
    mkdirSync(home, { recursive: true });
    const store = new FsScopeStore(envWith({ homeRoot: home }));
    expect(store.rootsAt("global")).toHaveLength(0);
    expect(store.home("global")).toBe(canonical(home));
    // Agrees with the resolver's own tier-home computation.
    expect(store.home("global")).toBe(resolveTierHomes(envWith({ homeRoot: home })).get("global"));
  });

  it("home() tracks a bound root's parent too (parity with the old dirname(root) logic)", () => {
    const home = join(tmp, "rooted-home");
    mkroot(home, ".gonk");
    const store = new FsScopeStore(envWith({ homeRoot: home }));
    expect(store.rootsAt("global").length).toBeGreaterThan(0);
    // home() === the parent of the bound root === the scope home.
    expect(store.home("global")).toBe(canonical(home));
  });

  it("MemoryScopeStore has no filesystem home → home() is undefined", () => {
    const store = new MemoryScopeStore();
    expect(store.home("global")).toBeUndefined();
  });

  it("scopeStateHome resolves the scope's own home; falls back to homedir() only when absent", () => {
    const home = join(tmp, "state-home");
    mkdirSync(home, { recursive: true });
    const fsStore = new FsScopeStore(envWith({ homeRoot: home }));
    // Real fs store → the scope's own home, NEVER process.homedir().
    expect(scopeStateHome(fsStore)).toBe(canonical(home));
    expect(scopeStateHome(fsStore)).not.toBe(homedir());
    // In-memory store (no home) → the documented homedir() fallback.
    expect(scopeStateHome(new MemoryScopeStore())).toBe(homedir());
  });
});
