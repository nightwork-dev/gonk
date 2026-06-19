import { describe, expect, it } from "vitest";

import { checkBearer } from "../src/http/auth.ts";

describe("checkBearer (header-only bearer)", () => {
  const KEY = "s3cret-key";

  it("configured + matching Bearer header -> true (case-insensitive scheme)", () => {
    expect(checkBearer(`Bearer ${KEY}`, KEY)).toBe(true);
    expect(checkBearer(`bearer ${KEY}`, KEY)).toBe(true);
  });

  it("configured + missing/wrong -> false", () => {
    expect(checkBearer(undefined, KEY)).toBe(false);
    expect(checkBearer("Bearer wrong", KEY)).toBe(false);
    expect(checkBearer("Basic abc", KEY)).toBe(false);
    expect(checkBearer(KEY, KEY)).toBe(false); // bare token, no Bearer scheme
  });

  it("unconfigured -> keyless (always true)", () => {
    expect(checkBearer(undefined, undefined)).toBe(true);
    expect(checkBearer("Bearer anything", undefined)).toBe(true);
  });
});
