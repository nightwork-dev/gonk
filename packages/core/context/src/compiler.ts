import type {
  AuthorizationDecision,
  AuthzResource,
} from "@gonk/auth";
import { captureAuthContext, type AuthContext } from "@gonk/auth";

import { ContextContributorRegistry } from "./registry.ts";
import { CONTEXT_BLOCK_SEPARATOR } from "./constants.ts";
import {
  contextCandidateSchema,
  contextCompileRequestSchema,
  contextCompileResultSchema,
  contextTokenCountSchema,
  resolvedContextCandidateSchema,
} from "./schemas.ts";
import type {
  CompiledContextBlock,
  ContextBlockingReason,
  ContextCandidate,
  ContextCompilationReceipt,
  ContextCompileRequest,
  ContextCompileResult,
  ContextContributor,
  ContextEstimateQuality,
  ContextReceiptDrop,
  ContextReceiptSelection,
  ContextTokenCount,
  ContextTokenCounter,
  ResolvedContextCandidate,
} from "./types.ts";

export const CONTEXT_COMPILER_VERSION = "0.1.1";
export { CONTEXT_BLOCK_SEPARATOR } from "./constants.ts";

export interface ContextCompilerOptions {
  registry: ContextContributorRegistry;
  tokenCounter?: ContextTokenCounter;
  configVersion?: string;
  now?: () => string;
}

interface AuthorizedCandidate {
  descriptor: ContextCandidate;
  resolved: ResolvedContextCandidate;
  pinned: boolean;
}

export class ContextCompiler {
  private readonly registry: ContextContributorRegistry;
  private readonly tokenCounter: ContextTokenCounter;
  private readonly configVersion: string;
  private readonly now: () => string;

  constructor(options: ContextCompilerOptions) {
    this.registry = options.registry;
    this.tokenCounter = options.tokenCounter ?? fallbackTokenCounter;
    this.configVersion = options.configVersion ?? "default";
    this.now = options.now ?? (() => new Date().toISOString());
    requireNonEmpty("configVersion", this.configVersion);
  }

  async compile(input: ContextCompileRequest): Promise<ContextCompileResult> {
    assertValidSync(contextCompileRequestSchema, input, "ContextCompileRequest");
    const request = captureCompileRequest(input);

    const excluded = new Set(request.excludedResourceKeys ?? []);
    const pinned = new Set(request.pinnedResourceKeys ?? []);
    for (const resourceKey of pinned) {
      if (excluded.has(resourceKey)) {
        throw new TypeError(
          `Context resource cannot be both pinned and excluded: ${resourceKey}`
        );
      }
    }

    const drops: ContextReceiptDrop[] = [];
    const blockers: ContextBlockingReason[] = [];
    const contributors = this.selectContributors(request, drops);
    const discovered = await this.discover(
      request,
      contributors,
      excluded,
      pinned,
      drops,
      blockers
    );
    const authorized = await this.resolveAndAuthorize(
      request,
      discovered,
      pinned,
      drops,
      blockers
    );
    const deduplicated = this.deduplicate(authorized, drops);

    for (const resourceKey of [...pinned].sort()) {
      if (
        !deduplicated.some(
          (candidate) => candidate.descriptor.resourceKey === resourceKey
        ) &&
        !blockers.some(
          (blocker) =>
            "resourceKey" in blocker && blocker.resourceKey === resourceKey
        )
      ) {
        blockers.push({
          reason: "resolution-failed",
          necessity: "optional",
          pinned: true,
          resourceKey,
        });
      }
    }

    const selection = await this.selectWithinBudget(
      request,
      deduplicated,
      drops,
      blockers
    );
    const sortedDrops = sortDrops(drops);
    const sortedBlockers = sortBlockers(blockers);
    const status = sortedBlockers.length === 0 ? "ready" : "blocked";
    const receiptBase = {
      kind: "context-compilation" as const,
      receiptVersion: 1 as const,
      requestId: request.requestId,
      timestamp: this.now(),
      compilerVersion: CONTEXT_COMPILER_VERSION,
      configVersion: this.configVersion,
      audience: request.audience,
      maxTokens: request.maxTokens,
      totalTokens: selection.totalTokens,
      selected: selection.blocks.map(toReceiptSelection),
      dropped: sortedDrops,
      blockers: sortedBlockers,
    };

    let result: ContextCompileResult;
    if (status === "blocked") {
      const receipt: ContextCompilationReceipt & { status: "blocked" } = {
        ...receiptBase,
        status: "blocked",
      };
      result = {
        status: "blocked",
        blockers: sortedBlockers,
        receipt,
      };
    } else {
      const receipt: ContextCompilationReceipt & { status: "ready" } = {
        ...receiptBase,
        status: "ready",
      };
      result = {
        status: "ready",
        blocks: selection.blocks,
        content: selection.content,
        totalTokens: selection.totalTokens,
        receipt,
      };
    }

    await assertValid(
      contextCompileResultSchema,
      result,
      "ContextCompileResult"
    );
    return result;
  }

