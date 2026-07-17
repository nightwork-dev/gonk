import { describe, it } from "vitest";

import { managedSkillRegistryConformanceCases } from "../src/conformance.ts";

import { makeFilesystemHarness } from "./harness.ts";

describe("ManagedSkillRegistry conformance", () => {
  for (const testCase of managedSkillRegistryConformanceCases()) {
    it(testCase.name, () => testCase.run(makeFilesystemHarness));
  }
});
