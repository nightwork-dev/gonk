import { describe, expect, it } from "vitest";

import { CLAUDE_HOST_PROFILE } from "../src/index.ts";

describe("CLAUDE_HOST_PROFILE", () => {
  it("declares claude as an out-of-process, enforcing, scoped-injection host", () => {
    expect(CLAUDE_HOST_PROFILE).toEqual({
      host: "claude",
      enforcement: "enforcing",
      injectionModel: "scoped",
      commandSurface: "native",
      scheduling: "none",
      executionLocality: "out-of-process",
    });
  });

  it("covers all five HostCapabilityProfile axes", () => {
    expect(Object.keys(CLAUDE_HOST_PROFILE).sort()).toEqual(
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
