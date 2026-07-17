import type {
  AuthContext,
  AuthenticatedPrincipal,
  AuthorizationRequest,
} from "@gonk/auth";
import { ContextCompiler, ContextContributorRegistry } from "@gonk/context";
import { BackedKvStore } from "@gonk/store";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { describe, expect, it } from "vitest";

import {
  canonicalResourceKey,
  RetrievalEngine,
  RetrievalIndexCoordinator,
  RetrievalSourceRegistry,
  type NativeRetrievalSource,
  type RetrievalGenerationStorage,
  type RetrievalHit,
  type RetrievalResourceRef,
  type SourceResolutionResult,
} from "../src/index.ts";
import {
  createRetrievalContextContributor,
  listRetrievalContextSources,
} from "../src/context-adapter.ts";
import { MemoryStoreBackend } from "./memory-backend.ts";

const NOW = "2026-07-17T03:45:00.000Z";

describe("retrieval context adapter", () => {
  it("does not put search results in the prompt until the hit is explicitly selected", async () => {
    const fixture = makeFixture();
    const hit = retrievalHit(resource("visible", "alpha", "r1"));
    const registry = new ContextContributorRegistry();
    let selected: readonly RetrievalHit[] = [];
    registry.register(
      createRetrievalContextContributor({
        engine: fixture.engine,
        registry: fixture.registry,
        authForRequest: () => fixture.auth,
        selections: () =>
          selected.map((candidate, index) => ({
            candidateId: `retrieval-${index}`,
            hit: candidate,
            priority: candidate.scores.final,
            estimatedTokens: 4,
          })),
      })
    );
    const compiler = new ContextCompiler({
      registry,
      now: () => NOW,
      tokenCounter: { count: () => ({ tokens: 4, quality: "exact" }) },
    });

    const empty = await compiler.compile({
      requestId: "ctx-empty",
      auth: fixture.auth,
      audience: "model",
      maxTokens: 100,
    });
    expect(empty.status).toBe("ready");
    if (empty.status === "ready") {
      expect(empty.content).toBe("");
      expect(empty.blocks).toHaveLength(0);
    }

    selected = [hit];
    const compiled = await compiler.compile({
      requestId: "ctx-selected",
      auth: fixture.auth,
      audience: "model",
      maxTokens: 100,
    });
    expect(compiled.status).toBe("ready");
    if (compiled.status !== "ready") throw new Error("expected ready context");
    expect(compiled.content).toContain("visible alpha body");
    expect(compiled.blocks).toHaveLength(1);
    expect(compiled.receipt.selected[0]).toMatchObject({
      resourceKey: canonicalResourceKey(hit.resource),
      revision: "r1",
    });
  });

  it("keeps hidden selected sources out of context candidates and source health", async () => {
    const fixture = makeFixture();
    fixture.policy.hiddenSources.add("hidden");
    const hiddenHit = retrievalHit(resource("hidden", "secret", "r1"));
    const registry = new ContextContributorRegistry();
    registry.register(
      createRetrievalContextContributor({
        engine: fixture.engine,
        registry: fixture.registry,
        authForRequest: () => fixture.auth,
        selections: () => [{ candidateId: "hidden-hit", hit: hiddenHit }],
      })
    );
    const compiler = new ContextCompiler({
      registry,
      now: () => NOW,
      tokenCounter: { count: () => ({ tokens: 1, quality: "exact" }) },
    });

    const withHidden = await compiler.compile({
      requestId: "ctx-redacted",
      auth: fixture.auth,
      audience: "model",
      maxTokens: 100,
    });
    const withoutHidden = await new ContextCompiler({
      registry: new ContextContributorRegistry(),
      now: () => NOW,
      tokenCounter: { count: () => ({ tokens: 1, quality: "exact" }) },
    }).compile({
      requestId: "ctx-none",
      auth: fixture.auth,
      audience: "model",
      maxTokens: 100,
    });
    expect(withHidden).toEqual({
      ...withoutHidden,
      receipt: {
        ...withoutHidden.receipt,
        requestId: "ctx-redacted",
      },
    });
    expect(JSON.stringify(withHidden)).not.toContain("hidden");
    expect(JSON.stringify(withHidden)).not.toContain("secret");

    const probed: string[] = [];
    const sources = await listRetrievalContextSources(
      {
        registry: fixture.registry,
        probe: ({ source }) => {
          probed.push(source.id);
          return {
            health: "available",
            freshness: "fresh",
            checkedAt: NOW,
          };
        },
      },
      { requestId: "sources", auth: fixture.auth }
    );
    expect(probed).toEqual(["visible"]);
    expect(sources.sources.map(({ sourceId }) => sourceId)).toEqual(["visible"]);
    expect(sources.sources[0]).toMatchObject({
      sourceId: "visible",
      health: "available",
      freshness: "fresh",
      checkedAt: NOW,
    });
    expect(JSON.stringify(sources)).not.toContain("hidden");
  });

  it("rejects malformed source health probe output before returning it", async () => {
    const fixture = makeFixture();
    await expect(
      listRetrievalContextSources(
        {
          registry: fixture.registry,
          probe: () =>
            ({
              health: "available",
              freshness: "fresh",
              extra: "not closed",
            }) as never,
        },
        { requestId: "bad-probe", auth: fixture.auth }
      )
    ).rejects.toThrow("Invalid RetrievalContextSourceStatus probe result");
  });

  it("fails closed when the captured auth does not match the context principal", async () => {
    const fixture = makeFixture();
    const otherAuth = authContext(new Policy(), {
      ...principal(),
      id: "other",
      identity: { issuer: "test", subject: "other", method: "local" },
    });
    const registry = new ContextContributorRegistry();
    registry.register(
      createRetrievalContextContributor({
        engine: fixture.engine,
        registry: fixture.registry,
        authForRequest: () => otherAuth,
        selections: () => [
          { candidateId: "wrong-auth", hit: retrievalHit(resource("visible", "alpha", "r1")) },
        ],
      })
    );
    const compiled = await new ContextCompiler({
      registry,
      now: () => NOW,
      tokenCounter: { count: () => ({ tokens: 1, quality: "exact" }) },
    }).compile({
      requestId: "ctx-wrong-auth",
      auth: fixture.auth,
      audience: "model",
      maxTokens: 100,
    });
    expect(compiled.status).toBe("ready");
    if (compiled.status === "ready") expect(compiled.blocks).toHaveLength(0);
  });
});

