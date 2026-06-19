export type {
  CliRuntime,
  CliCommandOptions,
  CliHookHandler,
  CliExtensionContext,
  CliSubcommandContext,
  NotifyLevel,
} from "./cli-types.ts";

export { makeCliSubcommandContext } from "./cli-context.ts";
export { argvToRawArgs } from "./dispatch.ts";
export { runSettingsConfigPrompt } from "./settings-prompt.ts";
export type { SettingsConfigPromptOptions } from "./settings-prompt.ts";
export { registerSpecExtensionCli } from "./runtime.ts";
export type { RegisterSpecCliOptions } from "./runtime.ts";

export const PACKAGE_VERSION = "0.0.8";
