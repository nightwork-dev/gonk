import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    types: "src/types.ts",
    registry: "src/registry.ts",
    errors: "src/errors.ts",
    metrics: "src/metrics.ts",
    shape: "src/shape.ts",
    approval: "src/approval.ts",
    outcome: "src/outcome.ts",
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