  private selectContributors(
    request: ContextCompileRequest,
    drops: ContextReceiptDrop[]
  ): readonly ContextContributor[] {
    if (request.requestedContributorIds === undefined) {
      return this.registry.list();
    }

    const selected: ContextContributor[] = [];
    for (const id of [...new Set(request.requestedContributorIds)].sort()) {
      const contributor = this.registry.get(id);
      if (contributor) {
        selected.push(contributor);
      } else {
        drops.push({ reason: "contributor-failed", contributorId: id });
      }
    }
    return selected;
  }

  private async discover(
    request: ContextCompileRequest,
    contributors: readonly ContextContributor[],
    excluded: ReadonlySet<string>,
    pinned: ReadonlySet<string>,
    drops: ContextReceiptDrop[],
    blockers: ContextBlockingReason[]
  ): Promise<readonly ContextCandidate[]> {
    const candidates: ContextCandidate[] = [];
    const invalidContributors = new Set<string>();

    for (const contributor of contributors) {
      let values: readonly unknown[];
      try {
        const result = await contributor.discover({
          requestId: request.requestId,
          audience: request.audience,
          principal: request.auth.principal,
          ...(request.query === undefined ? {} : { query: request.query }),
        });
        if (!Array.isArray(result)) {
          throw new TypeError("discover must return an array");
        }
        values = result;
      } catch {
        drops.push({
          reason: "contributor-failed",
          contributorId: contributor.id,
        });
        continue;
      }

      for (const value of values) {
        const envelope = candidateAuthorizationEnvelope(value);
        if (envelope && excluded.has(envelope.resourceKey)) {
          if (envelope.necessity === "required") {
            blockers.push({
              reason: "excluded",
              necessity: "required",
              pinned: false,
              resourceKey: envelope.resourceKey,
            });
          }
          continue;
        }

        if (envelope) {
          const discovery = await authorizeSafely(request.auth, {
            action: "context.discover",
            resource: discoveryResource(request.auth, envelope.resourceKey),
          });
          if (discovery.outcome === "deny") {
            const isPinned = pinned.has(envelope.resourceKey);
            if (isPinned) {
              blockers.push({
                reason: "discovery-denied",
                necessity: envelope.necessity ?? "optional",
                pinned: true,
                resourceKey: envelope.resourceKey,
              });
            } else if (envelope.necessity === "required") {
              blockers.push({
                reason: "discovery-denied",
                necessity: "required",
                pinned: false,
              });
            }
            continue;
          }
        }

        if (
          !(await isValid(contextCandidateSchema, value)) ||
          (value as ContextCandidate).contributorId !== contributor.id
        ) {
          invalidContributors.add(contributor.id);
          if (claimedRequired(value)) {
            blockers.push({
              reason: "invalid",
              necessity: "required",
              pinned: false,
              contributorId: contributor.id,
            });
          }
          continue;
        }
        candidates.push(value as ContextCandidate);
      }
    }

    for (const contributorId of [...invalidContributors].sort()) {
      drops.push({ reason: "invalid", contributorId });
    }

    const candidateIdCounts = new Map<string, number>();
    for (const candidate of candidates) {
      candidateIdCounts.set(
        candidate.candidateId,
        (candidateIdCounts.get(candidate.candidateId) ?? 0) + 1
      );
    }

    const unique: ContextCandidate[] = [];
    const duplicateContributors = new Set<string>();
    for (const candidate of candidates) {
      if ((candidateIdCounts.get(candidate.candidateId) ?? 0) > 1) {
        duplicateContributors.add(candidate.contributorId);
        if (candidate.necessity === "required") {
          blockers.push({
            reason: "invalid",
            necessity: "required",
            pinned: false,
            contributorId: candidate.contributorId,
          });
        }
        continue;
      }
      unique.push(candidate);
    }
    for (const contributorId of [...duplicateContributors].sort()) {
      if (!invalidContributors.has(contributorId)) {
        drops.push({ reason: "invalid", contributorId });
      }
    }

    return unique.sort(compareCandidateIdentity);
  }

