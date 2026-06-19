import { defineConfig } from "tsup";

export default defineConfig({
  entry: { index: "src/index.ts", "http/index": "src/http/index.ts", "http/cli": "src/http/cli.ts" },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  external: ["@modelcontextprotocol/sdk"],
});
