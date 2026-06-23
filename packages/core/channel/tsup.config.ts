import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    base: "src/base.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  // The conformance suite factory (re-exported from the root, spec §8) imports
  // the vitest DSL. Keep the framework OUT of the published bundle — a consumer
  // running the suite already has vitest; a non-test importer never reaches it.
  external: ["vitest"],
});
