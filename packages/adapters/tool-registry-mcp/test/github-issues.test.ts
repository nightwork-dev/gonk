import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthContext, AuthenticatedPrincipal } from "@gonk/auth";
import {
  ToolRegistry,
  collectToolOutcome,
  makeBaseContext,
} from "@gonk/tool-registry";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createGitHubIssueTools,
  type GitHubIssuesOptions,
} from "../examples/github-issues.ts";
import { createMcpServer } from "../src/index.ts";

interface FixtureState {
  requests: number;
  authorization: string[];
  comments: Array<{ id: number; body: string }>;
}

let fixture: Awaited<ReturnType<typeof startGitHubFixture>>;

beforeEach(async () => {
  fixture = await startGitHubFixture();
});

afterEach(async () => {
  await fixture.close();
});

describe("hand-authored GitHub Issues consumer", () => {
  it("performs a real bearer-authenticated HTTP read and authorized write", async () => {
    let credentialResolutions = 0;
    const registry = approvedRegistry();
    registry.register(
      createGitHubIssueTools(
        options(fixture.origin, () => {
          credentialResolutions += 1;
          return "fixture-token";
        })
      )
    );
    const context = makeBaseContext({ auth: allowAuth() });

    const read = await collectToolOutcome(
      registry.invoke("github-issue-read", { number: 7 }, context)
    );
    const write = await collectToolOutcome(
      registry.invoke(
        "github-issue-comment",
        { number: 7, body: "hermetic proof" },
        context
      )
    );

    expect(read).toMatchObject({
      ok: true,
      data: {
        number: 7,
        title: "Fixture issue",
        state: "open",
        url: "https://github.example/nightwork/gonk/issues/7",
      },
    });
    expect(write).toMatchObject({
      ok: true,
      data: {
        id: 101,
        issueNumber: 7,
        body: "hermetic proof",
      },
    });
    expect(fixture.state.comments).toEqual([
      { id: 101, body: "hermetic proof" },
    ]);
    expect(fixture.state.authorization).toEqual([
      "Bearer fixture-token",
      "Bearer fixture-token",
    ]);
    expect(credentialResolutions).toBe(2);
  });

  it("denies locally before credential resolution or business API I/O", async () => {
    let credentialResolutions = 0;
    const registry = approvedRegistry();
    registry.register(
      createGitHubIssueTools(
        options(fixture.origin, () => {
          credentialResolutions += 1;
          return "fixture-token";
        })
      )
    );

    const denied = await collectToolOutcome(
      registry.invoke(
        "github-issue-comment",
        { number: 7, body: "must not leave process" },
        makeBaseContext({ auth: denyAuth() })
      )
    );

    expect(denied).toMatchObject({ ok: false, code: "TOOL_NOT_FOUND" });
    expect(credentialResolutions).toBe(0);
    expect(fixture.state.requests).toBe(0);
    expect(fixture.state.comments).toEqual([]);
  });

  it("normalizes HTTP errors without leaking credentials", async () => {
    const registry = approvedRegistry();
    registry.register(
      createGitHubIssueTools(options(fixture.origin, () => "fixture-token"))
    );

    const outcome = await collectToolOutcome(
      registry.invoke(
        "github-issue-read",
        { number: 404 },
        makeBaseContext({ auth: allowAuth() })
      )
    );

    expect(outcome).toMatchObject({
      ok: false,
      code: "GITHUB_HTTP_ERROR",
      message: "GitHub request failed with HTTP 404",
      details: {
        status: 404,
        requestId: "fixture-request-404",
        message: "Not Found",
      },
    });
    expect(JSON.stringify(outcome)).not.toContain("fixture-token");
  });

  it("distinguishes caller cancellation and request timeout", async () => {
    const cancelledRegistry = approvedRegistry();
    cancelledRegistry.register(
      createGitHubIssueTools(
        options(fixture.origin, () => "fixture-token", { timeoutMs: 1_000 })
      )
    );
    const controller = new AbortController();
    const cancelledPromise = collectToolOutcome(
      cancelledRegistry.invoke(
        "github-issue-read",
        { number: 99 },
        makeBaseContext({ auth: allowAuth(), signal: controller.signal })
      )
    );
    setTimeout(() => controller.abort(), 10);
    const cancelled = await cancelledPromise;
    expect(cancelled).toMatchObject({ ok: false, code: "ABORTED" });

    const timeoutRegistry = approvedRegistry();
    timeoutRegistry.register(
      createGitHubIssueTools(
        options(fixture.origin, () => "fixture-token", { timeoutMs: 10 })
      )
    );
    const timedOut = await collectToolOutcome(
      timeoutRegistry.invoke(
        "github-issue-read",
        { number: 99 },
        makeBaseContext({ auth: allowAuth() })
      )
    );
    expect(timedOut).toMatchObject({ ok: false, code: "GITHUB_TIMEOUT" });
  });

  it("reprojects the same read and write definitions through MCP", async () => {
    const registry = approvedRegistry();
    registry.register(
      createGitHubIssueTools(options(fixture.origin, () => "fixture-token"))
    );
    const adapter = createMcpServer({
      serverName: "github-fixture",
      serverVersion: "1",
      source: registry,
      makeAuthContext: () => allowAuth(),
      writeToolPolicy: "require-allowlist",
      allowlist: ["github-issue-comment", "github-issue-read"],
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "fixture-client", version: "1" });
    await Promise.all([
      client.connect(clientTransport),
      adapter.connect(serverTransport),
    ]);

    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
      "github-issue-comment",
      "github-issue-read",
    ]);
    const read = await client.callTool({
      name: "github-issue-read",
      arguments: { number: 7 },
    });
    const write = await client.callTool({
      name: "github-issue-comment",
      arguments: { number: 7, body: "through MCP" },
    });

    expect(read.structuredContent).toMatchObject({ number: 7 });
    expect(write.structuredContent).toMatchObject({
      issueNumber: 7,
      body: "through MCP",
    });
    expect(fixture.state.comments).toEqual([
      { id: 101, body: "through MCP" },
    ]);
    await client.close();
  });
});

