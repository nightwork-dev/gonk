import type {
  AuthContext,
  AuthenticatedPrincipal,
  AuthorizationRequest,
} from "@gonk/auth";
import { describe, expect, it } from "vitest";

import {
  compiledContextBlockSchema,
  ContextCompiler,
  ContextContributorRegistry,
  contextCandidateSchema,
  contextCompilationReceiptSchema,
  contextCompileRequestSchema,
  contextCompileResultSchema,
  contextDiscoveryRequestSchema,
  contextResolutionRequestSchema,
  contextTokenCountSchema,
  resolvedContextCandidateSchema,
  type ContextCandidate,
  type ContextCompileRequest,
  type ContextCompileResult,
  type ContextContributor,
  type ResolvedContextCandidate,
} from "../src/index.ts";

const FIXED_TIME = "2026-07-16T12:00:00.000Z";

const principal: AuthenticatedPrincipal = {
  id: "principal:alice",
  kind: "human",
  identity: {
    issuer: "https://accounts.example",
    subject: "alice",
    method: "oauth",
  },
  tenantId: "tenant-1",
  workspaceId: "workspace-1",
  roles: ["member"],
  scopes: ["context:read"],
};

function auth(
  authorize: (request: AuthorizationRequest) =>
    | { outcome: "allow" | "deny"; reason: string }
    | Promise<{ outcome: "allow" | "deny"; reason: string }> = () => ({
    outcome: "allow",
    reason: "allowed",
  })
): AuthContext {
  return { principal, authorize };
}

function candidate(
  candidateId: string,
  contributorId: string,
  resourceKey = `document:${candidateId}`,
  overrides: Partial<ContextCandidate> = {}
): ContextCandidate {
  return {
    candidateId,
    contributorId,
    resourceKey,
    necessity: "optional",
    priority: 0,
    estimatedTokens: 1,
    estimateQuality: "fallback",
    ...overrides,
  };
}

function resolved(
  value: ContextCandidate,
  content = value.candidateId,
  overrides: Partial<ResolvedContextCandidate> = {}
): ResolvedContextCandidate {
  return {
    candidateId: value.candidateId,
    contributorId: value.contributorId,
    resourceKey: value.resourceKey,
    revision: "rev-1",
    necessity: value.necessity,
    priority: value.priority,
    audience: "model",
    content,
    resource: {
      kind: "application:document",
      target: value.resourceKey,
      tenantId: "tenant-1",
      workspaceId: "workspace-1",
    },
    ...overrides,
  };
}

function contributor(
  id: string,
  candidates: readonly ContextCandidate[],
  resolveCandidate: (
    value: ContextCandidate
  ) => ResolvedContextCandidate | null | Promise<ResolvedContextCandidate | null> = (
    value
  ) => resolved(value)
): ContextContributor {
  return {
    id,
    discover: () => candidates,
    resolve: ({ candidate: value }) => resolveCandidate(value),
  };
}

function request(
  requestAuth: AuthContext = auth(),
  overrides: Partial<ContextCompileRequest> = {}
): ContextCompileRequest {
  return {
    requestId: "request-1",
    auth: requestAuth,
    audience: "model",
    maxTokens: 100,
    ...overrides,
  };
}

function compiler(registry: ContextContributorRegistry) {
  return new ContextCompiler({
    registry,
    now: () => FIXED_TIME,
    tokenCounter: {
      count: ({ content }) => ({ tokens: content.length, quality: "exact" }),
    },
    configVersion: "test-v1",
  });
}

async function valid(schema: {
  readonly "~standard": {
    validate(value: unknown): unknown | Promise<unknown>;
  };
}, value: unknown): Promise<boolean> {
  const result = await schema["~standard"].validate(value);
  return !(
    result &&
    typeof result === "object" &&
    "issues" in result &&
    (result as { issues?: unknown }).issues
  );
}

