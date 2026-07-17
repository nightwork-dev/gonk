import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    conformance: "src/conformance.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: true,
  external: ["vitest"],
});
