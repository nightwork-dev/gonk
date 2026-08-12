import { afterEach, describe, expect, it, vi } from "vitest";
import { ownerPrincipal, type AuthContext } from "@gonk/auth";
import type { ExtensionSpec } from "@gonk/extension-spec";
import { clearGonkExtensions, findGonkExtension } from "@gonk/tool-registry-pi";

import { registerSpecExtension } from "../src/runtime.ts";

function fakePi() {
  return { registerTool: vi.fn(), registerCommand: vi.fn(), on: vi.fn() };
}
const fakeScope = { get: () => undefined, set: () => {}, delete: () => {} } as never;
// GR-83: RegisterSpecOptions.auth is required. Neither test here registers
// tools, so this is never dispatched into the registry — only present to
// satisfy the type, same as a real host binding once at startup.
const auth: AuthContext = ownerPrincipal({ USER: "extension-spec-pi-test" });

afterEach(() => clearGonkExtensions());

describe("registerSpecExtension — readiness threading", () => {
  it("records spec.readiness onto the process-wide extension record", () => {
    const spec: ExtensionSpec = {
      id: "voice",
      description: "voice",
      readiness: [
        { id: "voice.tts", label: "Text-to-speech", probe: () => ({ status: "ready" }) },
      ],
    };

    registerSpecExtension({
      pi: fakePi() as never,
      scope: fakeScope,
      auth,
      security: { approvalMode: "bypass" },
      spec,
      packageName: "@gonk/pi-voice",
    });

    const rec = findGonkExtension("@gonk/pi-voice");
    expect(rec?.readiness?.[0]?.id).toBe("voice.tts");
    // Re-runnable after registration — reads live state, not setup-time state.
    expect(rec?.readiness?.[0]?.probe().status).toBe("ready");
  });

  it("records no readiness when the spec declares none", () => {
    const spec: ExtensionSpec = { id: "introspect", description: "x" };
    registerSpecExtension({
      pi: fakePi() as never,
      scope: fakeScope,
      auth,
      security: { approvalMode: "bypass" },
      spec,
      packageName: "@gonk/pi-introspect",
    });
    expect(findGonkExtension("@gonk/pi-introspect")?.readiness).toBeUndefined();
  });
});