describe("ContextContributorRegistry", () => {
  it("lists contributors deterministically and rejects duplicate ids", () => {
    const registry = new ContextContributorRegistry();
    registry.register(contributor("zeta", []));
    registry.register(contributor("alpha", []));

    expect(registry.list().map(({ id }) => id)).toEqual(["alpha", "zeta"]);
    expect(registry.get("alpha")?.id).toBe("alpha");
    expect(() => registry.register(contributor("alpha", []))).toThrow(
      /already registered/
    );
    expect(registry.unregister("alpha")).toBe(true);
    expect(registry.unregister("alpha")).toBe(false);
  });
});

describe("closed Standard Schema boundaries", () => {
  it("rejects unknown fields and invalid discriminants at all nine exported boundaries", async () => {
    const value = candidate("one", "docs");
    const resolvedValue = resolved(value, "one");
    const block = {
      candidateId: "one",
      contributorId: "docs",
      resourceKey: "document:one",
      revision: "rev-1",
      necessity: "optional" as const,
      priority: 0,
      audience: "model" as const,
      content: "one",
      contentTokens: 3,
      renderedTokens: 3,
      tokenQuality: "exact" as const,
    };
    const selection = {
      candidateId: "one",
      contributorId: "docs",
      resourceKey: "document:one",
      revision: "rev-1",
      necessity: "optional" as const,
      contentTokens: 3,
      renderedTokens: 3,
      tokenQuality: "exact" as const,
    };
    const receipt = {
      kind: "context-compilation" as const,
      receiptVersion: 1 as const,
      requestId: "request-1",
      timestamp: FIXED_TIME,
      compilerVersion: "0.1.1",
      configVersion: "test-v1",
      status: "ready" as const,
      audience: "model" as const,
      maxTokens: 100,
      totalTokens: 3,
      selected: [selection],
      dropped: [],
      blockers: [],
    };
    const readyResult = {
      status: "ready" as const,
      blocks: [block],
      content: "one",
      totalTokens: 3,
      receipt,
    };
    const discoveryRequest = {
      requestId: "request-1",
      audience: "model" as const,
      principal,
    };
    const resolutionRequest = {
      ...discoveryRequest,
      candidate: value,
    };
    const boundaries = [
      {
        schema: contextCompileRequestSchema,
        canonical: request(),
        invalid: { ...request(), audience: "broadcast" },
      },
      {
        schema: contextCandidateSchema,
        canonical: value,
        invalid: { ...value, necessity: "sometimes" },
      },
      {
        schema: resolvedContextCandidateSchema,
        canonical: resolvedValue,
        invalid: { ...resolvedValue, audience: "internal" },
      },
      {
        schema: contextDiscoveryRequestSchema,
        canonical: discoveryRequest,
        invalid: { ...discoveryRequest, audience: "internal" },
      },
      {
        schema: contextResolutionRequestSchema,
        canonical: resolutionRequest,
        invalid: {
          ...resolutionRequest,
          candidate: { ...value, necessity: "sometimes" },
        },
      },
      {
        schema: contextTokenCountSchema,
        canonical: { tokens: 1, quality: "exact" },
        invalid: { tokens: 1, quality: "approximate" },
      },
      {
        schema: compiledContextBlockSchema,
        canonical: block,
        invalid: { ...block, tokenQuality: "approximate" },
      },
      {
        schema: contextCompilationReceiptSchema,
        canonical: receipt,
        invalid: { ...receipt, status: "partial" },
      },
      {
        schema: contextCompileResultSchema,
        canonical: readyResult,
        invalid: { ...readyResult, status: "partial" },
      },
    ];

    for (const boundary of boundaries) {
      expect(await valid(boundary.schema, boundary.canonical)).toBe(true);
      expect(
        await valid(boundary.schema, {
          ...boundary.canonical,
          unknownProtocolField: { arbitrary: true },
        })
      ).toBe(false);
      expect(await valid(boundary.schema, boundary.invalid)).toBe(false);
    }
  });

  it("keeps candidate descriptors JSON-serializable", () => {
    const value = candidate("one", "docs", "document:one", {
      revisionHint: "rev-7",
    });
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it("rejects a blocked result that smuggles sendable content", async () => {
    expect(
      await valid(contextCompileResultSchema, {
        status: "blocked",
        blockers: [],
        content: "must not exist",
        receipt: {},
      })
    ).toBe(false);
  });

  it("enforces semantic invariants across results and receipts", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(contributor("docs", [candidate("one", "docs")]));
    const ready = await compiler(registry).compile(request());
    expect(ready.status).toBe("ready");
    if (ready.status !== "ready") return;

    expect(
      await valid(contextCompileResultSchema, {
        ...ready,
        content: `${ready.content}\n\nsmuggled`,
      })
    ).toBe(false);
    expect(
      await valid(contextCompileResultSchema, {
        ...ready,
        receipt: { ...ready.receipt, selected: [] },
      })
    ).toBe(false);
    expect(
      await valid(contextCompileResultSchema, {
        ...ready,
        totalTokens: ready.totalTokens + 1,
      })
    ).toBe(false);
    expect(
      await valid(contextCompileResultSchema, {
        ...ready,
        receipt: {
          ...ready.receipt,
          blockers: [
            {
              reason: "budget",
              necessity: "required",
              pinned: false,
            },
          ],
        },
      })
    ).toBe(false);
    expect(
      await valid(contextCompilationReceiptSchema, {
        ...ready.receipt,
        totalTokens: ready.receipt.maxTokens + 1,
      })
    ).toBe(false);

    const requiredRegistry = new ContextContributorRegistry();
    requiredRegistry.register(
      contributor("docs", [
        candidate("required", "docs", "document:required", {
          necessity: "required",
        }),
      ])
    );
    const blocked = await compiler(requiredRegistry).compile(
      request(auth(() => ({ outcome: "deny", reason: "hidden" })))
    );
    expect(blocked.status).toBe("blocked");
    if (blocked.status !== "blocked") return;
    expect(
      await valid(contextCompileResultSchema, {
        ...blocked,
        blockers: [],
      })
    ).toBe(false);
    expect(
      await valid(contextCompileResultSchema, {
        ...blocked,
        receipt: { ...blocked.receipt, blockers: [] },
      })
    ).toBe(false);
  });
});

describe("ContextCompiler authorization", () => {
  it("authorizes discovery before resolve and leaks no hidden candidate into output", async () => {
    const registry = new ContextContributorRegistry();
    const visible = candidate("visible", "docs", "document:visible");
    const hidden = candidate("hidden-secret-title", "docs", "document:hidden");
    const resolvedIds: string[] = [];
    registry.register(
      contributor("docs", [hidden, visible], (value) => {
        resolvedIds.push(value.candidateId);
        return resolved(value, `content:${value.candidateId}`);
      })
    );
    const calls: string[] = [];
    const result = await compiler(registry).compile(
      request(
        auth((authorization) => {
          calls.push(`${authorization.action}:${authorization.resource.target}`);
          return {
            outcome:
              authorization.resource.target === "document:hidden"
                ? "deny"
                : "allow",
            reason: "policy",
          };
        })
      )
    );

    expect(result.status).toBe("ready");
    expect(resolvedIds).toEqual(["visible"]);
    expect(calls).toEqual([
      "context.discover:document:hidden",
      "context.discover:document:visible",
      "context.use:document:visible",
    ]);
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(JSON.stringify(result)).not.toContain("secret-title");
  });

  it("passes authoritative resolved metadata to context.use", async () => {
    const registry = new ContextContributorRegistry();
    const value = candidate("one", "docs");
    registry.register(
      contributor("docs", [value], (item) =>
        resolved(item, "authorized body", {
          revision: "authoritative-rev",
          resource: {
            kind: "application:document",
            target: item.resourceKey,
            tenantId: "tenant-1",
            workspaceId: "workspace-1",
            metadata: { classification: "confidential" },
          },
        })
      )
    );
    let useRequest: AuthorizationRequest | undefined;

    const result = await compiler(registry).compile(
      request(
        auth((authorization) => {
          if (authorization.action === "context.use") {
            useRequest = authorization;
          }
          return { outcome: "allow", reason: "allowed" };
        })
      )
    );

    expect(result.status).toBe("ready");
    expect(useRequest?.resource.metadata).toEqual({
      classification: "confidential",
    });
    expect(result.receipt.selected[0]?.revision).toBe("authoritative-rev");
    expect(JSON.stringify(result.receipt)).not.toContain("authorized body");
    expect(JSON.stringify(result.receipt)).not.toContain("confidential");
  });

  it("fails closed when authorization throws", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(contributor("docs", [candidate("one", "docs")]));
    const result = await compiler(registry).compile(
      request(
        auth(() => {
          throw new Error("policy unavailable");
        })
      )
    );

    expect(result.status).toBe("ready");
    expect(result.receipt.selected).toEqual([]);
    expect(result.receipt.dropped).toEqual([]);
  });

  it("does not send use-denied content to token accounting", async () => {
    const registry = new ContextContributorRegistry();
    const value = candidate("secret", "docs", "document:secret");
    registry.register(
      contributor("docs", [value], (item) => resolved(item, "TOP SECRET BODY"))
    );
    const counted: string[] = [];
    const contextCompiler = new ContextCompiler({
      registry,
      now: () => FIXED_TIME,
      tokenCounter: {
        count: ({ content }) => {
          counted.push(content);
          return { tokens: content.length, quality: "exact" };
        },
      },
    });

    const result = await contextCompiler.compile(
      request(
        auth((authorization) => ({
          outcome: authorization.action === "context.use" ? "deny" : "allow",
          reason: "policy",
        }))
      )
    );
    expect(result.status).toBe("ready");
    expect(counted).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("TOP SECRET BODY");
  });

  it("snapshots the request and principal before policy code can mutate them", async () => {
    const mutablePrincipal = structuredClone(principal);
    const observedTenants: Array<string | undefined> = [];
    const authorizationTenants: Array<string | undefined> = [];
    const registry = new ContextContributorRegistry();
    const value = candidate("visible", "docs", "document:visible");
    let compileRequest: ContextCompileRequest;
    registry.register({
      id: "docs",
      discover: ({ principal: capturedPrincipal }) => {
        observedTenants.push(capturedPrincipal.tenantId);
        try {
          (capturedPrincipal.roles as string[]).push("admin");
        } catch {
          // The captured principal is deeply frozen.
        }
        compileRequest.excludedResourceKeys = ["document:visible"];
        compileRequest.maxTokens = 0;
        return [value];
      },
      resolve: ({ candidate: item, principal: capturedPrincipal }) => {
        observedTenants.push(capturedPrincipal.tenantId);
        return resolved(item, "visible");
      },
    });
    const mutableAuth: AuthContext = {
      principal: mutablePrincipal,
      authorize(authorization) {
        authorizationTenants.push(authorization.resource.tenantId);
        mutablePrincipal.tenantId = "tenant-mutated";
        this.authorize = () => ({ outcome: "deny", reason: "replacement" });
        return { outcome: "allow", reason: "captured policy" };
      },
    };
    compileRequest = request(mutableAuth, {
      excludedResourceKeys: [],
      maxTokens: 100,
    });

    const result = await compiler(registry).compile(compileRequest);

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.content).toBe("visible");
    expect(observedTenants).toEqual(["tenant-1", "tenant-1"]);
    expect(authorizationTenants).toEqual(["tenant-1", "tenant-1"]);
    expect(result.receipt.maxTokens).toBe(100);
  });
});

