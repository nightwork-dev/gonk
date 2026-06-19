import type { ScopeName, ScopeStore } from "@gonk/scope";
import type { SettingsSpec, SettingsItem } from "@gonk/extension-spec";
import { input, select, confirm, number } from "@inquirer/prompts";
import {
  readSettingValue,
  writeSettingValue,
} from "@gonk/extension-spec-pi";

export interface SettingsConfigPromptOptions {
  scope: ScopeStore;
  spec: SettingsSpec;
  tier: ScopeName;
  /** Optional handler for non-prompt-able types (model/provider/voice/custom).
   *  Receives the item and tier, returns the new value or undefined to skip. */
  editPickerType?: (
    item: SettingsItem,
    tier: ScopeName,
    current: unknown,
  ) => Promise<unknown> | unknown;
}

/** Walk every setting in the spec and prompt the user with a type-appropriate
 *  inquirer widget. Writes accepted values to scope at the configured tier.
 *
 *  Picker types (model/provider/voice/custom) are skipped unless
 *  `editPickerType` is supplied — extensions that need them pass a callback
 *  that delegates to the same picker code their Pi runtime uses. */
export async function runSettingsConfigPrompt(
  opts: SettingsConfigPromptOptions,
): Promise<void> {
  const { scope, spec, tier, editPickerType } = opts;

  for (const section of spec.sections) {
    for (const item of section.items) {
      const current = readSettingValue<unknown>(scope, item);
      const value = await promptForItem(item, current, editPickerType, tier);
      if (value === undefined) continue;
      try {
        writeSettingValue(scope, item, value, tier);
      } catch (err) {
        process.stderr.write(
          `[error] ${item.label}: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      }
    }
  }
}

async function promptForItem(
  item: SettingsItem,
  current: unknown,
  editPickerType: SettingsConfigPromptOptions["editPickerType"] | undefined,
  tier: ScopeName,
): Promise<unknown | undefined> {
  const message = `${item.label}`;
  const t = item.type;

  switch (t.kind) {
    case "string":
    case "text": {
      const def = (current ?? item.default) as string | undefined;
      const v = await input({
        message,
        ...(def !== undefined ? { default: String(def) } : {}),
      });
      if (v === undefined) return undefined;
      const trimmed = String(v).trim();
      return trimmed.length === 0 ? undefined : trimmed;
    }

    case "boolean": {
      const def = (current ?? item.default ?? false) as boolean;
      const v = await confirm({ message, default: def });
      return v;
    }

    case "enum": {
      const choices = t.values.map((val) => ({ name: val, value: val }));
      const def = (current ?? item.default) as string | undefined;
      const opts: { message: string; choices: typeof choices; default?: string } = {
        message,
        choices,
      };
      if (def !== undefined) opts.default = String(def);
      const v = await select(opts);
      return v;
    }

    case "number": {
      const def = (current ?? item.default) as number | undefined;
      const opts: {
        message: string;
        default?: number;
        min?: number;
        max?: number;
      } = { message };
      if (def !== undefined) opts.default = Number(def);
      if (t.min !== undefined) opts.min = t.min;
      if (t.max !== undefined) opts.max = t.max;
      const v = await number(opts);
      return v;
    }

    case "model":
    case "provider":
    case "voice":
    case "custom": {
      if (editPickerType) {
        return await editPickerType(item, tier, current);
      }
      process.stderr.write(
        `[info] ${item.label}: skipped (type '${t.kind}' needs an editPickerType callback; pass one to runSettingsConfigPrompt to wire it up)\n`,
      );
      return undefined;
    }
  }
}
