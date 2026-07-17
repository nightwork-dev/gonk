import { captureAuthContext, type AuthContext } from "@gonk/auth";

import { authorizeRetrieval, sourceAuthzResource } from "./authorization.ts";
import {
  retrievalSourceDescriptionSchema,
  retrievalSourceListRequestSchema,
  retrievalSourceListResultSchema,
} from "./schemas.ts";
import type {
  RetrievalSource,
  RetrievalSourceDescription,
  RetrievalSourceListRequest,
  RetrievalSourceListResult,
} from "./types.ts";
import { validateStandard, validateStandardSync } from "./validation.ts";

export class RetrievalSourceRegistry {
  private readonly sources = new Map<string, RetrievalSource>();

  register<Filter>(source: RetrievalSourceForRegistration<Filter>): void {
    const description = validateStandardSync(
      retrievalSourceDescriptionSchema,
      source.description,
      "RetrievalSourceDescription"
    );
    if (this.sources.has(description.id)) {
      throw new Error(`Retrieval source already registered: ${description.id}`);
    }
    if (
      !source.filterSchema ||
      source.filterSchema["~standard"]?.version !== 1 ||
      typeof source.filterSchema["~standard"].validate !== "function"
    ) {
      throw new TypeError(`Retrieval source ${description.id} has no Standard Schema filter`);
    }
    this.sources.set(description.id, snapshotSource(source, description));
  }

  async list(request: RetrievalSourceListRequest): Promise<RetrievalSourceListResult> {
    const valid = await validateStandard(
      retrievalSourceListRequestSchema,
      request,
      "RetrievalSourceListRequest"
    );
    const auth = captureAuthContext(valid.auth);
    const sources: RetrievalSourceDescription[] = [];
    for (const source of this.registered()) {
      if (await this.canDiscover(source, auth)) sources.push(source.description);
    }
    return validateStandard(
      retrievalSourceListResultSchema,
      { sources },
      "RetrievalSourceListResult"
    );
  }

  /** Trusted in-process lookup. Callers must still apply discovery authorization. */
  getRegistered(sourceId: string): RetrievalSource | undefined {
    return this.sources.get(sourceId);
  }

  registered(): readonly RetrievalSource[] {
    return [...this.sources.values()].sort((left, right) =>
      left.description.id < right.description.id
        ? -1
        : left.description.id > right.description.id
          ? 1
          : 0
    );
  }

  async canDiscover(source: RetrievalSource, auth: AuthContext): Promise<boolean> {
    return authorizeRetrieval(
      auth,
      "retrieval.source.discover",
      sourceAuthzResource(source.description, auth.principal)
    );
  }
}

type RetrievalSourceForRegistration<Filter> =
  | import("./types.ts").NativeRetrievalSource<Filter>
  | import("./types.ts").CoordinatedRetrievalSource<Filter>;

function snapshotSource<Filter>(
  source: RetrievalSourceForRegistration<Filter>,
  description: RetrievalSourceDescription
): RetrievalSource {
  const stableDescription = deepFreeze(structuredClone(description));
  if (typeof source.resolve !== "function") {
    throw new TypeError(`Retrieval source ${description.id} does not implement resolution`);
  }
  if (isNativeRegistration(source)) {
    if (typeof source.search !== "function") {
      throw new TypeError(`Retrieval source ${description.id} does not implement native search`);
    }
    return Object.freeze({
      description: stableDescription as RetrievalSourceDescription & {
        mode: "native-index";
      },
      filterSchema: source.filterSchema,
      search: source.search.bind(source),
      resolve: source.resolve.bind(source),
    }) as RetrievalSource;
  }
  if (
    typeof source.scan !== "function" ||
    typeof source.matchesFilter !== "function"
  ) {
    throw new TypeError(`Retrieval source ${description.id} does not implement coordinated scan`);
  }
  return Object.freeze({
    description: stableDescription as RetrievalSourceDescription & {
      mode: "coordinated-index";
    },
    filterSchema: source.filterSchema,
    scan: source.scan.bind(source),
    matchesFilter: source.matchesFilter.bind(source),
    resolve: source.resolve.bind(source),
  }) as RetrievalSource;
}

function isNativeRegistration<Filter>(
  source: RetrievalSourceForRegistration<Filter>
): source is import("./types.ts").NativeRetrievalSource<Filter> {
  return source.description.mode === "native-index";
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