describe("ContextCompiler deterministic selection", () => {
  it("deduplicates canonical resources before token accounting", async () => {
    const registry = new ContextContributorRegistry();
    const low = candidate("low", "alpha", "document:shared", { priority: 1 });
    const high = candidate("high", "beta", "document:shared", { priority: 10 });
    registry.register(contributor("alpha", [low], (value) => resolved(value, "low")));
    registry.register(contributor("beta", [high], (value) => resolved(value, "winner")));
    const counted: string[] = [];
    const contextCompiler = new ContextCompiler({
      registry,
      now: () => FIXED_TIME,
      tokenCounter: {
        count: ({ content }) => {
          counted.push(content);
          return { tokens: content.length, quality: "exact" };
        },
      },
    });

    const result = await contextCompiler.compile(request());

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.blocks.map(({ candidateId }) => candidateId)).toEqual(["high"]);
    expect(result.receipt.dropped).toContainEqual({
      reason: "duplicate",
      candidateId: "low",
      contributorId: "alpha",
      resourceKey: "document:shared",
      revision: "rev-1",
    });
    expect(counted).not.toContain("low");
  });

  it("is byte-stable across registration and discovery permutations", async () => {
    const a = candidate("a", "alpha", "document:a", { priority: 1 });
    const b = candidate("b", "alpha", "document:b", { priority: 2 });
    const c = candidate("c", "zeta", "document:c", {
      necessity: "required",
      priority: 0,
    });

    const first = new ContextContributorRegistry();
    first.register(contributor("zeta", [c]));
    first.register(contributor("alpha", [a, b]));

    const second = new ContextContributorRegistry();
    second.register(contributor("alpha", [b, a]));
    second.register(contributor("zeta", [c]));

    const one = await compiler(first).compile(request());
    const two = await compiler(second).compile(request());
    expect(JSON.stringify(one)).toBe(JSON.stringify(two));
  });

  it("orders pinned, required, then optional candidates with stable tie-breaks", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(
      contributor("docs", [
        candidate("optional", "docs", "document:optional", { priority: 100 }),
        candidate("required", "docs", "document:required", {
          necessity: "required",
          priority: 0,
        }),
        candidate("pinned", "docs", "document:pinned", { priority: -1 }),
      ])
    );

    const result = await compiler(registry).compile(
      request(auth(), { pinnedResourceKeys: ["document:pinned"] })
    );
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.blocks.map(({ candidateId }) => candidateId)).toEqual([
      "pinned",
      "required",
      "optional",
    ]);
  });

  it("includes separators in authoritative budget totals", async () => {
    const registry = new ContextContributorRegistry();
    const a = candidate("a", "docs", "document:a", { priority: 2 });
    const b = candidate("b", "docs", "document:b", { priority: 1 });
    registry.register(
      contributor("docs", [a, b], (value) =>
        resolved(value, value.candidateId === "a" ? "aa" : "bbb")
      )
    );

    const result = await compiler(registry).compile(request(auth(), { maxTokens: 7 }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.content).toBe("aa\n\nbbb");
    expect(result.totalTokens).toBe(7);
    expect(result.blocks.map(({ contentTokens, renderedTokens, tokenQuality }) => ({
      contentTokens,
      renderedTokens,
      tokenQuality,
    }))).toEqual([
      { contentTokens: 2, renderedTokens: 2, tokenQuality: "exact" },
      { contentTokens: 3, renderedTokens: 5, tokenQuality: "exact" },
    ]);
  });

  it("forwards the opaque model id only to the token counter", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(contributor("docs", [candidate("one", "docs")]));
    const models: Array<string | undefined> = [];
    const contextCompiler = new ContextCompiler({
      registry,
      now: () => FIXED_TIME,
      tokenCounter: {
        count: ({ content, model }) => {
          models.push(model);
          return {
            tokens: content.length,
            quality: "model-aware",
          };
        },
      },
    });

    const first = await contextCompiler.compile(
      request(auth(), { model: "large-context-model" })
    );
    const second = await contextCompiler.compile(
      request(auth(), { model: "other-model" })
    );
    expect(first.status).toBe("ready");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(models).toEqual([
      "large-context-model",
      "large-context-model",
      "large-context-model",
      "other-model",
      "other-model",
      "other-model",
    ]);
  });

  it("lets a smaller later optional candidate fit after a larger one is dropped", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(
      contributor(
        "docs",
        [
          candidate("large", "docs", "document:large", { priority: 10 }),
          candidate("small", "docs", "document:small", { priority: 1 }),
        ],
        (value) =>
          resolved(value, value.candidateId === "large" ? "too-large" : "ok")
      )
    );

    const result = await compiler(registry).compile(request(auth(), { maxTokens: 2 }));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.content).toBe("ok");
    expect(result.receipt.dropped.some(({ reason }) => reason === "budget")).toBe(true);
  });
});

