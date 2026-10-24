import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  REGISTRY_REPLAY_FIXTURE,
  REGISTRY_REPLAY_EXPECTED,
  runTypeScriptRegistryConformance,
} from "../../../../scripts/python-registry-conformance.ts";

describe("native Python tool-registry conformance", () => {
  it("keeps the checked-in generated transcript fresh against the actual TS registry", async () => {
    const fixture = JSON.parse(await readFile(REGISTRY_REPLAY_FIXTURE, "utf8")) as {
      cases: Array<{ id: string }>;
    };
    const expected = JSON.parse(await readFile(REGISTRY_REPLAY_EXPECTED, "utf8"));
    expect(fixture.cases.length, "tool-registry conformance fixture must not be empty").toBeGreaterThan(0);
    expect(expected.cases.length, "tool-registry conformance transcript must not be empty").toBeGreaterThan(0);
    const actual = await runTypeScriptRegistryConformance(REGISTRY_REPLAY_FIXTURE);
    expect(actual.generatedBy).toBe(expected.generatedBy);
    expect(actual.version).toBe(expected.version);
    expect(actual.cases).toHaveLength(expected.cases.length);
    for (const [index, expectedCase] of expected.cases.entries()) {
      const actualCase = actual.cases[index];
      expect(actualCase?.id, `case ${expectedCase.id}`).toBe(expectedCase.id);
      expect(actualCase?.events, `case ${expectedCase.id}`).toEqual(expectedCase.events);
    }
    expect(JSON.stringify(expected)).not.toMatch(/principal:|timestamp/);
  });
});
