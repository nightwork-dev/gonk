import {
  securityContextKey,
  type AuthContext,
  type AuthenticatedPrincipal,
} from "@gonk/auth";
import type {
  ContextAudience,
  ContextCandidate,
  ContextContributor,
  ContextDiscoveryRequest,
  ContextEstimateQuality,
  ContextNecessity,
  ContextResolutionRequest,
  ResolvedContextCandidate,
} from "@gonk/context";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import {
  authorizeRetrieval,
  resourceBelongsToSource,
  retrievalAuthzResource,
} from "./authorization.ts";
import { canonicalResourceKey } from "./identity.ts";
import { retrievalHitSchema } from "./schemas.ts";
import type {
  RetrievalHit,
  RetrievalResolveResult,
  RetrievalSourceDescription,
  RetrievalSourceListRequest,
  RetrievalSourceListResult,
} from "./types.ts";
import { validateStandard } from "./validation.ts";
import { RetrievalEngine } from "./engine.ts";
import { RetrievalSourceRegistry } from "./registry.ts";

export type RetrievalContextSourceHealth =
  | "available"
  | "degraded"
  | "unavailable"
  | "unknown";

export type RetrievalContextSourceFreshness =
  | "fresh"
  | "stale"
  | "unknown"
  | "unavailable";

export interface RetrievalContextSourceStatus {
  sourceId: string;
  mode: RetrievalSourceDescription["mode"];
  label: string;
  health: RetrievalContextSourceHealth;
  freshness: RetrievalContextSourceFreshness;
  checkedAt?: string;
}

export type RetrievalContextSourceProbeResult = Omit<
  RetrievalContextSourceStatus,
  "sourceId" | "mode" | "label"
>;

export type RetrievalContextSourceProbe = (input: {
  source: RetrievalSourceDescription;
  auth: AuthContext;
}) =>
  | RetrievalContextSourceProbeResult
  | Promise<RetrievalContextSourceProbeResult>;

export interface RetrievalContextSelection {
  candidateId: string;
  hit: RetrievalHit;
  necessity?: ContextNecessity;
  priority?: number;
  estimatedTokens?: number;
  estimateQuality?: ContextEstimateQuality;
}

export interface RetrievalContextSelectionRequest {
  requestId: string;
  audience: ContextAudience;
  principal: AuthenticatedPrincipal;
  query?: string;
}

export type RetrievalContextSelectionProvider = (
  request: RetrievalContextSelectionRequest
) => readonly RetrievalContextSelection[] | Promise<readonly RetrievalContextSelection[]>;

export type RetrievalContextAuthProvider = (
  requestId: string,
  principal: AuthenticatedPrincipal
) => AuthContext | undefined | Promise<AuthContext | undefined>;

export interface RetrievalContextContributorOptions {
  engine: Pick<RetrievalEngine, "resolve">;
  registry: RetrievalSourceRegistry;
  selections: RetrievalContextSelectionProvider;
  authForRequest: RetrievalContextAuthProvider;
  contributorId?: string;
}

export interface RetrievalContextSourceProjectionOptions {
  registry: RetrievalSourceRegistry;
  probe?: RetrievalContextSourceProbe;
}

const DEFAULT_CONTRIBUTOR_ID = "gonk.retrieval.context";

export const retrievalContextSourceProbeResultSchema =
  schema<RetrievalContextSourceProbeResult>(
    "RetrievalContextSourceProbeResult",
    isRetrievalContextSourceProbeResult
  );
export const retrievalContextSourceStatusSchema =
  schema<RetrievalContextSourceStatus>(
    "RetrievalContextSourceStatus",
    isRetrievalContextSourceStatus
  );
export const retrievalContextSourceStatusListSchema = schema<{
  sources: readonly RetrievalContextSourceStatus[];
}>("RetrievalContextSourceStatusList", isRetrievalContextSourceStatusList);
export const retrievalContextSelectionSchema =
  asyncSchema<RetrievalContextSelection>(
    "RetrievalContextSelection",
    isRetrievalContextSelection
  );
export const retrievalContextSelectionListSchema =
  asyncSchema<readonly RetrievalContextSelection[]>(
    "RetrievalContextSelectionList",
    async (value): Promise<boolean> =>
      Array.isArray(value) &&
      (await allAsync(value, isRetrievalContextSelection))
  );

