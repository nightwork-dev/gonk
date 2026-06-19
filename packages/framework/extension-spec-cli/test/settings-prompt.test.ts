import { describe, it, expect, vi, beforeEach } from "vitest";
import { MemoryScopeStore } from "@gonk/scope";
import type { SettingsSpec } from "@gonk/extension-spec";
import { runSettingsConfigPrompt } from "../src/settings-prompt.ts";

vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  number: vi.fn(),
  editor: vi.fn(),
}));

import * as prompts from "@inquirer/prompts";

const settings: SettingsSpec = {
  scopeKeyPrefix: "x",
  sections: [
    {
      label: "Test",
      items: [
        { key: "x.name", label: "Name", type: { kind: "string" }, default: "anon" },
        { key: "x.flag", label: "Flag", type: { kind: "boolean" }, default: false },
        { key: "x.size", label: "Size", type: { kind: "enum", values: ["s", "m", "l"] as const }, default: "m" },
        { key: "x.count", label: "Count", type: { kind: "number", min: 1, max: 10 }, default: 3 },
      ],
    },
  ],
};

describe("runSettingsConfigPrompt", () => {
  beforeEach(() => {
    vi.mocked(prompts.input).mockReset();
    vi.mocked(prompts.select).mockReset();
    vi.mocked(prompts.confirm).mockReset();
    vi.mocked(prompts.number).mockReset();
  });

  it("prompts for each setting in order and writes to scope", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("gimble");
    vi.mocked(prompts.confirm).mockResolvedValueOnce(true);
    vi.mocked(prompts.select).mockResolvedValueOnce("l");
    vi.mocked(prompts.number).mockResolvedValueOnce(7);

    const scope = new MemoryScopeStore();
    await runSettingsConfigPrompt({
      scope,
      spec: settings,
      tier: "session",
    });

    expect(scope.get("x.name")).toBe("gimble");
    expect(scope.get("x.flag")).toBe(true);
    expect(scope.get("x.size")).toBe("l");
    expect(scope.get("x.count")).toBe(7);
  });

  it("skips a setting when prompt returns undefined (user cancelled)", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce(undefined as unknown as string);
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);
    vi.mocked(prompts.select).mockResolvedValueOnce("s");
    vi.mocked(prompts.number).mockResolvedValueOnce(2);

    const scope = new MemoryScopeStore();
    scope.set("x.name", "preset", "session");
    await runSettingsConfigPrompt({
      scope,
      spec: settings,
      tier: "session",
    });

    expect(scope.get("x.name")).toBe("preset");
    expect(scope.get("x.flag")).toBe(false);
    expect(scope.get("x.size")).toBe("s");
    expect(scope.get("x.count")).toBe(2);
  });

  it("uses current scope value as default when present", async () => {
    const scope = new MemoryScopeStore();
    scope.set("x.name", "existing", "session");
    vi.mocked(prompts.input).mockResolvedValueOnce("existing");
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);
    vi.mocked(prompts.select).mockResolvedValueOnce("m");
    vi.mocked(prompts.number).mockResolvedValueOnce(3);

    await runSettingsConfigPrompt({ scope, spec: settings, tier: "session" });
    expect(vi.mocked(prompts.input).mock.calls[0]?.[0]).toMatchObject({
      default: "existing",
    });
  });

  it("writes to the requested tier", async () => {
    vi.mocked(prompts.input).mockResolvedValueOnce("g");
    vi.mocked(prompts.confirm).mockResolvedValueOnce(false);
    vi.mocked(prompts.select).mockResolvedValueOnce("m");
    vi.mocked(prompts.number).mockResolvedValueOnce(3);

    const scope = new MemoryScopeStore();
    await runSettingsConfigPrompt({ scope, spec: settings, tier: "global" });
    expect(scope.get("x.name")).toBe("g");
  });

  it("skips picker types and writes a stderr hint when no editPickerType", async () => {
    const spec: SettingsSpec = {
      scopeKeyPrefix: "x",
      sections: [{
        label: "T",
        items: [
          { key: "x.model", label: "Model", type: { kind: "model" } },
        ],
      }],
    };
    const stderr: string[] = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((s: string) => { stderr.push(s); return true; }) as typeof process.stderr.write;
    try {
      await runSettingsConfigPrompt({
        scope: new MemoryScopeStore(),
        spec,
        tier: "session",
      });
    } finally {
      process.stderr.write = origWrite;
    }
    expect(stderr.join("")).toContain("editPickerType");
  });

  it("delegates picker types to editPickerType and writes the result", async () => {
    const spec: SettingsSpec = {
      scopeKeyPrefix: "x",
      sections: [{
        label: "T",
        items: [
          { key: "x.model", label: "Model", type: { kind: "model" } },
        ],
      }],
    };
    const scope = new MemoryScopeStore();
    await runSettingsConfigPrompt({
      scope,
      spec,
      tier: "session",
      editPickerType: async () => "gpt-5",
    });
    expect(scope.get("x.model")).toBe("gpt-5");
  });
});