function makeFixture() {
  const policy = new Policy();
  const registry = new RetrievalSourceRegistry();
  registry.register(new TestNativeSource("visible"));
  registry.register(new TestNativeSource("hidden"));
  const storage: RetrievalGenerationStorage = {
    generations: new BackedKvStore<unknown>(new MemoryStoreBackend()),
    pointers: new BackedKvStore<unknown>(new MemoryStoreBackend()),
    citations: new BackedKvStore<unknown>(new MemoryStoreBackend()),
  };
  const auth = authContext(policy, principal());
  const coordinator = new RetrievalIndexCoordinator({
    registry,
    storage,
    clock: { now: () => NOW },
  });
  const engine = new RetrievalEngine({
    registry,
    coordinator,
    storage,
    clock: { now: () => NOW },
  });
  return { policy, registry, auth, engine };
}

class TestNativeSource implements NativeRetrievalSource<{ tag?: string }> {
  readonly description;
  readonly filterSchema = exactOptionalTagSchema;

  constructor(id: string) {
    this.description = {
      id,
      label: `${id} source`,
      mode: "native-index" as const,
      rankingContract: "source-enforced-authorized-corpus" as const,
      revisionResolution: "historical" as const,
      resourceKinds: ["document"],
      filter: { schemaId: `${id}.filter`, schemaVersion: 1 },
      priority: 10,
    };
  }

  search() {
    return [];
  }

  resolve(resource: RetrievalResourceRef): SourceResolutionResult {
    return {
      status: "resolved",
      value: {
        resource,
        label: `${resource.sourceId} ${resource.id}`,
        content: `${resource.sourceId} ${resource.id} body`,
        audience: "tenant",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
      },
    };
  }
}

class Policy {
  readonly hiddenSources = new Set<string>();
}

function authContext(policy: Policy, principalValue: AuthenticatedPrincipal): AuthContext {
  return {
    principal: principalValue,
    authorize: (request: AuthorizationRequest) => {
      if (
        request.resource.kind === "retrieval-source" &&
        request.resource.target !== undefined &&
        policy.hiddenSources.has(request.resource.target)
      ) {
        return { outcome: "deny", reason: "hidden source" };
      }
      if (
        request.resource.kind === "retrieval-resource" &&
        typeof request.resource.target === "string"
      ) {
        const sourceId = request.resource.target.split(":")[1];
        if (sourceId !== undefined && policy.hiddenSources.has(sourceId)) {
          return { outcome: "deny", reason: "hidden resource" };
        }
      }
      return { outcome: "allow", reason: "test allow" };
    },
  };
}

function principal(): AuthenticatedPrincipal {
  return {
    id: "agent:test",
    kind: "agent",
    identity: { issuer: "test", subject: "agent:test", method: "local" },
    roles: ["tester"],
    scopes: ["retrieval", "context"],
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
  };
}

function resource(
  sourceId: string,
  id: string,
  revision: string
): RetrievalResourceRef {
  return {
    sourceId,
    kind: "document",
    id,
    revision,
    fragment: { kind: "record", id: "body" },
  };
}

function retrievalHit(resourceValue: RetrievalResourceRef): RetrievalHit {
  return {
    resource: resourceValue,
    audience: "tenant",
    scores: {
      lexical: { algorithm: "native", sourceId: resourceValue.sourceId, value: 1 },
      sourcePriority: 10,
      final: 11,
    },
    matchedTerms: ["body"],
  };
}

const exactOptionalTagSchema: StandardSchemaV1<unknown, { tag?: string }> = {
  "~standard": {
    version: 1,
    vendor: "test",
    validate: (value) => {
      if (
        value === undefined ||
        (value !== null &&
          typeof value === "object" &&
          Object.keys(value).every((key) => key === "tag") &&
          ((value as { tag?: unknown }).tag === undefined ||
            typeof (value as { tag?: unknown }).tag === "string"))
      ) {
        return { value: value as { tag?: string } };
      }
      return { issues: [{ message: "invalid filter" }] };
    },
  },
};
