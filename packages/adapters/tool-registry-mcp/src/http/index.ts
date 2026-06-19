// @gonk/tool-registry-mcp-http — streamable-HTTP MCP transport for the gonk tool
// registry. Re-transports @gonk/tool-registry-mcp's createMcpServer over HTTP so
// remote/host-agnostic MCP clients (Eve connections, flue, any MCP client) can
// reach gonk's capability suite.

export { createHttpMcpServer } from "./server.ts";
export { checkBearer } from "./auth.ts";

export type { HttpMcpServerOptions, HttpMcpServer } from "./types.ts";
