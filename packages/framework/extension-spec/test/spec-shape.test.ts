/**
 * Type-shape smoke tests. The package is types-only — these tests don't
 * exercise runtime logic, but they do force the TypeScript compiler to
 * verify a representative ExtensionSpec composes correctly. If a type
 * change breaks downstream usage, this file is the canary.
 */

import { describe, expect, it } from "vitest";
import type {
  ExtensionSpec,
  ParsedSubcommandArgs,
  PresetsSpec,
  SettingsSpec,
  SubcommandContext,
} from "../src/types.ts";

describe("ExtensionSpec shape", () => {
  it("composes a minimal spec (id + description only)", () => {
    const spec: ExtensionSpec = {
      id: "minimal",
      description: "A minimal extension.",
    };
    expect(spec.id).toBe("minimal");
  });

  it("composes a spec with all the optional sections", () => {
    const settings: SettingsSpec = {
      scopeKeyPrefix: "demo",
      sections: [
        {
          label: "Demo",
          items: [
            { key: "demo.bind", label: "Bind", type: { kind: "string" } },
            {
              key: "demo.delay",
              label: "Delay",
              type: { kind: "number", min: 0, max: 1000 },
              default: 150,
            },
            {
              key: "demo.viz",
              label: "Visualization",
              type: { kind: "enum", values: ["a", "b", "c"] as const },
              default: "a",
            },
            {
              key: "demo.streaming",
              label: "Streaming",
              type: { kind: "boolean" },
              default: true,
            },
            {
              key: "demo.voice",
              label: "Voice",
              type: { kind: "voice" },
              keyedBy: {
                source: "demo.model",
                mapKey: "demo.voice-by-model",
              },
            },
          ],
        },
      ],
    };

    const presets: PresetsSpec = {
      scopeKey: "demo.presets",
      fields: [
        { scopeKey: "demo.bind", field: "bind" },
        { scopeKey: "demo.delay", field: "delay" },
      ],
      saveTier: "global",
      applyTier: "session",
    };

    const spec: ExtensionSpec = {
      id: "demo",
      description: "Demo extension exercising all sections.",
      settings,
      presets,
      command: {
        name: "demo",
        description: "/demo <subcommand>",
        noArgs: "tui",
        subcommands: {
          go: {
            description: "Run something.",
            handler: (args, ctx) => {
              // Verify the parameter shapes compile.
              const _a: ParsedSubcommandArgs = args;
              const _c: SubcommandContext = ctx;
              void _a;
              void _c;
            },
          },
        },
      },
      hooks: {
        session_start: async (event, ctx) => {
          void event;
          void ctx;
        },
      },
    };

    expect(spec.settings?.sections).toHaveLength(1);
    expect(spec.command?.subcommands?.go).toBeDefined();
    expect(spec.presets?.fields).toHaveLength(2);
  });

  it("supports a function-source on keyedBy", () => {
    const item: SettingsSpec["sections"][number]["items"][number] = {
      key: "x.value",
      label: "Value",
      type: { kind: "string" },
      keyedBy: {
        source: (scope) => scope.get<string>("computed.index"),
        mapKey: "x.value-by-computed",
      },
    };
    expect(item.keyedBy?.source).toBeDefined();
  });

  it("supports a custom-pick setting type", () => {
    const item: SettingsSpec["sections"][number]["items"][number] = {
      key: "x.special",
      label: "Special",
      type: {
        kind: "custom",
        pick: async (_ctx, current, _tier) => current,
      },
    };
    expect(item.type.kind).toBe("custom");
  });
});
