// @gonk/tool-registry-mcp/http — streamable-HTTP MCP transport for the gonk tool
// registry. Re-transports the stdio adapter's createMcpServer over HTTP so
// remote/host-agnostic MCP clients (Eve connections, flue, curl, any MCP client)
// can reach a gonk capability suite over the network.

export { createHttpMcpServer } from "./server.ts";
export { createWebMcpHandler } from "./web.ts";
export { checkBearer } from "./auth.ts";

export type { HttpMcpServerOptions, HttpMcpServer } from "./types.ts";
export type { WebMcpHandlerOptions, WebMcpHandler } from "./web.ts";
