import { describe, expect, it } from "vitest";

import { PI_HOST_PROFILE } from "../src/index.ts";

describe("PI_HOST_PROFILE", () => {
  it("declares pi as an in-process, enforcing, event-driven host", () => {
    expect(PI_HOST_PROFILE).toEqual({
      host: "pi",
      enforcement: "enforcing",
      injectionModel: "event-driven",
      commandSurface: "native",
      scheduling: "none",
      executionLocality: "in-process",
    });
  });

  it("covers all five HostCapabilityProfile axes", () => {
    expect(Object.keys(PI_HOST_PROFILE).sort()).toEqual(
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
