import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FsScopeStore } from "@gonk/scope";
import { acquirePiStorage } from "../../extension-spec-pi/src/storage.ts";

import { acquireCodexStorage } from "../src/storage.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "gonk-cross-host-storage-"));
  roots.push(root);
  const homeRoot = join(root, "home");
  const cwd = join(root, "project");
  mkdirSync(cwd, { recursive: true });
  const env = { cwd, homeRoot, sessionId: "same-project" };
  return { env, scope: new FsScopeStore(env) };
}

describe("Codex host storage", () => {
  it("reads and cancels the exact directory job records Pi writes", () => {
    const { env, scope } = fixture();
    const pi = acquirePiStorage({ consumer: "jobs", scope, env, defaultTier: "directory" });
    pi.state.kv("jobs").set("cross-host-job", { status: "running", origin: "pi" });

    const codex = acquireCodexStorage({ consumer: "jobs", scope, env, defaultTier: "directory" });
    expect(codex.source.kv("directory")).toBe(pi.source.kv("directory"));
    expect(codex.state.kv("jobs").get("cross-host-job")).toEqual({ status: "running", origin: "pi" });
    codex.state.kv("jobs").set("cross-host-job", { status: "cancelled", origin: "codex" });
    expect(pi.state.kv("jobs").get("cross-host-job")).toEqual({ status: "cancelled", origin: "codex" });
    codex.close();
    pi.close();
  });

  it("delivers and acknowledges synthetic comms through Pi's global authority", () => {
    const { env, scope } = fixture();
    const pi = acquirePiStorage({ consumer: "comms", scope, env, defaultTier: "global" });
    pi.state.kv("comms").set("synthetic-recipient", { id: "synthetic-message", status: "waiting" });

    const codex = acquireCodexStorage({ consumer: "comms", scope, env, defaultTier: "global" });
    expect(codex.source.kv("global")).toBe(pi.source.kv("global"));
    expect(codex.state.kv("comms").get("synthetic-recipient")).toEqual({ id: "synthetic-message", status: "waiting" });
    codex.state.kv("comms").set("synthetic-recipient", { id: "synthetic-message", status: "acknowledged" });
    expect(pi.state.kv("comms").get("synthetic-recipient")).toEqual({ id: "synthetic-message", status: "acknowledged" });
    codex.close();
    pi.close();
  });

  it("binds a Pi recipient session home for a durable cross-host inbox", () => {
    const { env, scope } = fixture();
    const pi = acquirePiStorage({ consumer: "comms", scope, env, defaultTier: "global" });
    pi.state.kv("session", "inbox").set("synthetic-message", { status: "open" });

    const codex = acquireCodexStorage({ consumer: "comms", scope, env, defaultTier: "global" });
    expect(codex.state.kv("session", "inbox").get("synthetic-message")).toEqual({ status: "open" });
    codex.state.kv("session", "inbox").set("synthetic-message", { status: "resolved" });
    expect(pi.state.kv("session", "inbox").get("synthetic-message")).toEqual({ status: "resolved" });
    codex.close();
    pi.close();
  });
});
