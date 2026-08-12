import { ownerPrincipal } from "@gonk/auth";
import type { ExtensionSpec } from "@gonk/extension-spec";
import type { PiToolSpec } from "@gonk/tool-registry-pi";
import { describe, expect, it, vi } from "vitest";

import { registerSpecExtension } from "../src/runtime.ts";

const scope = { get: () => undefined, set: () => {}, delete: () => {} } as never;
const auth = ownerPrincipal({ USER: "extension-spec-pi-security-test" });

function writeSpec(): ExtensionSpec {
  return {
    id: "writer",
    description: "writer",
    tools: [{
      name: "write_value",
      description: "Write a value",
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value: unknown) => ({ value }),
        },
      },
      approval: "write",
      handler: async () => ({ data: { written: true } }),
    }],
  };
}

function fakePi() {
  const tools: PiToolSpec[] = [];
  return {
    tools,
    api: {
      registerTool: (tool: PiToolSpec) => tools.push(tool),
      registerCommand: vi.fn(),
      on: vi.fn(),
    },
  };
}

describe("registerSpecExtension security policy", () => {
  it("runs a write tool when the trusted host explicitly bypasses approval", async () => {
    const pi = fakePi();
    registerSpecExtension({
      pi: pi.api,
      scope,
      auth,
      security: { approvalMode: "bypass" },
      spec: writeSpec(),
    });

    const result = await pi.tools[0]!.execute(
      "call-1",
      {},
      new AbortController().signal,
      undefined,
      {},
    );

    expect(result.isError).not.toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "{\"written\":true}" }]);
  });

  it("fails closed when approval is enforced without a provider", async () => {
    const pi = fakePi();
    registerSpecExtension({
      pi: pi.api,
      scope,
      auth,
      security: { approvalMode: "enforce" },
      spec: writeSpec(),
    });

    const result = await pi.tools[0]!.execute(
      "call-2",
      {},
      new AbortController().signal,
      undefined,
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect((result.content[0] as { text: string }).text).toContain("APPROVAL_DENIED");
  });
});
