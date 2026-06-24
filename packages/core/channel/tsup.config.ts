import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    base: "src/base.ts",
    conformance: "src/conformance.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  // conformance.ts imports vitest — it lives behind @gonk/channel/conformance,
  // NOT the root entry, so runtime consumers are never exposed to vitest.
  external: ["vitest"],
});