function options(
  apiBase: string,
  resolveToken: () => string,
  over: Partial<GitHubIssuesOptions> = {}
): GitHubIssuesOptions {
  return {
    owner: "nightwork",
    repository: "gonk",
    apiBase,
    resolveToken,
    ...over,
  };
}

function approvedRegistry(): ToolRegistry {
  return new ToolRegistry({
    security: {
      approvalProvider: {
        decide: () => ({
          outcome: "approved",
          reason: "fixture grants the write",
          grantId: "fixture-grant",
          grantScope: "session",
        }),
      },
    },
  });
}

function allowAuth(): AuthContext {
  return auth(() => ({ outcome: "allow", reason: "fixture policy" }));
}

function denyAuth(): AuthContext {
  return auth(() => ({ outcome: "deny", reason: "fixture policy" }));
}

function auth(authorize: AuthContext["authorize"]): AuthContext {
  const principal: AuthenticatedPrincipal = {
    id: "principal:fixture",
    kind: "service",
    identity: {
      issuer: "https://fixture.example",
      subject: "fixture",
      method: "api-key",
    },
    workspaceId: "workspace-fixture",
    roles: ["github-reader", "github-writer"],
    scopes: [],
  };
  return { principal, authorize };
}

async function startGitHubFixture(): Promise<{
  origin: string;
  state: FixtureState;
  close(): Promise<void>;
}> {
  const state: FixtureState = {
    requests: 0,
    authorization: [],
    comments: [],
  };
  const server = createServer((request, response) => {
    void handleFixture(request, response, state);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    state,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      ),
  };
}

async function handleFixture(
  request: IncomingMessage,
  response: ServerResponse,
  state: FixtureState
): Promise<void> {
  state.requests += 1;
  state.authorization.push(request.headers.authorization ?? "");
  if (request.headers.authorization !== "Bearer fixture-token") {
    return send(response, 401, { message: "Bad credentials" });
  }
  const url = new URL(request.url ?? "/", "http://fixture");
  if (url.pathname.endsWith("/issues/99")) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (request.method === "GET" && url.pathname.endsWith("/issues/7")) {
    return send(response, 200, {
      number: 7,
      title: "Fixture issue",
      state: "open",
      html_url: "https://github.example/nightwork/gonk/issues/7",
      body: "fixture body",
    });
  }
  if (request.method === "POST" && url.pathname.endsWith("/issues/7/comments")) {
    const body = await readJson(request);
    const comment = {
      id: 101,
      body: typeof body.body === "string" ? body.body : "",
    };
    state.comments.push(comment);
    return send(response, 201, {
      id: comment.id,
      html_url: "https://github.example/nightwork/gonk/issues/7#issuecomment-101",
      body: comment.body,
    });
  }
  response.setHeader("x-github-request-id", "fixture-request-404");
  return send(response, 404, { message: "Not Found" });
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function send(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(value));
}
