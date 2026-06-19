export {
  materializeClaudePlugin,
  pluginPath,
  readMaterializationManifest,
  unmaterializeClaudePlugin,
} from "./materialize.ts";

export { defaultCommandPlacement, defaultHookPlacement } from "./placement.ts";

export { runClaudeHook } from "./run-hook.ts";
export type { ClaudeHookContext, ClaudeHookOutput } from "./run-hook.ts";

export type {
  ClaudeHookCommand,
  ClaudeHookEvent,
  ClaudeHookMatcher,
  ClaudeHooksFile,
  ClaudePluginManifest,
  CommandFrontmatter,
  CommandPlacementInput,
  CommandPlacementPolicy,
  CommandPlacementResult,
  HookPlacementInput,
  HookPlacementPolicy,
  MaterializationManifest,
  MaterializeClaudeOptions,
  McpServerEntry,
  SpecHookEvent,
} from "./types.ts";
