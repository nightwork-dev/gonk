import { describe, expect, it } from "vitest";

import {
  captureAuthContext,
  isAuthenticatedPrincipal,
  persistentGrantKey,
  redactAuthzResource,
  securityContextKey,
  type AuthContext,
  type AuthenticatedPrincipal,
} from "../src/index.ts";

function principal(
  overrides: Partial<AuthenticatedPrincipal> = {}
): AuthenticatedPrincipal {
  return {
    id: "principal:user-1",
    kind: "human",
    identity: {
      issuer: "https://accounts.example",
      subject: "user-1",
      method: "oauth",
    },
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    delegation: {
      actorKind: "agent",
      actor: {
        issuer: "sigil:eve",
        subject: "agent-1",
        method: "service-token",
      },
      actorId: "eve-agent-1",
      actorSessionId: "session-a",
    },
    roles: ["member"],
    scopes: ["reviews:write"],
    ...overrides,
  };
}

describe("principal binding keys", () => {
  it("captures an immutable principal and binds the authorization policy once", async () => {
    const sourcePrincipal = principal();
    const context: AuthContext = {
      principal: sourcePrincipal,
      authorize() {
        return { outcome: "allow" as const, reason: this.principal.tenantId! };
      },
    };
    const captured = captureAuthContext(context);
    sourcePrincipal.tenantId = "tenant-mutated";
    context.authorize = () => ({ outcome: "deny", reason: "replacement" });

    expect(captured.principal.tenantId).toBe("tenant-1");
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.principal)).toBe(true);
    expect(Object.isFrozen(captured.principal.roles)).toBe(true);
    expect(
      await captured.authorize({
        action: "context.discover",
        resource: { kind: "context-candidate" },
      })
    ).toEqual({ outcome: "allow", reason: "tenant-mutated" });
  });

  it("recognizes only structurally valid authenticated principals", () => {
    expect(isAuthenticatedPrincipal(principal())).toBe(true);
    expect(
      isAuthenticatedPrincipal({
        ...principal(),
        delegation: {
          ...principal().delegation,
          actorSessionId: "",
        },
      })
    ).toBe(false);
    expect(
      isAuthenticatedPrincipal({
        ...principal(),
        identity: {
          issuer: "https://accounts.example",
          subject: "user-1",
          method: "unregistered-method",
        },
      })
    ).toBe(false);
    expect(
      isAuthenticatedPrincipal(
        principal({
          identity: {
            issuer: "https://accounts.example",
            subject: "user-1",
            method: "custom:passkey",
          },
        })
      )
    ).toBe(true);
    expect(
      isAuthenticatedPrincipal({
        ...principal(),
        attributes: {
          entitlements: new Set(["admin"]),
        },
      })
    ).toBe(false);
    expect(
      isAuthenticatedPrincipal({
        ...principal(),
        attributes: {
          issuedAt: new Date(),
        },
      })
    ).toBe(false);
    expect(isAuthenticatedPrincipal({ id: "incomplete" })).toBe(false);
  });

  it("is stable for the same authenticated principal", () => {
    expect(securityContextKey({ principal: principal() })).toBe(
      securityContextKey({ principal: principal() })
    );
    expect(persistentGrantKey({ principal: principal() })).toBe(
      persistentGrantKey({ principal: principal() })
    );
  });

  it("changes the security key but not the persistent grant key across actor sessions", () => {
    const before = principal();
    const after = principal({
      delegation: {
        ...before.delegation!,
        actorSessionId: "session-b",
      },
    });

    expect(securityContextKey({ principal: before })).not.toBe(
      securityContextKey({ principal: after })
    );
    expect(persistentGrantKey({ principal: before })).toBe(
      persistentGrantKey({ principal: after })
    );
  });

  it("changes both keys when subject, actor, tenant, or workspace changes", () => {
    const base = principal();
    const variants: AuthenticatedPrincipal[] = [
      principal({
        identity: { ...base.identity, subject: "user-2" },
      }),
      principal({
        workspaceId: "workspace-2",
      }),
      principal({
        delegation: {
          ...base.delegation!,
          actorId: "eve-agent-2",
        },
      }),
      principal({
        delegation: {
          ...base.delegation!,
          actor: { ...base.delegation!.actor, subject: "agent-2" },
        },
      }),
    ];

    for (const variant of variants) {
      expect(securityContextKey({ principal: variant })).not.toBe(
        securityContextKey({ principal: base })
      );
      expect(persistentGrantKey({ principal: variant })).not.toBe(
        persistentGrantKey({ principal: base })
      );
    }
  });

  it("does not change keys for refreshed roles, scopes, expiry, or attributes", () => {
    const base = principal();
    const refreshed = principal({
      roles: ["member", "reviewer"],
      scopes: ["reviews:write", "reviews:read"],
      expiresAt: 999,
      attributes: { refreshed: true },
    });
    expect(securityContextKey({ principal: refreshed })).toBe(
      securityContextKey({ principal: base })
    );
    expect(persistentGrantKey({ principal: refreshed })).toBe(
      persistentGrantKey({ principal: base })
    );
  });

  it("rejects empty security identities", () => {
    expect(() =>
      securityContextKey({
        principal: principal({
          identity: {
            issuer: "",
            subject: "user-1",
            method: "oauth",
          },
        }),
      })
    ).toThrow(/issuer must be a non-empty string/);
  });
});

describe("redactAuthzResource", () => {
  it("drops metadata and scope while preserving the attributable projection", () => {
    expect(
      redactAuthzResource({
        kind: "application:review",
        target: "review-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        scope: "project",
        metadata: {
          token: "secret",
          documentBody: "private",
        },
      })
    ).toEqual({
      kind: "application:review",
      target: "review-1",
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    });
  });
});
