import { describe, it, expect, vi } from "vitest";
import { MemoryScopeStore } from "@gonk/scope";
import type { ExtensionSpec, SubcommandContext } from "@gonk/extension-spec";
import {
  registerSpecExtensionCli,
  type CliRuntime,
  type CliExtensionContext,
} from "../src/index.ts";

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(async () => "answer"),
  select: vi.fn(),
  confirm: vi.fn(),
  number: vi.fn(),
  editor: vi.fn(),
}));

function makeFakeCli() {
  const commands = new Map<string, (raw: string, ctx: CliExtensionContext) => Promise<void> | void>();
  const hooks = new Map<string, (event: unknown, ctx: CliExtensionContext) => Promise<void> | void>();
  const cli: CliRuntime = {
    registerExtensionCommand: (name, options) => {
      commands.set(name, options.handler);
    },
    on: (event, handler) => {
      hooks.set(event, handler);
    },
  };
  return { cli, commands, hooks };
}

function makeCliCtx(): CliExtensionContext & { stdout: { calls: string[]; write: (s: string) => void }; stderr: { calls: string[]; write: (s: string) => void } } {
  return {
    stdout: { calls: [] as string[], write(s: string) { this.calls.push(s); } },
    stderr: { calls: [] as string[], write(s: string) { this.calls.push(s); } },
    hasUI: false,
    cwd: "/tmp",
    env: {},
  };
}

describe("registerSpecExtensionCli", () => {
  it("registers the command name", () => {
    const { cli, commands } = makeFakeCli();
    const scope = new MemoryScopeStore();
    const spec: ExtensionSpec = {
      id: "fake",
      description: "fake ext",
      command: { name: "fake", description: "Fake command" },
    };
    registerSpecExtensionCli({ cli, scope, spec });
    expect(commands.has("fake")).toBe(true);
  });

  it("dispatches a user-defined verb through the command handler", async () => {
    const { cli, commands } = makeFakeCli();
    const scope = new MemoryScopeStore();
    let captured: string | undefined;
    const spec: ExtensionSpec = {
      id: "fake",
      description: "fake ext",
      command: {
        name: "fake",
        description: "Fake",
        subcommands: {
          greet: {
            description: "say hi",
            handler: (args, _ctx: SubcommandContext) => {
              captured = args.raw;
            },
          },
        },
      },
    };
    registerSpecExtensionCli({ cli, scope, spec });
    const handler = commands.get("fake")!;
    await handler("greet world", makeCliCtx());
    expect(captured).toBe("world");
  });

  it("dispatches the framework-injected set verb", async () => {
    const { cli, commands } = makeFakeCli();
    const scope = new MemoryScopeStore();
    const spec: ExtensionSpec = {
      id: "fake",
      description: "fake ext",
      command: { name: "fake", description: "Fake" },
      settings: {
        scopeKeyPrefix: "fake",
        sections: [
          {
            label: "Fake",
            items: [
              { key: "fake.name", label: "Name", type: { kind: "string" } },
            ],
          },
        ],
      },
    };
    registerSpecExtensionCli({ cli, scope, spec });
    const handler = commands.get("fake")!;
    await handler("set name gimble session", makeCliCtx());
    expect(scope.get("fake.name")).toBe("gimble");
  });

  it("registers hooks via cli.on", () => {
    const { cli, hooks } = makeFakeCli();
    const scope = new MemoryScopeStore();
    let started = false;
    const spec: ExtensionSpec = {
      id: "fake",
      description: "fake ext",
      hooks: {
        session_start: () => {
          started = true;
        },
      },
    };
    registerSpecExtensionCli({ cli, scope, spec });
    expect(hooks.has("session_start")).toBe(true);
    void hooks.get("session_start")!({}, makeCliCtx());
    expect(started).toBe(true);
  });

  it("returns a dispose function (no-op for now)", () => {
    const { cli } = makeFakeCli();
    const scope = new MemoryScopeStore();
    const spec: ExtensionSpec = { id: "fake", description: "fake" };
    const dispose = registerSpecExtensionCli({ cli, scope, spec });
    expect(typeof dispose).toBe("function");
    expect(() => dispose()).not.toThrow();
  });

  it("status fallback prints settings status to stderr when hasUI is false", async () => {
    const { cli, commands } = makeFakeCli();
    const scope = new MemoryScopeStore();
    scope.set("fake.name", "bob", "session");
    const spec: ExtensionSpec = {
      id: "fake",
      description: "fake ext",
      command: { name: "fake", description: "Fake" },
      settings: {
        scopeKeyPrefix: "fake",
        sections: [
          {
            label: "Fake",
            items: [{ key: "fake.name", label: "Name", type: { kind: "string" } }],
          },
        ],
      },
    };
    registerSpecExtensionCli({ cli, scope, spec });
    const handler = commands.get("fake")!;
    const cliCtx = makeCliCtx();
    await handler("", cliCtx);
    const out = cliCtx.stderr.calls.join("");
    expect(out).toContain("Name:");
    expect(out).toContain("bob");
  });
});
