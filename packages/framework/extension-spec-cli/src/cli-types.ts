import type { ScopeStore } from "@gonk/scope";
import type { SubcommandContext } from "@gonk/extension-spec";

export type NotifyLevel = "info" | "error" | "warn";

/** Minimum surface a CLI host must expose for the spec runtime to wire itself
 *  in. `@gonk/cli` satisfies this structurally. */
export interface CliRuntime {
  /** Register a top-level extension command group. The CLI dispatches
   *  `gonk <name> <verb> ...` to this entry. */
  registerExtensionCommand(name: string, options: CliCommandOptions): void;

  /** Subscribe to lifecycle events. CLI emits `session_start` after all
   *  extensions register, `session_end` on process exit. `turn_complete` is
   *  never emitted (CLI has no per-turn lifecycle). */
  on(event: string, handler: CliHookHandler): void;

  /** Optional sink for spec.tools — when present, the host registers tools
   *  alongside extension commands so the agent surface is exposed both as
   *  CLI subcommands and orchestrator-side tools. */
  registerTool?(tool: import("@gonk/tool-registry").ToolDefinition): void;
}

export interface CliCommandOptions {
  description: string;
  /** Receives the verb + remaining args as a raw string (verb prefixed) and a
   *  CLI ExtensionContext. Implementation reconstructs the rawArgs format the
   *  spec framework expects. */
  handler: (rawArgs: string, ctx: CliExtensionContext) => Promise<void> | void;
}

/** Handler for CLI lifecycle events (session_start / session_end). */
export type CliHookHandler = (event: unknown, ctx: CliExtensionContext) => Promise<void> | void;

/** The per-invocation host context. Built by `@gonk/cli` for each command
 *  dispatch and passed to `registerSpecExtensionCli` handlers via
 *  `CliSubcommandContext.host.cliCtx`. */
export interface CliExtensionContext {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  /** True when stdout is a TTY (i.e. interactive prompts are usable). */
  hasUI: boolean;
  cwd: string;
  env: Readonly<Record<string, string | undefined>>;
}

/** CLI-narrowed SubcommandContext. Verb handlers can declare this as their
 *  ctx parameter type to access stdout/stderr/cwd/env directly. */
export interface CliSubcommandContext extends SubcommandContext {
  scope: ScopeStore;
  host: {
    cliCtx: CliExtensionContext;
  };
}
