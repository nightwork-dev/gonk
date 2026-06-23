import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    path: "src/path.ts",
    fs: "src/fs.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  // No `splitting`: each concern is an independent silo, so there is no shared
  // internal code to dedupe. Splitting would only turn each entry into a shim
  // pointing at a hashed chunk — indirection, not isolation. The per-subpath
  // load boundary comes from the separate entry points + the exports map.
  splitting: false,
});
