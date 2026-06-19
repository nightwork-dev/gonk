import type { ScopeName, ScopeStore } from "@gonk/scope";
import type { KeyedByConfig } from "@gonk/extension-spec";

/** Resolve the index value from a KeyedByConfig.source — accepts either a
 *  bare scope key (looked up via scope.get) or a function (called with the
 *  scope). Returns undefined when the source produces no value. */
export function resolveKeyedIndex(
  scope: ScopeStore,
  source: KeyedByConfig["source"],
): string | undefined {
  if (typeof source === "function") return source(scope);
  return scope.get<string>(source);
}

/** Read a setting value, honoring an optional KeyedByConfig.
 *  - Without keyedBy: returns scope.get(key)
 *  - With keyedBy: returns scope.get(mapKey)?.[indexFromSource]
 *
 *  When the keyedBy index is missing or the map has no entry for it, returns
 *  undefined (caller falls back to the item's `default`). */
export function readKeyedSetting<T = unknown>(
  scope: ScopeStore,
  key: string,
  keyedBy: KeyedByConfig | undefined,
): T | undefined {
  if (!keyedBy) return scope.get<T>(key);
  const idx = resolveKeyedIndex(scope, keyedBy.source);
  if (!idx) return undefined;
  const map = scope.get<Record<string, T>>(keyedBy.mapKey);
  return map?.[idx];
}

/** Write a setting value, honoring an optional KeyedByConfig.
 *  - Without keyedBy: scope.set(key, value, tier)
 *  - With keyedBy: merges `{ [index]: value }` into the existing map at mapKey
 *    and writes the merged map back at `keyedBy.writeTier ?? tier`.
 *
 *  Throws when keyedBy is set but the index can't be resolved — the caller
 *  must surface this to the user (the TUI does so via a notify message). */
export function writeKeyedSetting(
  scope: ScopeStore,
  key: string,
  value: unknown,
  tier: ScopeName,
  keyedBy: KeyedByConfig | undefined,
): void {
  if (!keyedBy) {
    scope.set(key, value, tier);
    return;
  }
  const idx = resolveKeyedIndex(scope, keyedBy.source);
  if (!idx) {
    throw new Error(
      `Cannot write keyed setting '${key}': index source resolved to undefined.`,
    );
  }
  const writeTier = keyedBy.writeTier ?? tier;
  const map = scope.get<Record<string, unknown>>(keyedBy.mapKey) ?? {};
  const next = { ...map, [idx]: value };
  scope.set(keyedBy.mapKey, next, writeTier);
}

/** Delete a setting value, honoring an optional KeyedByConfig.
 *  - Without keyedBy: scope.delete(key, tier)
 *  - With keyedBy: removes the entry at `[index]` from the map at mapKey and
 *    writes the trimmed map back. If the map becomes empty, it is fully
 *    deleted instead of being persisted as `{}`. */
export function deleteKeyedSetting(
  scope: ScopeStore,
  key: string,
  tier: ScopeName,
  keyedBy: KeyedByConfig | undefined,
): void {
  if (!keyedBy) {
    scope.delete(key, tier);
    return;
  }
  const idx = resolveKeyedIndex(scope, keyedBy.source);
  if (!idx) return;
  const writeTier = keyedBy.writeTier ?? tier;
  const map = scope.get<Record<string, unknown>>(keyedBy.mapKey);
  if (!map || !(idx in map)) return;
  const { [idx]: _drop, ...rest } = map;
  void _drop;
  if (Object.keys(rest).length === 0) {
    scope.delete(keyedBy.mapKey, writeTier);
  } else {
    scope.set(keyedBy.mapKey, rest, writeTier);
  }
}