  private async resolveAndAuthorize(
    request: ContextCompileRequest,
    candidates: readonly ContextCandidate[],
    pinned: ReadonlySet<string>,
    drops: ContextReceiptDrop[],
    blockers: ContextBlockingReason[]
  ): Promise<readonly AuthorizedCandidate[]> {
    const authorized: AuthorizedCandidate[] = [];

    for (const candidate of candidates) {
      const isPinned = pinned.has(candidate.resourceKey);
      const contributor = this.registry.get(candidate.contributorId);
      let resolved: ResolvedContextCandidate | null = null;
      if (contributor) {
        try {
          resolved = await contributor.resolve({
            requestId: request.requestId,
            audience: request.audience,
            principal: request.auth.principal,
            candidate,
          });
        } catch {
          resolved = null;
        }
      }

      if (
        resolved === null ||
        !(await isValid(resolvedContextCandidateSchema, resolved)) ||
        !resolvedAgrees(candidate, resolved, request.audience)
      ) {
        drops.push({
          reason: "resolution-failed",
          candidateId: candidate.candidateId,
          contributorId: candidate.contributorId,
          resourceKey: candidate.resourceKey,
          necessity: candidate.necessity,
        });
        if (candidate.necessity === "required" || isPinned) {
          blockers.push(candidateBlocker("resolution-failed", candidate, isPinned));
        }
        continue;
      }

      const use = await authorizeSafely(request.auth, {
        action: "context.use",
        resource: resolved.resource,
      });
      if (use.outcome === "deny") {
        drops.push({
          reason: "use-denied",
          candidateId: candidate.candidateId,
          contributorId: candidate.contributorId,
          resourceKey: candidate.resourceKey,
          necessity: candidate.necessity,
        });
        if (candidate.necessity === "required" || isPinned) {
          blockers.push(candidateBlocker("use-denied", candidate, isPinned));
        }
        continue;
      }

      authorized.push({ descriptor: candidate, resolved, pinned: isPinned });
    }

    return authorized;
  }

  private deduplicate(
    candidates: readonly AuthorizedCandidate[],
    drops: ContextReceiptDrop[]
  ): readonly AuthorizedCandidate[] {
    const groups = new Map<string, AuthorizedCandidate[]>();
    for (const candidate of candidates) {
      const group = groups.get(candidate.descriptor.resourceKey) ?? [];
      group.push(candidate);
      groups.set(candidate.descriptor.resourceKey, group);
    }

    const winners: AuthorizedCandidate[] = [];
    for (const resourceKey of [...groups.keys()].sort()) {
      const group = groups.get(resourceKey)!.sort(compareAuthorizedCandidate);
      const winner = group[0]!;
      winners.push(winner);
      for (const duplicate of group.slice(1)) {
        drops.push({
          reason: "duplicate",
          candidateId: duplicate.descriptor.candidateId,
          contributorId: duplicate.descriptor.contributorId,
          resourceKey: duplicate.descriptor.resourceKey,
          revision: duplicate.resolved.revision,
        });
      }
    }
    return winners.sort(compareAuthorizedCandidate);
  }

  private async selectWithinBudget(
    request: ContextCompileRequest,
    candidates: readonly AuthorizedCandidate[],
    drops: ContextReceiptDrop[],
    blockers: ContextBlockingReason[]
  ): Promise<{
    blocks: readonly CompiledContextBlock[];
    content: string;
    totalTokens: number;
  }> {
    const blocks: CompiledContextBlock[] = [];
    let content = "";
    let totalTokens = 0;

    for (const candidate of candidates) {
      const renderedSegment =
        blocks.length === 0
          ? candidate.resolved.content
          : `${CONTEXT_BLOCK_SEPARATOR}${candidate.resolved.content}`;
      const nextContent = `${content}${renderedSegment}`;
      const [contentCount, renderedCount, combinedCount] = await Promise.all([
        this.count(candidate.resolved.content, request.model),
        this.count(renderedSegment, request.model),
        this.count(nextContent, request.model),
      ]);

      if (!contentCount || !renderedCount || !combinedCount) {
        drops.push({
          reason: "invalid",
          candidateId: candidate.descriptor.candidateId,
          contributorId: candidate.descriptor.contributorId,
          resourceKey: candidate.descriptor.resourceKey,
          necessity: candidate.descriptor.necessity,
        });
        if (candidate.descriptor.necessity === "required" || candidate.pinned) {
          blockers.push(
            candidateBlocker("invalid", candidate.descriptor, candidate.pinned)
          );
        }
        continue;
      }

      const tokenQuality = worstQuality(
        contentCount.quality,
        renderedCount.quality,
        combinedCount.quality
      );
      if (combinedCount.tokens > request.maxTokens) {
        drops.push({
          reason: "budget",
          candidateId: candidate.descriptor.candidateId,
          contributorId: candidate.descriptor.contributorId,
          resourceKey: candidate.descriptor.resourceKey,
          revision: candidate.resolved.revision,
          necessity: candidate.descriptor.necessity,
          contentTokens: contentCount.tokens,
          renderedTokens: renderedCount.tokens,
          tokenQuality,
        });
        if (candidate.descriptor.necessity === "required" || candidate.pinned) {
          blockers.push(
            candidateBlocker("budget", candidate.descriptor, candidate.pinned)
          );
        }
        continue;
      }

      blocks.push({
        candidateId: candidate.descriptor.candidateId,
        contributorId: candidate.descriptor.contributorId,
        resourceKey: candidate.descriptor.resourceKey,
        revision: candidate.resolved.revision,
        necessity: candidate.descriptor.necessity,
        priority: candidate.descriptor.priority,
        audience: candidate.resolved.audience,
        content: candidate.resolved.content,
        contentTokens: contentCount.tokens,
        renderedTokens: renderedCount.tokens,
        tokenQuality,
      });
      content = nextContent;
      totalTokens = combinedCount.tokens;
    }

    return { blocks, content, totalTokens };
  }