export function createRetrievalContextContributor(
  options: RetrievalContextContributorOptions
): ContextContributor {
  const contributorId = options.contributorId ?? DEFAULT_CONTRIBUTOR_ID;
  return {
    id: contributorId,
    async discover(request) {
      const auth = await authForContextRequest(options, request);
      if (!auth) return [];
      const selections = await selectedVisibleHits(options, request, auth);
      return selections.map((selection) =>
        selectionToCandidate(contributorId, selection)
      );
    },
    async resolve(request) {
      const auth = await authForContextRequest(options, request);
      if (!auth) return null;
      const selections = await selectedVisibleHits(options, request, auth);
      const selection = selections.find(
        (candidate) =>
          candidate.candidateId === request.candidate.candidateId &&
          canonicalResourceKey(candidate.hit.resource) === request.candidate.resourceKey
      );
      if (!selection) return null;
      const resolution = await options.engine.resolve({
        requestId: `${request.requestId}:retrieval:${request.candidate.candidateId}`,
        auth,
        resource: selection.hit.resource,
      });
      return resolutionToContext(request, selection, resolution);
    },
  };
}

export async function listRetrievalContextSources(
  options: RetrievalContextSourceProjectionOptions,
  request: RetrievalSourceListRequest
): Promise<{ sources: readonly RetrievalContextSourceStatus[] }> {
  const listed: RetrievalSourceListResult = await options.registry.list(request);
  const sources: RetrievalContextSourceStatus[] = [];
  for (const source of listed.sources) {
    const probed =
      options.probe === undefined
        ? { health: "unknown" as const, freshness: "unknown" as const }
        : await validateStandard(
            retrievalContextSourceProbeResultSchema,
            await options.probe({ source, auth: request.auth }),
            "RetrievalContextSourceProbeResult"
          );
    sources.push({
      sourceId: source.id,
      mode: source.mode,
      label: source.label,
      health: probed.health,
      freshness: probed.freshness,
      ...(probed.checkedAt === undefined ? {} : { checkedAt: probed.checkedAt }),
    });
  }
  return validateStandard(
    retrievalContextSourceStatusListSchema,
    {
      sources: sources.sort((left, right) =>
        left.sourceId < right.sourceId ? -1 : left.sourceId > right.sourceId ? 1 : 0
      ),
    },
    "RetrievalContextSourceStatusList"
  );
}

function isHealth(value: unknown): value is RetrievalContextSourceHealth {
  return (
    value === "available" ||
    value === "degraded" ||
    value === "unavailable" ||
    value === "unknown"
  );
}

function isFreshness(value: unknown): value is RetrievalContextSourceFreshness {
  return (
    value === "fresh" ||
    value === "stale" ||
    value === "unknown" ||
    value === "unavailable"
  );
}

async function authForContextRequest(
  options: Pick<RetrievalContextContributorOptions, "authForRequest">,
  request: ContextDiscoveryRequest | ContextResolutionRequest
): Promise<AuthContext | undefined> {
  const auth = await options.authForRequest(request.requestId, request.principal);
  if (!auth) return undefined;
  return securityContextKey({ principal: auth.principal }) ===
    securityContextKey({ principal: request.principal })
    ? auth
    : undefined;
}

async function selectedVisibleHits(
  options: RetrievalContextContributorOptions,
  request: ContextDiscoveryRequest | ContextResolutionRequest,
  auth: AuthContext
): Promise<readonly RetrievalContextSelection[]> {
  const raw = await validateStandard(
    retrievalContextSelectionListSchema,
    await options.selections({
      requestId: request.requestId,
      audience: request.audience,
      principal: request.principal,
      ...("query" in request && request.query === undefined ? {} : "query" in request ? { query: request.query } : {}),
    }),
    "RetrievalContextSelectionList"
  );
  const visible: RetrievalContextSelection[] = [];
  const seenCandidates = new Set<string>();
  for (const selection of raw) {
    if (seenCandidates.has(selection.candidateId)) continue;
    const source = options.registry.getRegistered(selection.hit.resource.sourceId);
    if (!source) continue;
    if (!resourceBelongsToSource(selection.hit.resource, source.description)) continue;
    if (!(await options.registry.canDiscover(source, auth))) continue;
    if (!hitAudienceMatchesPrincipal(selection.hit, auth.principal)) continue;
    if (
      !(await authorizeRetrieval(
        auth,
        "retrieval.hit.read",
        retrievalAuthzResource(selection.hit)
      ))
    ) {
      continue;
    }
    seenCandidates.add(selection.candidateId);
    visible.push(selection);
  }
  return visible.sort((left, right) =>
    left.candidateId < right.candidateId
      ? -1
      : left.candidateId > right.candidateId
        ? 1
        : 0
  );
}

