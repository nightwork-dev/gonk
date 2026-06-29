import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { workspaceMemoryDbPath } from "../src/workspace-memory-db-path.ts";

let root: string;
let cwdA: string;
let cwdB: string;

beforeEach(() => {
  root = join(tmpdir(), `gonk-workspace-memory-${process.pid}-${Date.now()}`);
  cwdA = join(root, "workspace-a");
  cwdB = join(root, "workspace-b");
  mkdirSync(cwdA, { recursive: true });
  mkdirSync(cwdB, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("workspaceMemoryDbPath", () => {
  it("is stable for repeated calls with the same cwd", () => {
    const first = workspaceMemoryDbPath({ cwd: cwdA, name: "triples", homeRoot: join(root, "home") });
    const second = workspaceMemoryDbPath({ cwd: cwdA, name: "triples", homeRoot: join(root, "home") });

    expect(first).toBe(second);
    expect(first).toBe(workspaceMemoryDbPath({ cwd: join(cwdA, "."), name: "triples", homeRoot: join(root, "home") }));
    expect(first.endsWith(join(".agents", "memory", "triples.db"))).toBe(true);
  });

  it("is distinct per cwd", () => {
    const a = workspaceMemoryDbPath({ cwd: cwdA, name: "triples", homeRoot: join(root, "home") });
    const b = workspaceMemoryDbPath({ cwd: cwdB, name: "triples", homeRoot: join(root, "home") });

    expect(a).not.toBe(b);
    expect(a).toContain(cwdA);
    expect(b).toContain(cwdB);
  });

  it("never includes an undefined session segment", () => {
    const path = workspaceMemoryDbPath({ cwd: cwdA, name: "cost-log", homeRoot: join(root, "home") });

    expect(path).not.toContain("undefined");
    expect(path).not.toContain("sessions");
    expect(path.endsWith(join(".agents", "memory", "cost-log.db"))).toBe(true);
  });
});