describe("ContextCompiler blocking and failure behavior", () => {
  it.each([
    "discovery-denied",
    "resolution-failed",
    "use-denied",
    "budget",
  ] as const)("returns blocked with no sendable artifact for required %s", async (failure) => {
    const registry = new ContextContributorRegistry();
    const value = candidate("required", "docs", "document:required", {
      necessity: "required",
    });
    registry.register(
      contributor("docs", [value], (item) =>
        failure === "resolution-failed" ? null : resolved(item, "required content")
      )
    );
    const result = await compiler(registry).compile(
      request(
        auth((authorization) => ({
          outcome:
            (failure === "discovery-denied" &&
              authorization.action === "context.discover") ||
            (failure === "use-denied" && authorization.action === "context.use")
              ? "deny"
              : "allow",
          reason: failure,
        })),
        { maxTokens: failure === "budget" ? 1 : 100 }
      )
    );

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.blockers.some(({ reason }) => reason === failure)).toBe(true);
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("blocks");
  });

  it("keeps optional resolution and contributor failures as structured drops", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(contributor("broken-discovery", [], () => null));
    registry.register({
      id: "throws",
      discover: () => {
        throw new Error("offline");
      },
      resolve: () => null,
    });
    registry.register(
      contributor("unresolved", [candidate("missing", "unresolved")], () => null)
    );

    const result = await compiler(registry).compile(request());
    expect(result.status).toBe("ready");
    expect(result.receipt.dropped).toEqual([
      { reason: "contributor-failed", contributorId: "throws" },
      {
        reason: "resolution-failed",
        candidateId: "missing",
        contributorId: "unresolved",
        resourceKey: "document:missing",
        necessity: "optional",
      },
    ]);
  });

  it("fails closed on malformed contributor output", async () => {
    const registry = new ContextContributorRegistry();
    const malformed = {
      ...candidate("bad", "docs", "document:bad", { necessity: "required" }),
      callback: () => "executable",
    };
    registry.register({
      id: "docs",
      discover: () => [malformed] as unknown as readonly ContextCandidate[],
      resolve: () => {
        throw new Error("must not resolve malformed output");
      },
    });

    const result = await compiler(registry).compile(request());
    expect(result.status).toBe("blocked");
    expect(result.receipt.dropped).toContainEqual({
      reason: "invalid",
      contributorId: "docs",
    });
  });

  it("blocks when a pinned resource is absent", async () => {
    const registry = new ContextContributorRegistry();
    const result = await compiler(registry).compile(
      request(auth(), { pinnedResourceKeys: ["document:missing"] })
    );
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.blockers).toContainEqual({
      reason: "resolution-failed",
      necessity: "optional",
      pinned: true,
      resourceKey: "document:missing",
    });
  });

  it("makes hidden identifiers unrepresentable in discovery-denied blockers", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(
      contributor("secret-contributor", [
        candidate("secret-candidate", "secret-contributor", "document:secret", {
          necessity: "required",
        }),
      ])
    );
    const result = await compiler(registry).compile(
      request(
        auth(() => ({ outcome: "deny", reason: "hidden" }))
      )
    );
    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result.blockers).toEqual([
      {
        reason: "discovery-denied",
        necessity: "required",
        pinned: false,
      },
    ]);

    const leaked = structuredClone(result) as unknown as {
      blockers: Array<Record<string, unknown>>;
      receipt: { blockers: Array<Record<string, unknown>> };
    };
    leaked.blockers[0]!.contributorId = "secret-contributor";
    leaked.receipt.blockers[0]!.contributorId = "secret-contributor";
    expect(await valid(contextCompileResultSchema, leaked)).toBe(false);
  });

  it("rejects contradictory pin and exclusion requests", async () => {
    const registry = new ContextContributorRegistry();
    await expect(
      compiler(registry).compile(
        request(auth(), {
          pinnedResourceKeys: ["document:one"],
          excludedResourceKeys: ["document:one"],
        })
      )
    ).rejects.toThrow(/both pinned and excluded/);
  });

  it("blocks when the caller explicitly excludes required context", async () => {
    const registry = new ContextContributorRegistry();
    registry.register(
      contributor("docs", [
        candidate("required", "docs", "document:required", {
          necessity: "required",
        }),
      ])
    );

    const result = await compiler(registry).compile(
      request(auth(), { excludedResourceKeys: ["document:required"] })
    );

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") return;
    expect(result).not.toHaveProperty("content");
    expect(result).not.toHaveProperty("blocks");
    expect(result.blockers).toEqual([
      {
        reason: "excluded",
        necessity: "required",
        pinned: false,
        resourceKey: "document:required",
      },
    ]);
    expect(result.receipt.blockers).toEqual(result.blockers);
  });
});

