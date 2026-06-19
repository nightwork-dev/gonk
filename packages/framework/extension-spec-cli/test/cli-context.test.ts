import { describe, it, expect } from "vitest";
import { MemoryScopeStore } from "@gonk/scope";
import type { CliExtensionContext } from "../src/index.ts";
import { makeCliSubcommandContext } from "../src/cli-context.ts";

function makeIo(): CliExtensionContext & { stdout: { calls: string[]; write: (s: string) => void }; stderr: { calls: string[]; write: (s: string) => void } } {
  const stdout = { calls: [] as string[], write(s: string) { this.calls.push(s); } };
  const stderr = { calls: [] as string[], write(s: string) { this.calls.push(s); } };
  return {
    stdout,
    stderr,
    hasUI: true,
    cwd: "/tmp",
    env: {},
  };
}

describe("makeCliSubcommandContext", () => {
  it("builds a context with scope and host.cliCtx bound", () => {
    const scope = new MemoryScopeStore();
    const cliCtx = makeIo();
    const ctx = makeCliSubcommandContext(scope, cliCtx);
    expect(ctx.scope).toBe(scope);
    expect(ctx.host.cliCtx).toBe(cliCtx);
    expect(ctx.hasUI).toBe(true);
  });

  it("notify(info) writes to stderr with [info] prefix", () => {
    const scope = new MemoryScopeStore();
    const cliCtx = makeIo();
    const ctx = makeCliSubcommandContext(scope, cliCtx);
    ctx.notify("hello", "info");
    expect(cliCtx.stderr.calls.join("")).toBe("[info] hello\n");
    expect(cliCtx.stdout.calls.length).toBe(0);
  });

  it("notify(error) writes to stderr with [error] prefix", () => {
    const scope = new MemoryScopeStore();
    const cliCtx = makeIo();
    const ctx = makeCliSubcommandContext(scope, cliCtx);
    ctx.notify("oops", "error");
    expect(cliCtx.stderr.calls.join("")).toBe("[error] oops\n");
  });

  it("notify default level is info", () => {
    const scope = new MemoryScopeStore();
    const cliCtx = makeIo();
    const ctx = makeCliSubcommandContext(scope, cliCtx);
    ctx.notify("hi");
    expect(cliCtx.stderr.calls.join("")).toBe("[info] hi\n");
  });

  it("hasUI follows cliCtx.hasUI", () => {
    const scope = new MemoryScopeStore();
    const cliCtx = makeIo();
    cliCtx.hasUI = false;
    const ctx = makeCliSubcommandContext(scope, cliCtx);
    expect(ctx.hasUI).toBe(false);
  });
});
