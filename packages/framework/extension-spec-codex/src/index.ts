export {
  materializeCodexPlugin,
  pluginPath,
  readMaterializationManifest,
  unmaterializeCodexPlugin,
} from "./materialize.ts";

export { defaultCodexHookPlacement } from "./placement.ts";
export {
  dispatchCodexHook,
  MAX_BOUNDARY_CONTEXT_CHARS,
  runCodexHook,
} from "./run-hook.ts";

export type {
  CodexPluginInterface,
  CodexPluginManifest,
  CodexActionContextEvent,
  CodexActionContextHookPlacement,
  CodexBoundaryHookPlacement,
  CodexHookCommand,
  CodexHookEvent,
  CodexHookMatcher,
  CodexHookPlacement,
  CodexHookPlacementAuthorization,
  CodexHookPlacementInput,
  CodexHookPlacementPolicy,
  CodexHooksFile,
  CodexSideEffectHookPlacement,
  CodexSkill,
  MaterializationManifest,
  MaterializeCodexOptions,
  McpServerEntry,
  SkillPlacementInput,
  SkillPlacementPolicy,
  SkillPlacementResult,
} from "./types.ts";

export type {
  CodexActionContextHookContext,
  CodexActionContextHookOutput,
  CodexBoundaryHookContext,
  CodexBoundaryHookOutput,
  CodexHookOutput,
  CodexSideEffectHookContext,
} from "./run-hook.ts";

export { CODEX_HOST_PROFILE } from "./host-profile.ts";
