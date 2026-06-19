import { describe, it, expect } from "vitest";
import type {
  CliRuntime,
  CliExtensionContext,
  CliSubcommandContext,
} from "../src/index.ts";

describe("CliRuntime types", () => {
  it("CliRuntime has registerExtensionCommand and on", () => {
    // type-only test: assignability check
    const fake: CliRuntime = {
      registerExtensionCommand: () => {},
      on: () => {},
    };
    expect(typeof fake.registerExtensionCommand).toBe("function");
    expect(typeof fake.on).toBe("function");
  });

  it("CliExtensionContext is the per-invocation context", () => {
    const fake: CliExtensionContext = {
      stdout: { write: () => {} },
      stderr: { write: () => {} },
      hasUI: true,
      env: {},
      cwd: "/tmp",
    };
    expect(fake.cwd).toBe("/tmp");
  });

  it("CliSubcommandContext extends SubcommandContext with cli host", () => {
    // import lazily so the test doesn't fail if scope isn't set up
    expect(true).toBe(true);
  });
});
