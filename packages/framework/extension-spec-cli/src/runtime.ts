import type { ScopeStore } from "@gonk/scope";
import type { ExtensionSpec } from "@gonk/extension-spec";
import { buildCommandHandler } from "@gonk/extension-spec-pi";
import { recordGonkExtension } from "@gonk/tool-registry-pi";

import type {
  CliRuntime,
  CliExtensionContext,
  CliHookHandler,
} from "./cli-types.ts";
import { makeCliSubcommandContext } from "./cli-context.ts";
import { runSettingsConfigPrompt } from "./settings-prompt.ts";
import type { SettingsConfigPromptOptions } from "./settings-prompt.ts";

export interface RegisterSpecCliOptions {
  /** The CLI host runtime (`@gonk/cli` satisfies this structurally). */
  cli: CliRuntime;
  /** Bound scope store. Tools, slash command, and config prompts all
   *  read/write through this. */
  scope: ScopeStore;
  /** Spec to materialize. */
  spec: ExtensionSpec;
  /** Optional override for picker-type prompts (model/provider/voice/custom).
   *  Forwarded to `runSettingsConfigPrompt` when the user runs `gonk <ext> config`. */
  editPickerType?: SettingsConfigPromptOptions["editPickerType"];
}

/** Materialize an ExtensionSpec into CLI subcommands + hook subscriptions.
 *
 *  Wires:
 *    - slash command → `cli.registerExtensionCommand` with auto-injected
 *      set/preset/config subcommands (via the spec framework's
 *      buildCommandHandler)
 *    - hooks → `cli.on(event, handler)` for each entry in spec.hooks
 *    - settings TUI → `runSettingsConfigPrompt` (interactive @inquirer/prompts)
 *
 *  Tools are NOT registered here — `@gonk/cli` registers them with the
 *  orchestrator separately via the tool-registry-cli adapter (so the same
 *  ToolDefinitions are exposed both as `gonk <tool-name>` and as agent tools
 *  in CLI output mode).
 *
 *  Returns a teardown function. The CLI host doesn't currently need symmetric
 *  unregister, but the function is reserved for future use. */
export function registerSpecExtensionCli(opts: RegisterSpecCliOptions): () => void {
  const { cli, scope, spec, editPickerType } = opts;

  // Parity with the Pi runtime: record this extension (and its capability
  // readiness) in the process-wide registry so introspection surfaces
  // (`harness_status`, `gonk doctor`) can report it. setupCli carries no
  // package name, so we key by spec id.
  recordGonkExtension({
    specId: spec.id,
    ...(spec.readiness !== undefined ? { readiness: spec.readiness } : {}),
  });

  // 1. Slash command — only registers if the spec declares one.
  if (spec.command) {
    const handler = buildCommandHandler(spec, {
      openTui: async (ctx) => {
        if (!spec.settings) return;
        const tier = spec.settings.defaultSetTier ?? "session";
        await runSettingsConfigPrompt({
          scope: ctx.scope,
          spec: spec.settings,
          tier,
          ...(editPickerType ? { editPickerType } : {}),
        });
      },
    });

    cli.registerExtensionCommand(spec.command.name, {
      description: spec.command.description,
      handler: async (rawArgs: string, cliCtx: CliExtensionContext) => {
        const subCtx = makeCliSubcommandContext(scope, cliCtx);
        await handler(rawArgs, subCtx);
      },
    });
  }

  // 2. Hooks
  if (spec.hooks) {
    for (const [event, hookHandler] of Object.entries(spec.hooks)) {
      const cliHandler: CliHookHandler = async (ev, _cliCtx) => {
        await hookHandler(ev, { scope });
      };
      cli.on(event, cliHandler);
    }
  }

  return () => {
    // Reserved for future symmetric teardown.
  };
}
