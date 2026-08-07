import { describe, expect, it } from "vitest";

import { CODEX_HOST_PROFILE } from "../src/index.ts";

describe("CODEX_HOST_PROFILE", () => {
  it("declares codex as an out-of-process, observe-only, scoped-injection host with no native command surface", () => {
    expect(CODEX_HOST_PROFILE).toEqual({
      host: "codex",
      enforcement: "observe-only",
      injectionModel: "scoped",
      commandSurface: "none",
      scheduling: "none",
      executionLocality: "out-of-process",
    });
  });

  it("covers all five HostCapabilityProfile axes", () => {
    expect(Object.keys(CODEX_HOST_PROFILE).sort()).toEqual(
      [
        "commandSurface",
        "enforcement",
        "executionLocality",
        "host",
        "injectionModel",
        "scheduling",
      ].sort(),
    );
  });
});
