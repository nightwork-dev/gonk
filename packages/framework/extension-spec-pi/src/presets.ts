import type { ScopeName, ScopeStore } from "@gonk/scope";
import type { PresetField, PresetsSpec, SubcommandContext } from "@gonk/extension-spec";

/** A preset is a snapshot of selected scope keys, stored as a plain object
 *  whose field names come from `PresetField.field`. */
export type PresetSnapshot = Record<string, unknown>;

/** All saved presets for an extension, keyed by user-chosen name. */
export type PresetCatalog = Record<string, PresetSnapshot>;

/** Read every preset field from scope and return as a snapshot.
 *  Fields that are unset in scope are omitted from the snapshot (so apply
 *  only re-asserts what was actually set). */
export function snapshotPreset(
  scope: ScopeStore,
  fields: readonly PresetField[],
): PresetSnapshot {
  const out: PresetSnapshot = {};
  for (const f of fields) {
    const v = scope.get<unknown>(f.scopeKey);
    if (v !== undefined) out[f.field] = v;
  }
  return out;
}

/** Apply a preset back to scope. Fields the preset doesn't include are
 *  cleared at the target tier (so applying a preset is a full-replace, not
 *  a merge). */
export function applyPreset(
  scope: ScopeStore,
  preset: PresetSnapshot,
  fields: readonly PresetField[],
  tier: ScopeName,
): void {
  for (const f of fields) {
    const v = preset[f.field];
    if (v === undefined) {
      scope.delete(f.scopeKey, tier);
    } else {
      scope.set(f.scopeKey, v, tier);
    }
  }
}

/** Read the catalog of saved presets from scope. */
export function readPresetCatalog(
  scope: ScopeStore,
  spec: PresetsSpec,
): PresetCatalog {
  return scope.get<PresetCatalog>(spec.scopeKey) ?? {};
}

/** Save a named preset (replaces existing if name already present). */
export function savePreset(
  scope: ScopeStore,
  spec: PresetsSpec,
  name: string,
  snapshot: PresetSnapshot,
): void {
  const tier = spec.saveTier ?? "global";
  const current = readPresetCatalog(scope, spec);
  const next = { ...current, [name]: snapshot };
  scope.set(spec.scopeKey, next, tier);
}

/** Delete a named preset. No-op if the name doesn't exist. */
export function deletePreset(
  scope: ScopeStore,
  spec: PresetsSpec,
  name: string,
): void {
  const tier = spec.saveTier ?? "global";
  const current = readPresetCatalog(scope, spec);
  if (!(name in current)) return;
  const { [name]: _drop, ...rest } = current;
  void _drop;
  scope.set(spec.scopeKey, rest, tier);
}

/** Drive the standard `preset list|save|apply|delete` subcommand from a
 *  parsed-args + context pair. Used by the auto-generated `preset`
 *  subcommand and surfacable to user-defined custom flows.
 *
 *  Returns true when the action was recognized and handled. */
export async function runPresetSubcommand(
  args: { positional: string[] },
  ctx: SubcommandContext,
  spec: PresetsSpec,
): Promise<boolean> {
  const action = args.positional[0];
  const presets = readPresetCatalog(ctx.scope, spec);

  if (!action || action === "list") {
    const names = Object.keys(presets).sort();
    ctx.notify(
      names.length
        ? `Presets:\n  ${names.join("\n  ")}`
        : `No presets. Save one with 'preset save <name>'.`,
      "info",
    );
    return true;
  }

  if (action === "save") {
    const name = args.positional[1];
    if (!name) {
      ctx.notify("Usage: preset save <name>", "error");
      return true;
    }
    const snapshot = snapshotPreset(ctx.scope, spec.fields);
    savePreset(ctx.scope, spec, name, snapshot);
    ctx.notify(
      `Saved preset '${name}' (${spec.saveTier ?? "global"})`,
      "info",
    );
    return true;
  }

  if (action === "apply") {
    const name = args.positional[1];
    if (!name) {
      ctx.notify("Usage: preset apply <name>", "error");
      return true;
    }
    const preset = presets[name];
    if (!preset) {
      ctx.notify(`Preset not found: ${name}`, "error");
      return true;
    }
    const tier = spec.applyTier ?? "session";
    applyPreset(ctx.scope, preset, spec.fields, tier);
    ctx.notify(`Applied preset '${name}' (${tier})`, "info");
    return true;
  }

  if (action === "delete") {
    const name = args.positional[1];
    if (!name) {
      ctx.notify("Usage: preset delete <name>", "error");
      return true;
    }
    if (!(name in presets)) {
      ctx.notify(`Preset not found: ${name}`, "error");
      return true;
    }
    deletePreset(ctx.scope, spec, name);
    ctx.notify(`Deleted preset '${name}'`, "info");
    return true;
  }

  ctx.notify(
    `Unknown preset action: ${action}. Try: list, save <name>, apply <name>, delete <name>`,
    "error",
  );
  return true;
}
