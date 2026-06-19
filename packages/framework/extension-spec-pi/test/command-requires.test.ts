import { describe, expect, it, vi } from "vitest";
import type { ExtensionSpec, SubcommandContext } from "@gonk/extension-spec";

import { buildCommandHandler } from "../src/command.ts";

function makeCtx(notify = vi.fn()): SubcommandContext {
  return {
    scope: { get: () => undefined, set: () => {}, delete: () => {} } as never,
    notify,
    hasUI: false,
    host: {} as never,
  } as SubcommandContext;
}

describe("buildCommandHandler — requires predicate filtering", () => {
  it("invokes a verb whose requires returns true", async () => {
    const enabled = vi.fn();
    const spec: ExtensionSpec = {
      id: "test",
      description: "x",
      command: {
        name: "test",
        description: "x",
        subcommands: {
          enabled: {
            description: "always-on",
            handler: enabled,
            requires: () => true,
          },
        },
      },
    };
    const handler = buildCommandHandler(spec, { openTui: async () => {} });
    await handler("enabled", makeCtx());
    expect(enabled).toHaveBeenCalledOnce();
  });

  it("treats a verb whose requires returns false as unknown", async () => {
    const disabled = vi.fn();
    const notify = vi.fn();
    const spec: ExtensionSpec = {
      id: "test",
      description: "x",
      command: {
        name: "test",
        description: "x",
        subcommands: {
          disabled: {
            description: "config-gated, NOT configured",
            handler: disabled,
            requires: () => false,
          },
        },
      },
    };
    const handler = buildCommandHandler(spec, { openTui: async () => {} });
    await handler("disabled", makeCtx(notify));
    expect(disabled).not.toHaveBeenCalled();
    // Hitting an unknown verb should yield a notify call (typically the help
    // / unknown-subcommand path). We don't pin the exact text — just that
    // the handler did NOT silently dispatch the disabled verb.
    expect(notify).toHaveBeenCalled();
  });

  it("verbs without requires are unaffected", async () => {
    const enabled = vi.fn();
    const spec: ExtensionSpec = {
      id: "test",
      description: "x",
      command: {
        name: "test",
        description: "x",
        subcommands: {
          enabled: { description: "always-on", handler: enabled },
        },
      },
    };
    const handler = buildCommandHandler(spec, { openTui: async () => {} });
    await handler("enabled", makeCtx());
    expect(enabled).toHaveBeenCalledOnce();
  });
});
