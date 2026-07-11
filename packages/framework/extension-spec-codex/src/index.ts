export {
  materializeCodexPlugin,
  pluginPath,
  readMaterializationManifest,
  unmaterializeCodexPlugin,
} from "./materialize.ts";

export { defaultCodexHookPlacement } from "./placement.ts";
export { MAX_BOUNDARY_CONTEXT_CHARS, runCodexHook } from "./run-hook.ts";

export type {
  CodexPluginInterface,
  CodexPluginManifest,
  CodexBoundaryHookPlacement,
  CodexHookCommand,
  CodexHookEvent,
  CodexHookMatcher,
  CodexHookPlacement,
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
  CodexBoundaryHookContext,
  CodexBoundaryHookOutput,
  CodexHookOutput,
  CodexSideEffectHookContext,
} from "./run-hook.ts";
