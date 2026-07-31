import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    client: "src/client.ts",
    "http/index": "src/http/index.ts",
    "http/cli": "src/http/cli.ts",
    "dev/index": "src/dev/index.ts",
    "dev/cli": "src/dev/cli.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  splitting: false,
  external: [
    "@modelcontextprotocol/client",
    "@modelcontextprotocol/server",
  ],
});
