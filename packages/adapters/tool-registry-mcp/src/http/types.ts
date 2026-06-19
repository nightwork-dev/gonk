import type { McpAdapterOptions } from "../index.ts";

/** Options for the streamable-HTTP MCP server. Extends the stdio adapter's
 *  `McpAdapterOptions` (same tool→MCP mapping config — source, serverName,
 *  serverVersion, writeToolPolicy, allowlist, log, scope) with the HTTP binding
 *  fields. The mapping is reused wholesale via `createMcpServer`; only the
 *  transport differs. */
export interface HttpMcpServerOptions extends McpAdapterOptions {
  /** Bind address. Default "127.0.0.1"; "0.0.0.0" for tailnet-wide. */
  host?: string;
  /** TCP port. Default 0 (ephemeral — pick a real port for a long-running server). */
  port?: number;
  /** Bearer token. When set, every request needs `Authorization: Bearer <key>`.
   *  When omitted, no credential is required (trusted-tailnet mode). */
  apiKey?: string;
  /** Endpoint path the MCP transport is mounted at. Default "/mcp". */
  path?: string;
  /** Enable the SDK's Origin/DNS-rebinding protection (Host/Origin allow-listing).
   *  Default off — the tailnet ACL is the primary boundary. Set true (with
   *  `allowedHosts`) when exposing beyond a trusted tailnet. */
  enableDnsRebindingProtection?: boolean;
  /** Allowed `Host` header values when DNS-rebinding protection is on. */
  allowedHosts?: string[];
}

export interface HttpMcpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The bound port (resolved after start when port 0 was requested). */
  readonly port: number;
}
