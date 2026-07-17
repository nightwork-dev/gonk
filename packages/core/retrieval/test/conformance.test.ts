import { describe, expect, it } from "vitest";

import {
  retrievalConformanceCases,
  retrievalConformanceDocuments,
} from "../src/conformance.ts";

describe("runner-neutral conformance export", () => {
  it("contains executable cases and stable fixtures without a test-runner dependency", () => {
    expect(retrievalConformanceCases().length).toBeGreaterThan(0);
    expect(retrievalConformanceDocuments.alpha.resource.id).toBe("alpha");
  });
});