  private async count(
    content: string,
    model: string | undefined
  ): Promise<ContextTokenCount | null> {
    try {
      const count = await this.tokenCounter.count({
        content,
        ...(model === undefined ? {} : { model }),
      });
      return (await isValid(contextTokenCountSchema, count)) ? count : null;
    } catch {
      return null;
    }
  }
}

export const fallbackTokenCounter: ContextTokenCounter = {
  count: ({ content }) => ({
    tokens: content.length === 0 ? 0 : Math.max(1, Math.ceil(content.length / 4)),
    quality: "fallback",
  }),
};

function resolvedAgrees(
  descriptor: ContextCandidate,
  resolved: ResolvedContextCandidate,
  audience: ContextCompileRequest["audience"]
): boolean {
  return (
    resolved.candidateId === descriptor.candidateId &&
    resolved.contributorId === descriptor.contributorId &&
    resolved.resourceKey === descriptor.resourceKey &&
    resolved.necessity === descriptor.necessity &&
    resolved.priority === descriptor.priority &&
    resolved.audience === audience &&
    resolved.resource.target === descriptor.resourceKey
  );
}

function compareCandidateIdentity(
  a: ContextCandidate,
  b: ContextCandidate
): number {
  return (
    a.contributorId.localeCompare(b.contributorId) ||
    a.candidateId.localeCompare(b.candidateId)
  );
}

function compareAuthorizedCandidate(
  a: AuthorizedCandidate,
  b: AuthorizedCandidate
): number {
  return (
    Number(b.pinned) - Number(a.pinned) ||
    Number(b.descriptor.necessity === "required") -
      Number(a.descriptor.necessity === "required") ||
    b.descriptor.priority - a.descriptor.priority ||
    a.descriptor.contributorId.localeCompare(b.descriptor.contributorId) ||
    a.descriptor.candidateId.localeCompare(b.descriptor.candidateId)
  );
}

function candidateBlocker(
  reason: "resolution-failed" | "use-denied" | "budget" | "invalid",
  candidate: ContextCandidate,
  pinned: boolean
): ContextBlockingReason {
  return {
    reason,
    necessity: candidate.necessity,
    pinned,
    contributorId: candidate.contributorId,
    candidateId: candidate.candidateId,
    resourceKey: candidate.resourceKey,
  };
}

function toReceiptSelection(
  block: CompiledContextBlock
): ContextReceiptSelection {
  return {
    candidateId: block.candidateId,
    contributorId: block.contributorId,
    resourceKey: block.resourceKey,
    revision: block.revision,
    necessity: block.necessity,
    contentTokens: block.contentTokens,
    renderedTokens: block.renderedTokens,
    tokenQuality: block.tokenQuality,
  };
}

function sortDrops(drops: readonly ContextReceiptDrop[]): ContextReceiptDrop[] {
  return [...drops].sort((a, b) => dropKey(a).localeCompare(dropKey(b)));
}

function dropKey(drop: ContextReceiptDrop): string {
  return [
    drop.reason,
    drop.contributorId,
    "candidateId" in drop ? (drop.candidateId ?? "") : "",
    "resourceKey" in drop ? (drop.resourceKey ?? "") : "",
  ].join("\u0000");
}

function sortBlockers(
  blockers: readonly ContextBlockingReason[]
): ContextBlockingReason[] {
  return [...blockers].sort((a, b) =>
    blockerKey(a).localeCompare(blockerKey(b))
  );
}

