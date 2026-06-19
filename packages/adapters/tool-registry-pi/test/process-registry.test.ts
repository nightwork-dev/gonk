import { afterEach, describe, expect, it } from "vitest";
import type { CapabilityReadiness } from "@gonk/tool-registry";

import {
  clearGonkExtensions,
  findGonkExtension,
  listGonkExtensions,
  recordGonkExtension,
} from "../src/process-registry.ts";

const sttReadiness: CapabilityReadiness = {
  id: "voice.stt",
  label: "Speech-to-text",
  probe: () => ({
    status: "needs-setup",
    detail: "no provider configured",
    fix: "set voice.stt.providers",
    settingsKeys: ["voice.stt.providers"],
  }),
};

afterEach(() => clearGonkExtensions());

describe("process-registry — capability readiness round-trip", () => {
  it("stores readiness descriptors and returns them via list/find", () => {
    recordGonkExtension({
      specId: "voice",
      packageName: "@gonk/pi-voice",
      readiness: [sttReadiness],
    });

    const all = listGonkExtensions();
    expect(all).toHaveLength(1);
    expect(all[0]?.readiness).toHaveLength(1);
    expect(all[0]?.readiness?.[0]?.id).toBe("voice.stt");

    // The probe survives the round-trip as a live, re-runnable closure.
    expect(all[0]?.readiness?.[0]?.probe().status).toBe("needs-setup");

    const found = findGonkExtension("@gonk/pi-voice");
    expect(found?.readiness?.[0]?.label).toBe("Speech-to-text");
  });

  it("omits readiness when an extension declares none (back-compat)", () => {
    recordGonkExtension({ specId: "introspect", packageName: "@gonk/pi-introspect" });
    const rec = findGonkExtension("@gonk/pi-introspect");
    expect(rec).toBeDefined();
    expect(rec?.readiness).toBeUndefined();
  });
});
