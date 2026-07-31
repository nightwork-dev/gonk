import type { AuthInfo } from "@modelcontextprotocol/server";
import type { AuthAuditSink } from "@gonk/auth";

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
  /** Stable client identity used for the synthetic static-bearer principal. */
  staticBearerClientId?: string;
  /** Host-owned authentication adapter. Return SDK AuthInfo with a validated
   *  `AuthenticatedPrincipal` in
   *  `extra[GONK_AUTH_INFO_PRINCIPAL]`. */
  authenticate?: (
    request: Request
  ) => AuthInfo | null | Promise<AuthInfo | null>;
  /** Optional redacted sink for rejected cross-principal session reuse. */
  sessionAuditSink?: AuthAuditSink;
  /** Explicit trusted-service mode that authorizes every registry action after
   *  authentication. Prefer makeAuthContext for product policy. */
  allowUnrestrictedTools?: boolean;
  /** Acknowledge that a non-loopback bind with no `apiKey` exposes
   *  unauthenticated tool execution to the network. Without this, binding a
   *  non-loopback host (e.g. `0.0.0.0`) with no key throws at construction
   *  rather than silently standing up an open endpoint. Set it deliberately for
   *  a genuinely trusted-network deployment (e.g. a firewalled tailnet). */
  allowInsecure?: boolean;
  /** Endpoint path the MCP transport is mounted at. Default "/mcp". */
  path?: string;
  /** Enable the SDK's DNS-rebinding protection (Host-header allow-listing).
   *  Stops a drive-by browser request (a malicious page POSTing to a localhost
   *  endpoint) from rebinding onto this server. Default depends on the bind:
   *  - **loopback** → on, auto-allow-listing the bound host:port + loopback
   *    aliases (the client's Host is exactly that).
   *  - **non-loopback with `allowedHosts` set** → on, using those.
   *  - **non-loopback, keyless trusted-tailnet (`allowInsecure`)** → off; the
   *    network perimeter is the boundary and Host-checking would only break
   *    legitimate access.
   *  - **non-loopback otherwise** → would be on but has no sound allowlist, so
   *    construction throws (see `allowedHosts`). Set this explicitly to override
   *    — but note an explicit `true` on a non-loopback bind still requires
   *    `allowedHosts`, else the same throw fires (the bound address can't be
   *    auto-allow-listed). */
  enableDnsRebindingProtection?: boolean;
  /** Allowed `Host` header values when DNS-rebinding protection is on. Only
   *  auto-defaulted for a loopback bind (bound host:port + loopback aliases).
   *  REQUIRED for a protected non-loopback bind — the bound address is not a
   *  client-sendable Host (a wildcard like `0.0.0.0` never appears as `Host`),
   *  so without it every request is rejected on the Host check. Set it to the
   *  name(s) clients will actually dial. */
  allowedHosts?: string[];
  /** Allowed `Origin` header values when the SDK transport's origin protection
   *  is enabled. */
  allowedOrigins?: string[];
}

export interface HttpMcpServer {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** The bound port (resolved after start when port 0 was requested). */
  readonly port: number;
}
