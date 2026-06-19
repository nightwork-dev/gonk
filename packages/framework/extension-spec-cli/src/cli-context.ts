import type { ScopeStore } from "@gonk/scope";
import type { CliExtensionContext, CliSubcommandContext, NotifyLevel } from "./cli-types.ts";

/** Build the per-invocation SubcommandContext from a CLI io context. The
 *  spec framework drives all subcommand handlers through `SubcommandContext`
 *  so wiring is symmetric with `@gonk/extension-spec-pi`. */
export function makeCliSubcommandContext(
  scope: ScopeStore,
  cliCtx: CliExtensionContext,
): CliSubcommandContext {
  return {
    scope,
    hasUI: cliCtx.hasUI,
    notify: (message: string, level: NotifyLevel = "info") => {
      cliCtx.stderr.write(`[${level}] ${message}\n`);
    },
    host: { cliCtx },
  };
}
