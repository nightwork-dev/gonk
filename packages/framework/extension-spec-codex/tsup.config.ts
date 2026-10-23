import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    types: "src/types.ts",
    materialize: "src/materialize.ts",
    placement: "src/placement.ts",
    "run-hook": "src/run-hook.ts",
    storage: "src/storage.ts",
    "bin/gonk-codex-hook": "src/bin/gonk-codex-hook.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  // run-hook serializes function bodies into standalone plugin modules; keep them executable.
  minify: false,
  target: "es2022",
  splitting: true,
});
