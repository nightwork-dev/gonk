import { describe, expect, it, vi } from "vitest";
import { MemoryScopeStore } from "@gonk/scope/memory";

import {
  captureProjectTrust,
  readProjectTrustApprove,
  PROJECT_TRUST_SCOPE_KEY,
} from "../src/project-trust.ts";
import type { PiExtensionAPI, PiExtensionContext, PiHookHandler } from "../src/pi-types.ts";

/** Fake ExtensionAPI that records the handler registered for each event so the
 *  test can fire `session_start` with a chosen ctx. */
function fakePi(): { pi: PiExtensionAPI; fire: (event: string, ctx: PiExtensionContext) => Promise<void> } {
  const handlers = new Map<string, PiHookHandler>();
  const pi: PiExtensionAPI = {
    registerTool: () => undefined,
    registerCommand: () => undefined,
    on: (event: string, handler: PiHookHandler) => {
      handlers.set(event, handler);
      return undefined;
    },
  };
  return {
    pi,
    fire: async (event, ctx) => {
      await handlers.get(event)?.({}, ctx);
    },
  };
}

describe("captureProjectTrust / readProjectTrustApprove", () => {
  it("captures a trusted decision into session scope, readable as approve=true", async () => {
    const scope = new MemoryScopeStore();
    const { pi, fire } = fakePi();
    captureProjectTrust(pi, scope);

    await fire("session_start", { hasUI: false, ui: { notify: () => {} }, isProjectTrusted: () => true });

    expect(scope.get(PROJECT_TRUST_SCOPE_KEY, "session")).toBe(true);
    expect(readProjectTrustApprove(scope)).toBe(true);
  });

  it("captures a declined decision as approve=false", async () => {
    const scope = new MemoryScopeStore();
    const { pi, fire } = fakePi();
    captureProjectTrust(pi, scope);

    await fire("session_start", { hasUI: false, ui: { notify: () => {} }, isProjectTrusted: () => false });

    expect(readProjectTrustApprove(scope)).toBe(false);
  });

  it("writes nothing when the host has no isProjectTrusted (older pi)", async () => {
    const scope = new MemoryScopeStore();
    const { pi, fire } = fakePi();
    captureProjectTrust(pi, scope);

    // ctx without the method — the feature gate must skip the write entirely.
    await fire("session_start", { hasUI: false, ui: { notify: () => {} } });

    expect(readProjectTrustApprove(scope)).toBeUndefined();
  });

  it("clears a stale value left by a trust-aware session when the host is trust-blind", async () => {
    // Simulate the cwd-shared store: a prior pi 0.79 session wrote `true`.
    const scope = new MemoryScopeStore();
    scope.set(PROJECT_TRUST_SCOPE_KEY, true, "session");

    // Now a pi 0.75.5 session (no isProjectTrusted) starts in the same cwd.
    const { pi, fire } = fakePi();
    captureProjectTrust(pi, scope);
    await fire("session_start", { hasUI: false, ui: { notify: () => {} } });

    // The stale `true` must be gone — else the worker would get an --approve
    // that pi 0.75.5 rejects with "Unknown option".
    expect(readProjectTrustApprove(scope)).toBeUndefined();
  });

  it("never throws out of session_start when the scope write fails", async () => {
    const scope = new MemoryScopeStore();
    vi.spyOn(scope, "set").mockImplementation(() => {
      throw new Error("no writable session root");
    });
    const { pi, fire } = fakePi();
    captureProjectTrust(pi, scope);

    await expect(
      fire("session_start", { hasUI: false, ui: { notify: () => {} }, isProjectTrusted: () => true }),
    ).resolves.toBeUndefined();
  });

  it("readProjectTrustApprove tolerates an undefined scope", () => {
    expect(readProjectTrustApprove(undefined)).toBeUndefined();
  });
});
