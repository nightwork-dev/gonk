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
});
