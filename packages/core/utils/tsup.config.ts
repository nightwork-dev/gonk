import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    fs: "src/fs.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: true,
});
