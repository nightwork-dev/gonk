import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "parse-args": "src/parse-args.ts",
    "keyed-by": "src/keyed-by.ts",
    presets: "src/presets.ts",
    settings: "src/settings.ts",
    "settings-tui": "src/settings-tui.ts",
    "entity-list-tui": "src/entity-list-tui.ts",
    command: "src/command.ts",
    runtime: "src/runtime.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: true,
});
