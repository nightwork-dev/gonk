import { serveStdio, type ServeStdioOptions, type StdioServerHandle } from "@modelcontextprotocol/server/stdio";

import { createMcpServer, type McpAdapterOptions } from "./index.ts";

/** Serve the same registry over either MCP lifecycle on a stdio connection. */
export function serveMcpStdio(
  options: McpAdapterOptions,
  transportOptions?: ServeStdioOptions
): StdioServerHandle {
  return serveStdio(() => createMcpServer(options).server, transportOptions);
}
