import type { StandardSchemaV1 } from "@standard-schema/spec";
import {
  type AuthContext,
  type AuthSecurityReceipt,
  type AuthenticatedPrincipal,
  type AuthzResource,
} from "@gonk/auth";
import { describe, expect, it } from "vitest";

import {
  ToolRegistry,
  makeBaseContext,
  passthrough,
  type ToolEvent,
  type ToolRegistrySecurityOptions,
} from "../src/index.ts";

function principal(): AuthenticatedPrincipal {
  return {
    id: "principal:user-1",
    kind: "human",
    identity: {
      issuer: "https://accounts.example",
      subject: "user-1",
      method: "oauth",
    },
    workspaceId: "workspace-1",
    delegation: {
      actorKind: "agent",
      actor: {
        issuer: "sigil:eve",
        subject: "agent-1",
        method: "service-token",
      },
      actorId: "eve-agent-1",
      actorSessionId: "session-1",
    },
    roles: ["member"],
    scopes: [],
  };
}

function auth(authorize: AuthContext["authorize"]): AuthContext {
  return { principal: principal(), authorize };
}

async function collect(stream: AsyncIterable<ToolEvent>): Promise<ToolEvent[]> {
  const events: ToolEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function securedContext(value: AuthContext) {
  return makeBaseContext({ auth: value });
}

describe("secured ToolRegistry dispatch", () => {
  it("returns the exact missing-tool event before validating a hidden root tool", async () => {
    let validations = 0;
    const input: StandardSchemaV1<unknown, unknown> = {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (value) => {
          validations += 1;
          return { value };
        },
      },
    };
    const registry = new ToolRegistry();
    registry.register({
      name: "hidden",
      description: "hidden",
      input,
      handler: async () => ({ data: { leaked: true } }),
    });
    const ctx = securedContext(
      auth(({ action }) => ({
        outcome: action === "tool.discover" ? "deny" : "allow",
        reason: "hidden",
      }))
    );

    const hidden = await collect(
      registry.invoke("hidden", { wrong: true }, ctx)
    );
    const empty = new ToolRegistry();
    const missing = await collect(
      empty.invoke("hidden", {}, makeBaseContext())
    );

    expect(hidden).toEqual(missing);
    expect(hidden).toEqual([
      {
        type: "error",
        code: "TOOL_NOT_FOUND",
        message: "No such tool: hidden",
      },
    ]);
    expect(validations).toBe(0);
  });

  it("validates a visible tool before invocation authorization denies it", async () => {
    let validations = 0;
    let handled = false;
    const registry = new ToolRegistry();
    registry.register({
      name: "visible",
      description: "visible",
      input: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (value) => {
            validations += 1;
            return { value };
          },
        },
      },
      handler: async () => {
        handled = true;
        return { data: null };
      },
    });
    const ctx = securedContext(
      auth(({ action }) => ({
        outcome: action === "tool.discover" ? "allow" : "deny",
        reason: action === "tool.discover" ? "visible" : "forbidden",
      }))
    );

    const events = await collect(registry.invoke("visible", {}, ctx));
    expect(events[0]).toMatchObject({
      type: "error",
      code: "AUTHORIZATION_DENIED",
      message: "forbidden",
    });
    expect(validations).toBe(1);
    expect(handled).toBe(false);
  });

  it("fails closed when invocation policy throws", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "policy-failure",
      description: "policy failure",
      input: passthrough(),
      handler: async () => ({ data: { ran: true } }),
    });
    const ctx = securedContext(
      auth(({ action }) => {
        if (action === "tool.discover") {
          return { outcome: "allow", reason: "visible" };
        }
        throw new Error("policy offline");
      })
    );

    const events = await collect(registry.invoke("policy-failure", {}, ctx));
    expect(events[0]).toMatchObject({
      type: "error",
      code: "AUTHORIZATION_DENIED",
      message: "Authorization policy failed",
    });
  });

  it.each([
    ["missing", undefined],
    ["null", { resolve: (): AuthzResource | null => null }],
    [
      "throwing",
      {
        resolve: (): never => {
          throw new Error("lookup failed");
        },
      },
    ],
    [
      "wrong kind",
      {
        resolve: (): AuthzResource => ({
          kind: "application:piece",
          target: "review-1",
        }),
      },
    ],
    [
      "incomplete",
      {
        resolve: (): AuthzResource => ({
          kind: "application:review",
          target: "review-1",
        }),
      },
    ],
  ] as const)(
    "fails closed for a %s required resource resolver",
    async (_label, resourceResolver) => {
      const registry = new ToolRegistry({
        security: resourceResolver === undefined ? {} : { resourceResolver },
      });
      registry.register({
        name: "review.annotate",
        description: "annotate",
        input: passthrough(),
        authorizationResource: {
          required: true,
          kind: "application:review",
          requiredFields: ["target", "workspaceId"],
        },
        handler: async () => ({ data: { ran: true } }),
      });
      const ctx = securedContext(
        auth(() => ({
          outcome: "allow",
          reason: "allowed",
        }))
      );

      const events = await collect(
        registry.invoke("review.annotate", { reviewId: "review-1" }, ctx)
      );
      expect(events[0]).toMatchObject({
        type: "error",
        code: "AUTH_RESOURCE_UNRESOLVED",
      });
    }
  );

  it("authorizes against the resolver's workspace rather than spoofed input", async () => {
    let seenWorkspace: string | undefined;
    let handled = false;
    const registry = new ToolRegistry({
      security: {
        resourceResolver: {
          resolve: () => ({
            kind: "application:review",
            target: "review-2",
            workspaceId: "workspace-2",
          }),
        },
      },
    });
    registry.register({
      name: "review.annotate",
      description: "annotate",
      input: passthrough(),
      authorizationResource: {
        required: true,
        kind: "application:review",
        requiredFields: ["target", "workspaceId"],
      },
      handler: async () => {
        handled = true;
        return { data: { ran: true } };
      },
    });
    const ctx = securedContext(
      auth((request) => {
        if (request.action === "tool.discover") {
          return { outcome: "allow", reason: "visible" };
        }
        seenWorkspace = request.relatedResources?.[0]?.workspaceId;
        return {
          outcome: seenWorkspace === principal().workspaceId ? "allow" : "deny",
          reason: "workspace check",
        };
      })
    );

    const events = await collect(
      registry.invoke(
        "review.annotate",
        { reviewId: "review-2", workspaceId: "workspace-1" },
        ctx
      )
    );
    expect(seenWorkspace).toBe("workspace-2");
    expect(events[0]).toMatchObject({
      type: "error",
      code: "AUTHORIZATION_DENIED",
    });
    expect(handled).toBe(false);
  });

  it("keeps trusted no-auth invocation backward-compatible and skips resolution", async () => {
    let resolves = 0;
    const registry = new ToolRegistry({
      security: {
        resourceResolver: {
          resolve: () => {
            resolves += 1;
            return null;
          },
        },
      },
    });
    registry.register({
      name: "local",
      description: "local",
      input: passthrough(),
      authorizationResource: {
        required: true,
        kind: "application:review",
      },
      handler: async () => ({ data: { ok: true } }),
    });

    const events = await collect(
      registry.invoke("local", {}, makeBaseContext())
    );
    expect(events[0]).toMatchObject({
      type: "result",
      data: { ok: true },
    });
    expect(resolves).toBe(0);
  });

  it("reauthorizes composed children with the original principal and call stack", async () => {
    let childRan = false;
    const seen: Array<{
      action: string;
      target?: string;
      callStack?: readonly string[];
      principalId: string;
    }> = [];
    const receipts: AuthSecurityReceipt[] = [];
    const registry = new ToolRegistry({
      security: {
        requestId: () => "request-1",
        now: () => "2026-07-16T00:00:00.000Z",
        auditSink: {
          write: (receipt) => {
            receipts.push(receipt);
          },
        },
      },
    });
    registry.register([
      {
        name: "parent",
        description: "parent",
        approval: "read",
        input: passthrough(),
        handler: async (_input, ctx) => {
          let childCode: string | undefined;
          for await (const event of ctx.invoke("child", {})) {
            if (event.type === "error") childCode = event.code;
          }
          return { data: { childCode } };
        },
      },
      {
        name: "child",
        description: "child",
        approval: "read",
        input: passthrough(),
        handler: async () => {
          childRan = true;
          return { data: { ok: true } };
        },
      },
    ]);
    const context = auth((request) => {
      seen.push({
        action: request.action,
        ...(request.resource.target === undefined
          ? {}
          : { target: request.resource.target }),
        ...(request.callStack === undefined
          ? {}
          : { callStack: request.callStack }),
        principalId: context.principal.id,
      });
      if (
        request.action === "tool.invoke" &&
        request.resource.target === "child"
      ) {
        return { outcome: "deny", reason: "child denied" };
      }
      return { outcome: "allow", reason: "allowed" };
    });

    const events = await collect(
      registry.invoke("parent", {}, securedContext(context))
    );
    expect(events[0]).toMatchObject({
      type: "result",
      data: { childCode: "AUTHORIZATION_DENIED" },
    });
    expect(childRan).toBe(false);
    expect(seen).toContainEqual({
      action: "tool.invoke",
      target: "child",
      callStack: ["parent", "child"],
      principalId: "principal:user-1",
    });
    expect(receipts.filter((r) => r.kind === "authorization")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          requestId: "request-1",
          toolName: "parent",
        }),
        expect.objectContaining({
          requestId: "request-1",
          toolName: "child",
          outcome: "deny",
        }),
      ])
    );
  });

  it("does not let a parent mutate the auth context used for child dispatch", async () => {
    let childRan = false;
    const registry = new ToolRegistry();
    registry.register([
      {
        name: "parent",
        description: "parent",
        approval: "read",
        input: passthrough(),
        handler: async (_input, ctx) => {
          const exposed = ctx.auth as
            | {
                authorize: AuthContext["authorize"];
                principal: { roles: string[] };
              }
            | undefined;
          try {
            if (exposed) {
              exposed.authorize = () => ({
                outcome: "allow",
                reason: "handler replacement",
              });
            }
          } catch {
            // The captured context is immutable.
          }
          try {
            exposed?.principal.roles.push("admin");
          } catch {
            // The captured principal is immutable.
          }

          let childCode: string | undefined;
          for await (const event of ctx.invoke("child", {})) {
            if (event.type === "error") childCode = event.code;
          }
          return { data: { childCode } };
        },
      },
      {
        name: "child",
        description: "child",
        approval: "read",
        input: passthrough(),
        handler: async () => {
          childRan = true;
          return { data: { ok: true } };
        },
      },
    ]);
    const events = await collect(
      registry.invoke(
        "parent",
        {},
        securedContext(
          auth((request) => ({
            outcome:
              request.action === "tool.invoke" &&
              request.resource.target === "child"
                ? "deny"
                : "allow",
            reason: "original policy",
          }))
        )
      )
    );

    expect(events[0]).toMatchObject({
      type: "result",
      data: { childCode: "AUTHORIZATION_DENIED" },
    });
    expect(childRan).toBe(false);
  });

  it("preserves class-based authorization policy receivers", async () => {
    let childRan = false;
    class ClassPolicy implements AuthContext {
      readonly principal = principal();
      readonly #blockedTool = "child";

      authorize(
        request: Parameters<AuthContext["authorize"]>[0]
      ): ReturnType<AuthContext["authorize"]> {
        return {
          outcome:
            request.action === "tool.invoke" &&
            request.resource.target === this.#blockedTool
              ? "deny"
              : "allow",
          reason: "class policy",
        };
      }
    }

    const registry = new ToolRegistry();
    registry.register([
      {
        name: "parent",
        description: "parent",
        approval: "read",
        input: passthrough(),
        handler: async (_input, ctx) => {
          let childCode: string | undefined;
          for await (const event of ctx.invoke("child", {})) {
            if (event.type === "error") childCode = event.code;
          }
          return { data: { childCode } };
        },
      },
      {
        name: "child",
        description: "child",
        approval: "read",
        input: passthrough(),
        handler: async () => {
          childRan = true;
          return { data: { ok: true } };
        },
      },
    ]);

    const events = await collect(
      registry.invoke("parent", {}, securedContext(new ClassPolicy()))
    );
    expect(events[0]).toMatchObject({
      type: "result",
      data: { childCode: "AUTHORIZATION_DENIED" },
    });
    expect(childRan).toBe(false);
  });

  it("rejects non-plain principal claims before a handler can mutate them", async () => {
    let parentRan = false;
    const malformedPrincipal = {
      ...principal(),
      attributes: {
        entitlements: new Set<string>(),
      },
    } as unknown as AuthenticatedPrincipal;
    const context: AuthContext = {
      principal: malformedPrincipal,
      authorize: () => ({ outcome: "allow", reason: "allowed" }),
    };
    const registry = new ToolRegistry();
    registry.register({
      name: "parent",
      description: "parent",
      input: passthrough(),
      handler: async () => {
        parentRan = true;
        return { data: { ok: true } };
      },
    });

    const events = await collect(
      registry.invoke("parent", {}, securedContext(context))
    );
    expect(events[0]).toMatchObject({
      type: "error",
      code: "TOOL_NOT_FOUND",
    });
    expect(parentRan).toBe(false);
  });

  it("allows an undiscoverable child when its invocation policy allows", async () => {
    let childRan = false;
    const registry = new ToolRegistry();
    registry.register([
      {
        name: "parent",
        description: "parent",
        approval: "read",
        input: passthrough(),
        handler: async (_input, ctx) => {
          for await (const _event of ctx.invoke("child", {})) {
            // consume
          }
          return { data: { ok: true } };
        },
      },
      {
        name: "child",
        description: "child",
        approval: "read",
        input: passthrough(),
        handler: async () => {
          childRan = true;
          return { data: { ok: true } };
        },
      },
    ]);
    const ctx = securedContext(
      auth((request) => ({
        outcome:
          request.action === "tool.discover" &&
          request.resource.target === "child"
            ? "deny"
            : "allow",
        reason: "policy",
      }))
    );

    await collect(registry.invoke("parent", {}, ctx));
    expect(childRan).toBe(true);
  });

  it("returns structured approval-required details without starting the handler", async () => {
    let handled = false;
    const registry = new ToolRegistry({
      security: {
        requestId: () => "request-approval",
        approvalProvider: {
          decide: () => ({
            outcome: "required",
            reason: "human confirmation",
            approvalRequestId: "approval-1",
            expiresAt: "2026-07-17T00:00:00.000Z",
          }),
        },
      },
    });
    registry.register({
      name: "review.write",
      description: "write",
      input: passthrough(),
      approval: "write",
      handler: async () => {
        handled = true;
        return { data: { ok: true } };
      },
    });

    const events = await collect(
      registry.invoke(
        "review.write",
        {},
        securedContext(auth(() => ({ outcome: "allow", reason: "allowed" })))
      )
    );
    expect(events[0]).toMatchObject({
      type: "error",
      code: "APPROVAL_REQUIRED",
      details: {
        requestId: "request-approval",
        approvalRequestId: "approval-1",
        toolName: "review.write",
        approvalTier: "write",
      },
    });
    expect(handled).toBe(false);
  });

  it("fails authenticated approval closed when no provider is configured", async () => {
    let handled = false;
    const registry = new ToolRegistry();
    registry.register({
      name: "review.write",
      description: "write",
      input: passthrough(),
      approval: "write",
      handler: async () => {
        handled = true;
        return { data: { ok: true } };
      },
    });

    const events = await collect(
      registry.invoke(
        "review.write",
        {},
        securedContext(auth(() => ({ outcome: "allow", reason: "allowed" })))
      )
    );

    expect(events[0]).toMatchObject({
      type: "error",
      code: "APPROVAL_DENIED",
      message: "Approval provider not configured",
    });
    expect(handled).toBe(false);
  });

  it("permits authenticated writes only with an explicit approval bypass", async () => {
    let handled = false;
    const registry = new ToolRegistry({
      security: { approvalMode: "bypass" },
    });
    registry.register({
      name: "trusted.write",
      description: "trusted write",
      input: passthrough(),
      approval: "write",
      handler: async () => {
        handled = true;
        return { data: { ok: true } };
      },
    });

    const events = await collect(
      registry.invoke(
        "trusted.write",
        {},
        securedContext(auth(() => ({ outcome: "allow", reason: "allowed" })))
      )
    );

    expect(events[0]).toMatchObject({ type: "result", data: { ok: true } });
    expect(handled).toBe(true);
  });

  it.each([
    ["missing", undefined],
    ["malformed", { tier: "invalid" }],
    [
      "throwing",
      () => {
        throw new Error("bad declaration");
      },
    ],
  ])("treats a %s approval declaration as exec", async (_label, approval) => {
    let resolvedTier: string | undefined;
    const registry = new ToolRegistry({
      security: {
        approvalProvider: {
          decide: ({ approval: resolved }) => {
            resolvedTier = resolved.tier;
            return {
              outcome: "required",
              reason: "confirm exec",
              approvalRequestId: "approval-default-exec",
            };
          },
        },
      },
    });
    registry.register({
      name: "unknown-risk",
      description: "unknown risk",
      input: passthrough(),
      ...(approval === undefined
        ? {}
        : { approval: approval as never }),
      handler: async () => ({ data: { leaked: true } }),
    });

    const events = await collect(
      registry.invoke(
        "unknown-risk",
        {},
        securedContext(auth(() => ({ outcome: "allow", reason: "allowed" })))
      )
    );

    expect(resolvedTier).toBe("exec");
    expect(events[0]).toMatchObject({
      type: "error",
      code: "APPROVAL_REQUIRED",
      details: { approvalTier: "exec" },
    });
  });

  it("keeps approval-provider exception details out of receipts and tool errors", async () => {
    const receipts: AuthSecurityReceipt[] = [];
    const logged: string[] = [];
    const registry = new ToolRegistry({
      security: {
        auditSink: {
          write: (receipt) => {
            receipts.push(receipt);
          },
        },
        approvalProvider: {
          decide: () => {
            throw new Error("database password is swordfish");
          },
        },
      },
    });
    registry.register({
      name: "review.write",
      description: "write",
      input: passthrough(),
      approval: "write",
      handler: async () => ({ data: { ok: true } }),
    });
    const events = await collect(
      registry.invoke(
        "review.write",
        {},
        makeBaseContext({
          auth: auth(() => ({ outcome: "allow", reason: "allowed" })),
          log: {
            debug: () => {},
            info: () => {},
            warn: () => {},
            error: (message, meta) => {
              logged.push(`${message} ${JSON.stringify(meta)}`);
            },
          },
        })
      )
    );

    expect(events[0]).toMatchObject({
      type: "error",
      code: "APPROVAL_DENIED",
      message: "Approval provider failed",
    });
    expect(JSON.stringify(receipts)).not.toContain("swordfish");
    expect(logged.join("\n")).not.toContain("swordfish");
  });

  it("fails closed when an approval provider returns a malformed decision", async () => {
    let handled = false;
    const registry = new ToolRegistry({
      security: {
        approvalProvider: {
          decide: () => ({}) as never,
        },
      },
    });
    registry.register({
      name: "review.write",
      description: "write",
      input: passthrough(),
      approval: "write",
      handler: async () => {
        handled = true;
        return { data: { ok: true } };
      },
    });

    const events = await collect(
      registry.invoke(
        "review.write",
        {},
        securedContext(auth(() => ({ outcome: "allow", reason: "allowed" })))
      )
    );

    expect(events[0]).toMatchObject({
      type: "error",
      code: "APPROVAL_DENIED",
      message: "Approval provider returned an invalid decision",
    });
    expect(handled).toBe(false);
  });

  it("never calls approval when authorization denies", async () => {
    let approvals = 0;
    const registry = new ToolRegistry({
      security: {
        approvalProvider: {
          decide: () => {
            approvals += 1;
            return { outcome: "approved" };
          },
        },
      },
    });
    registry.register({
      name: "review.write",
      description: "write",
      input: passthrough(),
      approval: "write",
      handler: async () => ({ data: { ok: true } }),
    });
    const ctx = securedContext(
      auth(({ action }) => ({
        outcome: action === "tool.discover" ? "allow" : "deny",
        reason: "denied",
      }))
    );

    await collect(registry.invoke("review.write", {}, ctx));
    expect(approvals).toBe(0);
  });

  it("emits separate redacted authorization and approval receipts", async () => {
    const receipts: AuthSecurityReceipt[] = [];
    const registry = new ToolRegistry({
      security: {
        requestId: () => "request-receipts",
        now: () => "2026-07-16T00:00:00.000Z",
        resourceResolver: {
          resolve: () => ({
            kind: "application:review",
            target: "review-1",
            workspaceId: "workspace-1",
            metadata: { documentBody: "private" },
          }),
        },
        approvalProvider: {
          decide: () => ({
            outcome: "approved",
            reason: "grant",
            grantId: "grant-1",
            grantScope: "persistent",
          }),
        },
        auditSink: {
          write: (receipt) => {
            receipts.push(receipt);
          },
        },
      },
    });
    registry.register({
      name: "review.write",
      description: "write",
      input: passthrough(),
      authorizationResource: {
        required: true,
        kind: "application:review",
        requiredFields: ["target", "workspaceId"],
      },
      approval: "write",
      handler: async () => ({ data: { ok: true } }),
    });

    await collect(
      registry.invoke(
        "review.write",
        { documentBody: "secret" },
        securedContext(auth(() => ({ outcome: "allow", reason: "allowed" })))
      )
    );

    const invocation = receipts.find(
      (receipt) =>
        receipt.kind === "authorization" && receipt.action === "tool.invoke"
    );
    const approval = receipts.find((receipt) => receipt.kind === "approval");
    expect(invocation).toMatchObject({
      requestId: "request-receipts",
      kind: "authorization",
      outcome: "allow",
      relatedResources: [
        {
          kind: "application:review",
          target: "review-1",
          workspaceId: "workspace-1",
        },
      ],
    });
    expect(JSON.stringify(invocation)).not.toContain("documentBody");
    expect(invocation).not.toHaveProperty("grantId");
    expect(approval).toMatchObject({
      requestId: "request-receipts",
      kind: "approval",
      outcome: "approved",
      grantId: "grant-1",
      grantScope: "persistent",
    });
  });

  it("fails before execution when mandatory approval audit fails", async () => {
    let handled = false;
    const registry = new ToolRegistry({
      security: {
        mandatoryAudit: true,
        auditSink: {
          write: (receipt) => {
            if (receipt.kind === "approval") {
              throw new Error("audit offline");
            }
          },
        },
        approvalProvider: {
          decide: () => ({ outcome: "approved" }),
        },
      },
    });
    registry.register({
      name: "review.write",
      description: "write",
      input: passthrough(),
      approval: "write",
      handler: async () => {
        handled = true;
        return { data: { ok: true } };
      },
    });

    const events = await collect(
      registry.invoke(
        "review.write",
        {},
        securedContext(auth(() => ({ outcome: "allow", reason: "allowed" })))
      )
    );
    expect(events[0]).toMatchObject({
      type: "error",
      code: "AUTH_AUDIT_FAILED",
    });
    expect(handled).toBe(false);
  });

  it("preserves security configuration across merge, extract, and filter", async () => {
    const security: ToolRegistrySecurityOptions = {};
    const source = new ToolRegistry({ security });
    source.register({
      name: "secured",
      description: "secured",
      input: passthrough(),
      handler: async () => ({ data: { leaked: true } }),
    });
    const other = new ToolRegistry();
    const derived = [
      source.extract(["secured"]),
      source.filter(() => true),
      source.merge(other),
    ];
    const ctx = securedContext(
      auth(() => ({
        outcome: "deny",
        reason: "hidden",
      }))
    );

    for (const registry of derived) {
      const events = await collect(registry.invoke("secured", {}, ctx));
      expect(events[0]).toMatchObject({
        type: "error",
        code: "TOOL_NOT_FOUND",
      });
    }
  });
});
