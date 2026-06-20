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
   *  When omitted, no credential is required (keyless). Keyless is only allowed
   *  on a loopback bind, or on a non-loopback bind when `allowInsecure` is set —
   *  see `allowInsecure`. */
  apiKey?: string;
  /** Acknowledge that a non-loopback bind with no `apiKey` exposes
   *  unauthenticated tool execution to the network. Without this, binding a
   *  non-loopback host (e.g. `0.0.0.0`) with no key throws at construction
   *  rather than silently standing up an open endpoint. Set it deliberately for
   *  a genuinely trusted-network deployment (e.g. a firewalled tailnet). */
  allowInsecure?: boolean;
  /** Endpoint path the MCP transport is mounted at. Default "/mcp". */
  path?: string;
  /** Enable the SDK's DNS-rebinding protection (Host-header allow-listing).
   *  Default **on** — it stops a drive-by browser request (a malicious page
   *  POSTing to a localhost endpoint) from rebinding onto this server. When on
   *  and `allowedHosts` is unset, the bound host:port (plus loopback aliases) is
   *  allow-listed automatically. Set false only when a proxy rewrites Host. */
  enableDnsRebindingProtection?: boolean;
  /** Allowed `Host` header values when DNS-rebinding protection is on. When
   *  unset, defaults to the bound host:port and its loopback aliases. */
  allowedHosts?: string[];
}

export interface HttpMcpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The bound port (resolved after start when port 0 was requested). */
  readonly port: number;
}
