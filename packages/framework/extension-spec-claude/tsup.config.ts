import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    types: "src/types.ts",
    materialize: "src/materialize.ts",
    placement: "src/placement.ts",
    "run-hook": "src/run-hook.ts",
    "bin/gonk-claude-hook": "src/bin/gonk-claude-hook.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: true,
});