describe("hidden-corpus non-interference", () => {
  it("produces byte-identical output when denied optional candidates are added", async () => {
    const visible = candidate("visible", "docs", "document:visible");
    const hiddenA = candidate("hidden-a", "docs", "document:hidden-a", {
      priority: 999,
      estimatedTokens: 9999,
    });
    const hiddenB = candidate("hidden-b", "docs", "document:hidden-b", {
      necessity: "optional",
      priority: -999,
    });

    const baseRegistry = new ContextContributorRegistry();
    baseRegistry.register(contributor("docs", [visible]));
    const hiddenRegistry = new ContextContributorRegistry();
    hiddenRegistry.register(contributor("docs", [hiddenB, visible, hiddenA]));

    const policy = auth((authorization) => ({
      outcome: authorization.resource.target?.includes("hidden") ? "deny" : "allow",
      reason: "policy",
    }));
    const base = await compiler(baseRegistry).compile(request(policy));
    const withHidden = await compiler(hiddenRegistry).compile(request(policy));

    expect(JSON.stringify(withHidden)).toBe(JSON.stringify(base));
  });

  it("does not let a denied hidden duplicate candidate id suppress a visible candidate", async () => {
    const visible = candidate("shared-id", "docs", "document:visible");
    const hidden = candidate("shared-id", "docs", "document:hidden", {
      priority: 999,
    });
    const baseRegistry = new ContextContributorRegistry();
    baseRegistry.register(contributor("docs", [visible]));
    const hiddenRegistry = new ContextContributorRegistry();
    hiddenRegistry.register(contributor("docs", [hidden, visible]));
    const policy = auth((authorization) => ({
      outcome:
        authorization.resource.target === "document:hidden" ? "deny" : "allow",
      reason: "policy",
    }));

    const base = await compiler(baseRegistry).compile(request(policy));
    const withHidden = await compiler(hiddenRegistry).compile(request(policy));

    expect(JSON.stringify(withHidden)).toBe(JSON.stringify(base));
  });

  it("does not let an excluded duplicate candidate id suppress a visible candidate", async () => {
    const visible = candidate("shared-id", "docs", "document:visible");
    const excluded = candidate("shared-id", "docs", "document:excluded", {
      priority: 999,
    });
    const baseRegistry = new ContextContributorRegistry();
    baseRegistry.register(contributor("docs", [visible]));
    const excludedRegistry = new ContextContributorRegistry();
    excludedRegistry.register(contributor("docs", [excluded, visible]));

    const base = await compiler(baseRegistry).compile(
      request(auth(), { excludedResourceKeys: ["document:excluded"] })
    );
    const withExcluded = await compiler(excludedRegistry).compile(
      request(auth(), { excludedResourceKeys: ["document:excluded"] })
    );

    expect(JSON.stringify(withExcluded)).toBe(JSON.stringify(base));
  });

  it("does not reveal a malformed descriptor behind discovery denial", async () => {
    const visible = candidate("visible", "docs", "document:visible");
    const malformedHidden = {
      ...candidate("hidden", "docs", "document:hidden", {
        priority: 999,
      }),
      executable: () => "must remain hidden",
    };
    const baseRegistry = new ContextContributorRegistry();
    baseRegistry.register(contributor("docs", [visible]));
    const hiddenRegistry = new ContextContributorRegistry();
    hiddenRegistry.register({
      id: "docs",
      discover: () =>
        [malformedHidden, visible] as unknown as readonly ContextCandidate[],
      resolve: ({ candidate: item }) => resolved(item),
    });
    const policy = auth((authorization) => ({
      outcome:
        authorization.resource.target === "document:hidden" ? "deny" : "allow",
      reason: "policy",
    }));

    const base = await compiler(baseRegistry).compile(request(policy));
    const withHidden = await compiler(hiddenRegistry).compile(request(policy));

    expect(JSON.stringify(withHidden)).toBe(JSON.stringify(base));
  });
});