function blockerKey(blocker: ContextBlockingReason): string {
  return [
    blocker.reason,
    "contributorId" in blocker ? (blocker.contributorId ?? "") : "",
    "candidateId" in blocker ? (blocker.candidateId ?? "") : "",
    "resourceKey" in blocker ? (blocker.resourceKey ?? "") : "",
  ].join("\u0000");
}

function worstQuality(
  ...qualities: readonly ContextEstimateQuality[]
): ContextEstimateQuality {
  if (qualities.includes("fallback")) return "fallback";
  if (qualities.includes("model-aware")) return "model-aware";
  return "exact";
}

async function authorizeSafely(
  auth: AuthContext,
  request: Parameters<AuthContext["authorize"]>[0]
): Promise<AuthorizationDecision> {
  try {
    const decision = await auth.authorize(request);
    if (
      decision &&
      (decision.outcome === "allow" || decision.outcome === "deny") &&
      typeof decision.reason === "string"
    ) {
      return decision;
    }
  } catch {
    // Fail closed below.
  }
  return { outcome: "deny", reason: "Authorization policy failed" };
}

async function assertValid<T>(
  schema: {
    readonly "~standard": {
      validate(value: unknown):
        | { value: T; issues?: undefined }
        | { issues: readonly unknown[] }
        | Promise<{ value: T; issues?: undefined } | { issues: readonly unknown[] }>;
    };
  },
  value: unknown,
  label: string
): Promise<void> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) {
    throw new TypeError(`Invalid ${label}`);
  }
}

async function isValid(
  schema: {
    readonly "~standard": {
      validate(value: unknown): unknown | Promise<unknown>;
    };
  },
  value: unknown
): Promise<boolean> {
  const result = await schema["~standard"].validate(value);
  return (
    result !== null &&
    typeof result === "object" &&
    !("issues" in result && (result as { issues?: unknown }).issues)
  );
}

function claimedRequired(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { necessity?: unknown }).necessity === "required"
  );
}

function candidateAuthorizationEnvelope(value: unknown): {
  resourceKey: string;
  necessity?: ContextCandidate["necessity"];
} | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidateValue = value as {
    resourceKey?: unknown;
    necessity?: unknown;
  };
  if (
    typeof candidateValue.resourceKey !== "string" ||
    candidateValue.resourceKey.trim().length === 0
  ) {
    return null;
  }
  return {
    resourceKey: candidateValue.resourceKey,
    ...(candidateValue.necessity === "optional" ||
    candidateValue.necessity === "required"
      ? { necessity: candidateValue.necessity }
      : {}),
  };
}

function discoveryResource(
  auth: AuthContext,
  resourceKey: string
): AuthzResource {
  return {
    kind: "context-candidate",
    target: resourceKey,
    ...(auth.principal.tenantId === undefined
      ? {}
      : { tenantId: auth.principal.tenantId }),
    ...(auth.principal.workspaceId === undefined
      ? {}
      : { workspaceId: auth.principal.workspaceId }),
  };
}

function captureCompileRequest(
  request: ContextCompileRequest
): ContextCompileRequest {
  const captured = {
    requestId: request.requestId,
    auth: captureAuthContext(request.auth),
    audience: request.audience,
    maxTokens: request.maxTokens,
    ...(request.model === undefined ? {} : { model: request.model }),
    ...(request.query === undefined ? {} : { query: request.query }),
    ...(request.requestedContributorIds === undefined
      ? {}
      : {
          requestedContributorIds: normalizeStringList(
            request.requestedContributorIds
          ),
        }),
    ...(request.excludedResourceKeys === undefined
      ? {}
      : {
          excludedResourceKeys: normalizeStringList(
            request.excludedResourceKeys
          ),
        }),
    ...(request.pinnedResourceKeys === undefined
      ? {}
      : {
          pinnedResourceKeys: normalizeStringList(request.pinnedResourceKeys),
        }),
  } satisfies ContextCompileRequest;
  return Object.freeze(captured);
}

function normalizeStringList(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function assertValidSync<T>(
  schema: {
    readonly "~standard": {
      validate(value: unknown):
        | { value: T; issues?: undefined }
        | { issues: readonly unknown[] }
        | Promise<
            | { value: T; issues?: undefined }
            | { issues: readonly unknown[] }
          >;
    };
  },
  value: unknown,
  label: string
): void {
  const result = schema["~standard"].validate(value);
  if (result instanceof Promise) {
    throw new TypeError(`${label} validator must be synchronous at capture`);
  }
  if ("issues" in result && result.issues) {
    throw new TypeError(`Invalid ${label}`);
  }
}

function requireNonEmpty(label: string, value: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
}
