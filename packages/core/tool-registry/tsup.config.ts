import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    types: "src/types.ts",
    contracts: "src/contracts.ts",
    registry: "src/registry.ts",
    errors: "src/errors.ts",
    metrics: "src/metrics.ts",
    shape: "src/shape.ts",
    "json-schema": "src/json-schema.ts",
    approval: "src/approval.ts",
    outcome: "src/outcome.ts",
    receipt: "src/receipt.ts",
    lifecycle: "src/lifecycle.ts",
    security: "src/security.ts",
    "async-dispatch": "src/async-dispatch.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: true,
});