function selectionToCandidate(
  contributorId: string,
  selection: RetrievalContextSelection
): ContextCandidate {
  return {
    candidateId: selection.candidateId,
    contributorId,
    resourceKey: canonicalResourceKey(selection.hit.resource),
    revisionHint: selection.hit.resource.revision,
    necessity: selection.necessity ?? "optional",
    priority: selection.priority ?? selection.hit.scores.final,
    estimatedTokens: selection.estimatedTokens ?? 1,
    estimateQuality: selection.estimateQuality ?? "fallback",
  };
}

function resolutionToContext(
  request: ContextResolutionRequest,
  selection: RetrievalContextSelection,
  resolution: RetrievalResolveResult
): ResolvedContextCandidate | null {
  if (resolution.status !== "resolved") return null;
  if (
    canonicalResourceKey(resolution.value.resource) !== request.candidate.resourceKey ||
    resolution.value.resource.revision !== selection.hit.resource.revision
  ) {
    return null;
  }
  return {
    candidateId: request.candidate.candidateId,
    contributorId: request.candidate.contributorId,
    resourceKey: request.candidate.resourceKey,
    revision: resolution.value.resource.revision,
    necessity: request.candidate.necessity,
    priority: request.candidate.priority,
    audience: request.audience,
    content: resolution.value.content,
    resource: retrievalAuthzResource(resolution.value),
  };
}

function hitAudienceMatchesPrincipal(
  hit: RetrievalHit,
  principal: AuthenticatedPrincipal
): boolean {
  if (hit.audience === "public") return true;
  if (hit.audience === "tenant") return principal.tenantId !== undefined;
  if (hit.audience === "workspace") return principal.workspaceId !== undefined;
  return false;
}

async function isRetrievalContextSelection(
  value: unknown
): Promise<boolean> {
  if (
    !isExactRecord(value, [
      "candidateId",
      "hit",
      "necessity",
      "priority",
      "estimatedTokens",
      "estimateQuality",
    ])
  ) {
    return false;
  }
  if (
    !isNonEmptyString(value.candidateId) ||
    (value.necessity !== undefined &&
      value.necessity !== "required" &&
      value.necessity !== "useful" &&
      value.necessity !== "optional") ||
    (value.priority !== undefined && !isFiniteNumber(value.priority)) ||
    (value.estimatedTokens !== undefined &&
      !isPositiveInteger(value.estimatedTokens)) ||
    (value.estimateQuality !== undefined &&
      value.estimateQuality !== "exact" &&
      value.estimateQuality !== "model-aware" &&
      value.estimateQuality !== "fallback")
  ) {
    return false;
  }
  try {
    await validateStandard(retrievalHitSchema, value.hit, "RetrievalHit");
    return true;
  } catch {
    return false;
  }
}

function isRetrievalContextSourceProbeResult(
  value: unknown
): value is RetrievalContextSourceProbeResult {
  return (
    isExactRecord(value, ["checkedAt", "freshness", "health"]) &&
    isHealth(value.health) &&
    isFreshness(value.freshness) &&
    (value.checkedAt === undefined || isNonEmptyString(value.checkedAt))
  );
}

function isRetrievalContextSourceStatus(
  value: unknown
): value is RetrievalContextSourceStatus {
  return (
    isExactRecord(value, [
      "sourceId",
      "mode",
      "label",
      "health",
      "freshness",
      "checkedAt",
    ]) &&
    isNonEmptyString(value.sourceId) &&
    (value.mode === "native-index" || value.mode === "coordinated-index") &&
    isNonEmptyString(value.label) &&
    isHealth(value.health) &&
    isFreshness(value.freshness) &&
    (value.checkedAt === undefined || isNonEmptyString(value.checkedAt))
  );
}

function isRetrievalContextSourceStatusList(
  value: unknown
): value is { sources: readonly RetrievalContextSourceStatus[] } {
  return (
    isExactRecord(value, ["sources"]) &&
    Array.isArray(value.sources) &&
    value.sources.every(isRetrievalContextSourceStatus)
  );
}

function schema<T>(
  label: string,
  check: (value: unknown) => value is T
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "gonk",
      validate: (value) =>
        check(value) ? { value } : { issues: [{ message: `Invalid ${label}` }] },
    },
  };
}

function asyncSchema<T>(
  label: string,
  check: (value: unknown) => Promise<boolean>
): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "gonk",
      validate: async (value) =>
        (await check(value))
          ? { value: value as T }
          : { issues: [{ message: `Invalid ${label}` }] },
    },
  };
}

async function allAsync<T>(
  values: readonly T[],
  check: (value: T) => Promise<boolean>
): Promise<boolean> {
  for (const value of values) {
    if (!(await check(value))) return false;
  }
  return true;
}

function isExactRecord(
  value: unknown,
  allowedKeys: readonly string[]
): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowedKeys.includes(key))
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
