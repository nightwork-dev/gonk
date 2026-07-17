import { createHash } from "node:crypto";
import type { AuthenticatedPrincipal } from "@gonk/auth";

import type {
  RetrievalFragmentRef,
  RetrievalResourceRef,
} from "./types.ts";

export function canonicalFragmentKey(fragment: RetrievalFragmentRef): string {
  if (fragment.kind === "range") {
    return stableJson([fragment.kind, fragment.id, fragment.start, fragment.end]);
  }
  return stableJson([fragment.kind, fragment.id]);
}

export function canonicalResourceKey(resource: RetrievalResourceRef): string {
  return stableJson([
    resource.sourceId,
    resource.kind,
    resource.id,
    resource.revision,
    resource.fragment === undefined ? null : JSON.parse(canonicalFragmentKey(resource.fragment)),
  ]);
}

export function canonicalAuthorityPartition(
  principal: AuthenticatedPrincipal
): string {
  return stableHash("retrieval-partition", {
    tenantId: principal.tenantId ?? null,
    workspaceId: principal.workspaceId ?? null,
  });
}

export function stableHash(prefix: string, value: unknown): string {
  return `${prefix}:v1:${createHash("sha256")
    .update(`${prefix}:v1\0`, "utf8")
    .update(stableJson(value), "utf8")
    .digest("base64url")}`;
}

export function stableJson(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortJson(record[key])])
  );
}
