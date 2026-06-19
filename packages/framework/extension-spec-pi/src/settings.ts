import type { ScopeName, ScopeStore } from "@gonk/scope";
import type {
  SettingsItem,
  SettingsItemType,
  SettingsSpec,
  SubcommandContext,
} from "@gonk/extension-spec";

import {
  deleteKeyedSetting,
  readKeyedSetting,
  writeKeyedSetting,
} from "./keyed-by.ts";

/** Read a setting's value (honoring keyedBy). Returns undefined when the
 *  scope has no value — caller falls back to `item.default`. */
export function readSettingValue<T = unknown>(
  scope: ScopeStore,
  item: SettingsItem,
): T | undefined {
  return readKeyedSetting<T>(scope, item.key, item.keyedBy);
}

/** Coerce a raw string from `set <key> <value>` into the item's declared
 *  type. Throws on invalid input so the caller can surface the error. */
export function coerceSettingValue(item: SettingsItem, raw: string): unknown {
  switch (item.type.kind) {
    case "string":
    case "text":
    case "model":
    case "provider":
    case "voice":
      return raw;

    case "boolean": {
      const t = raw.toLowerCase();
      if (t === "true" || t === "1" || t === "yes") return true;
      if (t === "false" || t === "0" || t === "no") return false;
      throw new Error(`Not a boolean: ${raw}`);
    }

    case "number": {
      const n = Number.parseFloat(raw);
      if (Number.isNaN(n)) throw new Error(`Not a number: ${raw}`);
      if (item.type.min !== undefined && n < item.type.min) {
        throw new Error(`Below minimum (${item.type.min}): ${raw}`);
      }
      if (item.type.max !== undefined && n > item.type.max) {
        throw new Error(`Above maximum (${item.type.max}): ${raw}`);
      }
      return n;
    }

    case "enum": {
      const values = item.type.values;
      if (!values.includes(raw)) {
        throw new Error(
          `Not one of [${values.join(", ")}]: ${raw}`,
        );
      }
      return raw;
    }

    case "custom":
      return raw;
  }
}

/** Write a setting's value (honoring keyedBy). Validation is the caller's
 *  responsibility — pass through `coerceSettingValue` first. */
export function writeSettingValue(
  scope: ScopeStore,
  item: SettingsItem,
  value: unknown,
  tier: ScopeName,
): void {
  writeKeyedSetting(scope, item.key, value, tier, item.keyedBy);
}

/** Clear a setting's value (honoring keyedBy). */
export function clearSettingValue(
  scope: ScopeStore,
  item: SettingsItem,
  tier: ScopeName,
): void {
  deleteKeyedSetting(scope, item.key, tier, item.keyedBy);
}

/** Find the item that matches a `set <key>` argument. Accepts either a bare
 *  key (auto-prefixed with `spec.scopeKeyPrefix`) or a fully-qualified key. */
export function findItem(
  spec: SettingsSpec,
  rawKey: string,
): SettingsItem | undefined {
  const fullKey = rawKey.startsWith(`${spec.scopeKeyPrefix}.`)
    ? rawKey
    : `${spec.scopeKeyPrefix}.${rawKey}`;
  for (const section of spec.sections) {
    for (const item of section.items) {
      if (item.key === fullKey) return item;
    }
  }
  return undefined;
}

/** Drive the standard `set <key> <value> [tier]` subcommand. Returns true
 *  when handled (always, with success or recognized error). */
export function runSetSubcommand(
  args: { positional: string[]; raw: string },
  ctx: SubcommandContext,
  spec: SettingsSpec,
): boolean {
  const positional = args.positional;
  const key = positional[0];
  if (!key || positional.length < 2) {
    ctx.notify(
      `Usage: set <key> <value> [tier]\nKnown keys: ${listItemKeys(spec)}`,
      "error",
    );
    return true;
  }

  const item = findItem(spec, key);
  if (!item) {
    ctx.notify(
      `Unknown setting: ${key}. Known keys: ${listItemKeys(spec)}`,
      "error",
    );
    return true;
  }

  const tiers: ScopeName[] = ["session", "directory", "project", "persona", "global"];
  const last = positional[positional.length - 1];
  const tier: ScopeName =
    last && tiers.includes(last as ScopeName)
      ? (last as ScopeName)
      : (spec.defaultSetTier ?? "session");

  const valueParts =
    last === tier ? positional.slice(1, -1) : positional.slice(1);
  const rawValue = valueParts.join(" ");

  if (rawValue === "" || rawValue === "clear") {
    try {
      clearSettingValue(ctx.scope, item, tier);
      ctx.notify(`${item.label} cleared @ ${tier}`, "info");
    } catch (err) {
      ctx.notify(messageOf(err), "error");
    }
    return true;
  }

  let coerced: unknown;
  try {
    coerced = coerceSettingValue(item, rawValue);
  } catch (err) {
    ctx.notify(messageOf(err), "error");
    return true;
  }

  try {
    writeSettingValue(ctx.scope, item, coerced, tier);
    ctx.notify(
      `${item.label} = ${JSON.stringify(coerced)} @ ${tier}`,
      "info",
    );
  } catch (err) {
    ctx.notify(messageOf(err), "error");
  }
  return true;
}

function listItemKeys(spec: SettingsSpec): string {
  const keys: string[] = [];
  for (const section of spec.sections) {
    for (const item of section.items) {
      const short = item.key.slice(spec.scopeKeyPrefix.length + 1);
      keys.push(short);
    }
  }
  return keys.join(", ");
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Render a one-line plain-text status of the entire settings catalog.
 *  Used by the `noArgs: "status"` mode and as a fallback when `hasUI` is
 *  false. */
export function renderSettingsStatus(
  scope: ScopeStore,
  spec: SettingsSpec,
): string {
  const lines: string[] = [];
  for (const section of spec.sections) {
    if (spec.sections.length > 1) {
      lines.push(`-- ${section.label} --`);
    }
    const labelWidth = Math.max(...section.items.map((i) => i.label.length)) + 2;
    for (const item of section.items) {
      const v = readSettingValue(scope, item);
      const display =
        v === undefined ? `(default: ${formatDefault(item.default)})` : formatValue(v);
      const indexHint = item.keyedBy
        ? ` [for: ${describeKeyedIndex(scope, item)}]`
        : "";
      lines.push(`${(item.label + ":").padEnd(labelWidth)}${display}${indexHint}`);
    }
    if (spec.sections.length > 1) lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function describeKeyedIndex(scope: ScopeStore, item: SettingsItem): string {
  if (!item.keyedBy) return "";
  if (typeof item.keyedBy.source === "function") {
    return item.keyedBy.source(scope) ?? "(none)";
  }
  return scope.get<string>(item.keyedBy.source) ?? "(none)";
}

function formatDefault(d: unknown): string {
  if (d === undefined) return "(unset)";
  return formatValue(d);
}

function formatValue(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Helper that the TUI uses to know whether a value type can be cycled
 *  in-place (Enter / arrow keys) vs needs an external picker / editor. */
export function isCyclable(type: SettingsItemType): boolean {
  return type.kind === "enum" || type.kind === "boolean";
}

/** Cycle to the next value for a cyclable type. Direction +1 / -1. Returns
 *  the new value, or undefined if the type can't be cycled. */
export function cycleValue(
  type: SettingsItemType,
  current: unknown,
  direction: 1 | -1,
): unknown {
  if (type.kind === "boolean") return !current;
  if (type.kind === "enum") {
    const values = type.values;
    const idx = values.indexOf(String(current));
    const nextIdx = (idx + direction + values.length) % values.length;
    return values[nextIdx];
  }
  return undefined;
}
