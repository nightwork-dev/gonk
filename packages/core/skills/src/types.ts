import type { ScopeEnvironment } from "@gonk/scope";

export type SkillScope =
  | "global"
  | "persona"
  | "project"
  | "directory"
  | "session";

export type SkillLifecycle = "active" | "staged" | "archived";

export type SkillOriginKind =
  | "gonk-managed"
  | "host-installed"
  | "package"
  | "workspace";

export type SkillCapability =
  | "read"
  | "attach"
  | "activate"
  | "edit"
  | "archive"
  | "delete"
  | "pin"
  | "test";

export type SkillFreshness =
  | "fresh"
  | "stale"
  | "dead"
  | "unprobeable"
  | "unknown";

export type SkillProvenanceAnchorKind = "file" | "symbol";

export interface SkillOrigin {
  kind: SkillOriginKind;
  adapterId?: string;
  packageId?: string;
}

export interface SkillRequirement {
  tools?: readonly string[];
  hosts?: readonly string[];
  platforms?: readonly string[];
}

export interface SkillProvenanceAnchor {
  kind: SkillProvenanceAnchorKind;
  value: string;
}

export interface SkillProvenance {
  repositoryId?: string;
  packageId?: string;
  version?: string;
  pinnedAt?: string;
  anchors: readonly SkillProvenanceAnchor[];
}

export interface SkillFreshnessResult {
  status: SkillFreshness;
  summary?: string;
  checkedAt?: string;
}

export interface SkillFreshnessProbeInput {
  id: string;
  revision: string;
  provenance: SkillProvenance;
}

export interface SkillFreshnessProbe {
  probe(
    input: SkillFreshnessProbeInput
  ):
    | SkillFreshnessResult
    | Promise<SkillFreshnessResult>;
}

export interface SkillFileEntry {
  kind: "file";
  name: string;
  path: string;
  size: number;
  contentHash: string;
}

export interface SkillDirectoryEntry {
  kind: "directory";
  name: string;
  path: string;
  children: readonly SkillTreeEntry[];
}

export type SkillTreeEntry = SkillFileEntry | SkillDirectoryEntry;

export interface ManagedSkillSummary {
  id: string;
  name?: string;
  description: string;
  version?: string;
  author?: string;
  origin: SkillOrigin;
  scope: SkillScope;
  lifecycle: "active";
  capabilities: readonly SkillCapability[];
  revision: string;
  contentHash: string;
  pinned?: boolean;
  agentCreated?: boolean;
  useCount?: number;
  lastUsedAt?: string;
  updatedAt?: string;
  requirements?: SkillRequirement;
  freshness?: SkillFreshnessResult;
}

export interface ManagedSkillDetail extends ManagedSkillSummary {
  body: string;
  supportingFiles: readonly SkillTreeEntry[];
  provenance?: SkillProvenance;
  /** Other definitions of this id, labelled neutrally in scope order. */
  otherDefinitions: readonly ManagedSkillSummary[];
}

export interface SkillListRequest {
  scope?: SkillScope;
  includeFreshness?: boolean;
}

export interface SkillGetRequest {
  id: string;
  scope?: SkillScope;
  includeFreshness?: boolean;
}

export interface SkillResolveRequest {
  id: string;
  includeFreshness?: boolean;
}

export interface SkillReadRequest {
  id: string;
  path?: string;
  scope?: SkillScope;
}

export interface SkillListResult {
  status: "ok";
  skills: readonly ManagedSkillSummary[];
}

export type SkillGetResult =
  | { status: "found"; skill: ManagedSkillDetail }
  | { status: "not-found"; id: string };

export type SkillResolveResult =
  | {
      status: "found";
      id: string;
      active: ManagedSkillDetail;
      definitions: readonly ManagedSkillSummary[];
    }
  | { status: "not-found"; id: string };

export type SkillReadResult =
  | {
      status: "found";
      id: string;
      scope: SkillScope;
      path: string;
      content: string;
      contentHash: string;
      skillRevision: string;
      mediaType: "text/markdown" | "text/plain";
    }
  | {
      status: "not-found";
      id: string;
      path: string;
      reason: "skill-not-found" | "file-not-found";
    };

export interface ManagedSkillRegistry {
  /** Discovery only. The caller owns authorization before returning records. */
  list(request?: SkillListRequest): Promise<SkillListResult>;
  /** The caller must authorize detail/body disclosure before exposing this result. */
  get(request: SkillGetRequest): Promise<SkillGetResult>;
  /** The caller must authorize definition-resolution disclosure before exposing this result. */
  resolve(request: SkillResolveRequest): Promise<SkillResolveResult>;
  /** The caller must authorize content disclosure before exposing this result. */
  read(request: SkillReadRequest): Promise<SkillReadResult>;
}

export interface FilesystemManagedSkillRegistryOptions {
  env: ScopeEnvironment;
  freshnessProbe?: SkillFreshnessProbe;
}
