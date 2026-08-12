import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "legacy-import": "src/legacy-import.ts",
    sqlite: "src/mirk-backend.ts",
    types: "src/types.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: true,
});
