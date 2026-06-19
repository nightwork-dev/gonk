export { parseSubcommandArgs, stripVerb } from "./parse-args.ts";

export {
  deleteKeyedSetting,
  readKeyedSetting,
  resolveKeyedIndex,
  writeKeyedSetting,
} from "./keyed-by.ts";

export {
  applyPreset,
  deletePreset,
  readPresetCatalog,
  runPresetSubcommand,
  savePreset,
  snapshotPreset,
} from "./presets.ts";
export type { PresetCatalog, PresetSnapshot } from "./presets.ts";

export {
  clearSettingValue,
  coerceSettingValue,
  cycleValue,
  findItem,
  isCyclable,
  readSettingValue,
  renderSettingsStatus,
  runSetSubcommand,
  writeSettingValue,
} from "./settings.ts";

export { buildCommandHandler } from "./command.ts";

export {
  captureProjectTrust,
  readProjectTrustApprove,
  PROJECT_TRUST_SCOPE_KEY,
} from "./project-trust.ts";

export {
  SettingsTuiComponent,
  type SettingsTuiAction,
  type SettingsTuiKb,
  type SettingsTuiOptions,
} from "./settings-tui.ts";

export {
  EntityListTuiBase,
  type EntityListTuiOptions,
} from "./entity-list-tui.ts";

export {
  VerbPickerTuiComponent,
  type Verb,
  type PiTuiHostHooks,
  type VerbPickerTuiOptions,
} from "./verb-picker-tui.ts";

export {
  defaultEditFlow,
  registerSpecExtension,
  type EditFlowHandler,
  type PiSubcommandContext,
  type RegisterSpecOptions,
  type TuiDeps,
} from "./runtime.ts";

export type {
  NotifyLevel,
  PiBeforeAgentStartEvent,
  PiBeforeAgentStartResult,
  PiCommandOptions,
  PiExtensionAPI,
  PiExtensionContext,
  PiExtensionMode,
  PiHookHandler,
  PiTheme,
  PiTuiComponent,
  PiUI,
} from "./pi-types.ts";
export { isInteractiveMode } from "./pi-types.ts";

export { probePiModel } from "./probe-model.ts";
export type { PiModelProbe } from "./probe-model.ts";
