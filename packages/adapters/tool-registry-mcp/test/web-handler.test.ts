import { describe, expect, it } from "vitest";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

import type { AuthenticatedPrincipal } from "@gonk/auth";
import type { AuthSecurityReceipt } from "@gonk/auth";
import { ToolRegistry, passthrough } from "@gonk/tool-registry";

import { GONK_AUTH_INFO_PRINCIPAL } from "../src/index.ts";
import { createWebMcpHandler, type WebMcpHandler } from "../src/http/web.ts";

const endpoint = "http://app.test/mcp";

function request(
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
  sessionId?: string,
  token?: string
): Request {
  return new Request(endpoint, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(sessionId ? { "mcp-session-id": sessionId } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

function post(body: unknown, sessionId?: string, token?: string): Request {
  return request("POST", body, sessionId, token);
}

function registry(): ToolRegistry {
  const tools = new ToolRegistry();
  tools.register({
    name: "echo",
    description: "echo input",
    input: passthrough(),
    inputJsonSchema: {
      type: "object",
      properties: { text: { type: "string" } },
    },
    handler: async (input: { text: string }, ctx) => ({
      data: {
        text: input.text,
        host: ctx.host,
        principal: ctx.auth?.principal,
      },
    }),
  });
  return tools;
}

async function initialize(
  handler: WebMcpHandler,
  token?: string
): Promise<string> {
  const response = await handler.handle(
    post(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      },
      undefined,
      token
    )
  );
  expect(response.status).toBe(200);
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  return sessionId!;
}

function principal(
  subject: string,
  roles: readonly string[] = ["member"]
): AuthenticatedPrincipal {
  return {
    id: `principal:${subject}`,
    kind: "human",
    identity: {
      issuer: "https://accounts.example",
      subject,
      method: "oauth",
    },
    workspaceId: "workspace-1",
    delegation: {
      actorKind: "agent",
      actor: {
        issuer: "sigil:eve",
        subject: "eve-1",
        method: "service-token",
      },
      actorId: "eve-1",
      actorSessionId: "agent-session-1",
    },
    roles,
    scopes: [],
  };
}

function authInfo(value: AuthenticatedPrincipal, token: string): AuthInfo {
  return {
    token,
    clientId: value.id,
    scopes: [...value.scopes],
    extra: { [GONK_AUTH_INFO_PRINCIPAL]: value },
  };
}

describe("createWebMcpHandler", () => {
  it("requires explicit credential and authorization posture", () => {
    expect(() =>
      createWebMcpHandler({
        source: registry(),
        serverName: "web-test",
        serverVersion: "0",
        allowUnrestrictedTools: true,
      })
    ).toThrow(/apiKey|authenticate|allowInsecure/);
    expect(() =>
      createWebMcpHandler({
        source: registry(),
        serverName: "web-test",
        serverVersion: "0",
        apiKey: "secret",
      })
    ).toThrow(/makeAuthContext|allowUnrestrictedTools/);
  });

  it("mounts stateful MCP on a Web Request/Response route", async () => {
    const handler = createWebMcpHandler({
      source: registry(),
      serverName: "web-test",
      serverVersion: "0",
      allowInsecure: true,
      allowUnrestrictedTools: true,
      enableJsonResponse: true,
      makeContext: () => ({ host: { invoker: "agent", profileId: "sol" } }),
    });
    const sessionId = await initialize(handler);
    await handler.handle(
      post({ jsonrpc: "2.0", method: "notifications/initialized" }, sessionId)
    );
    const response = await handler.handle(
      post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "hi" } },
        },
        sessionId
      )
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          text: "hi",
          host: { invoker: "agent", profileId: "sol" },
        },
      },
    });
    await handler.close();
  });

  it("rejects missing or incorrect bearer credentials", async () => {
    const handler = createWebMcpHandler({
      source: registry(),
      serverName: "web-test",
      serverVersion: "0",
      apiKey: "secret",
      allowUnrestrictedTools: true,
      enableJsonResponse: true,
    });
    expect((await handler.handle(post({}))).status).toBe(401);
    expect((await handler.handle(post({}, undefined, "wrong"))).status).toBe(
      401
    );
    const sessionId = await initialize(handler, "secret");
    const response = await handler.handle(
      post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "hi" } },
        },
        sessionId,
        "secret"
      )
    );
    await expect(response.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          principal: {
            kind: "service",
            identity: {
              issuer: "gonk:static-bearer",
              subject: "static-bearer",
            },
          },
        },
      },
    });
    await handler.close();
  });

  it("rejects custom authentication that does not carry a typed Gonk principal", async () => {
    const handler = createWebMcpHandler({
      source: registry(),
      serverName: "web-test",
      serverVersion: "0",
      allowUnrestrictedTools: true,
      authenticate: () => ({
        token: "opaque",
        clientId: "client-without-principal",
        scopes: [],
      }),
    });
    expect((await handler.handle(post({}, undefined, "opaque"))).status).toBe(
      401
    );
    await handler.close();
  });

  it("rejects an expired SDK auth assertion even when the principal omits expiry", async () => {
    const authenticated = principal("alice");
    const handler = createWebMcpHandler({
      source: registry(),
      serverName: "web-test",
      serverVersion: "0",
      allowUnrestrictedTools: true,
      authenticate: () => ({
        ...authInfo(authenticated, "expired"),
        expiresAt: Math.floor(Date.now() / 1000) - 1,
      }),
    });
    expect((await handler.handle(post({}, undefined, "expired"))).status).toBe(
      401
    );
    await handler.close();
  });

  it("rejects delegated principals without an actor session binding", async () => {
    const { actorSessionId: _actorSessionId, ...delegation } =
      principal("alice").delegation!;
    const unbound = {
      ...principal("alice"),
      delegation,
    };
    const handler = createWebMcpHandler({
      source: registry(),
      serverName: "web-test",
      serverVersion: "0",
      allowUnrestrictedTools: true,
      authenticate: () => authInfo(unbound, "unbound"),
    });
    expect((await handler.handle(post({}, undefined, "unbound"))).status).toBe(
      401
    );
    await handler.close();
  });

  it("pins sessions to the effective subject and delegated actor session", async () => {
    const receipts: AuthSecurityReceipt[] = [];
    const principals: Record<string, AuthenticatedPrincipal> = {
      alice: principal("alice"),
      "alice-refreshed": principal("alice", ["member", "reviewer"]),
      bob: principal("bob"),
      "alice-new-agent-session": {
        ...principal("alice"),
        delegation: {
          ...principal("alice").delegation!,
          actorSessionId: "agent-session-2",
        },
      },
    };
    const handler = createWebMcpHandler({
      source: registry(),
      serverName: "web-test",
      serverVersion: "0",
      allowUnrestrictedTools: true,
      enableJsonResponse: true,
      sessionAuditSink: {
        write: (receipt) => {
          receipts.push(receipt);
        },
      },
      authenticate: (incoming) => {
        const token = incoming.headers
          .get("authorization")
          ?.replace(/^Bearer\s+/, "");
        const authenticated = token ? principals[token] : undefined;
        return authenticated && token ? authInfo(authenticated, token) : null;
      },
    });
    const sessionId = await initialize(handler, "alice");

    const refreshed = await handler.handle(
      post(
        {
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "still alice" } },
        },
        sessionId,
        "alice-refreshed"
      )
    );
    expect(refreshed.status).toBe(200);
    await expect(refreshed.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          principal: {
            identity: { subject: "alice" },
            roles: ["member", "reviewer"],
          },
        },
      },
    });

    expect(
      (
        await handler.handle(
          post(
            {
              jsonrpc: "2.0",
              id: 3,
              method: "tools/call",
              params: { name: "echo", arguments: { text: "bob" } },
            },
            sessionId,
            "bob"
          )
        )
      ).status
    ).toBe(404);
    expect(receipts).toContainEqual(
      expect.objectContaining({
        kind: "session-binding",
        principalId: "principal:bob",
        transport: "mcp",
        outcome: "mismatch",
      })
    );
    expect(JSON.stringify(receipts)).not.toContain(sessionId);
    const malformedMismatch = await handler.handle(
      new Request(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          "mcp-session-id": sessionId,
          authorization: "Bearer bob",
        },
        body: "{",
      })
    );
    expect(malformedMismatch.status).toBe(404);
    expect(
      (await handler.handle(request("GET", undefined, sessionId, "bob"))).status
    ).toBe(404);
    expect(
      (
        await handler.handle(
          request("DELETE", undefined, sessionId, "alice-new-agent-session")
        )
      ).status
    ).toBe(404);

    const aliceAgain = await handler.handle(
      post(
        {
          jsonrpc: "2.0",
          id: 4,
          method: "tools/call",
          params: { name: "echo", arguments: { text: "alice again" } },
        },
        sessionId,
        "alice"
      )
    );
    expect(aliceAgain.status).toBe(200);
    await expect(aliceAgain.json()).resolves.toMatchObject({
      result: {
        structuredContent: {
          text: "alice again",
          principal: { identity: { subject: "alice" } },
        },
      },
    });
    await handler.close();
  });
});
