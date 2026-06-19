import type {
  ClaudeHookCommand,
  ClaudeHookEvent,
  CommandFrontmatter,
  CommandPlacementInput,
  CommandPlacementPolicy,
  CommandPlacementResult,
  HookPlacementInput,
  HookPlacementPolicy,
} from "./types.ts";

// =============================================================================
// Default command placement
// =============================================================================

/** Default mapping from `<SlashCommandSpec, verb>` to a Claude command file.
 *
 *  Rules:
 *    - Bare command (`verb === null`): `commands/<name>.md` whose body lists
 *      the available verbs. Claude reads this as "ask the user which verb."
 *    - Subcommand verb: `commands/<name>-<verb>.md` whose body instructs
 *      Claude to perform the verb's task using `$ARGUMENTS`.
 *
 *  This is intentionally a string-template translation — the original verb
 *  handler is a TS function that the model cannot run. The materialized
 *  command body is a prompt that tells Claude *what to do* in the verb's
 *  stead (typically: call an MCP tool that future PRs will register). */
export const defaultCommandPlacement: CommandPlacementPolicy = (input) => {
  const { command, verb, subcommand } = input;
  if (verb === null) return bareCommandFile(command);
  if (!subcommand) return "drop";
  return verbCommandFile(command.name, verb, subcommand);
};

function bareCommandFile(command: CommandPlacementInput["command"]): CommandPlacementResult {
  const verbs = Object.entries(command.subcommands ?? {})
    .filter(([, sub]) => sub.requires?.() !== false)
    .map(([verb, sub]) => `- \`/${command.name} ${verb}\` — ${sub.description}`);

  const body = [
    `# /${command.name}`,
    "",
    command.description,
    "",
    verbs.length > 0 ? "## Available verbs" : "## No verbs available",
    "",
    ...(verbs.length > 0 ? verbs : ["(this command exposes no subcommands)"]),
    "",
    "Ask the user which verb to run, then invoke it as a follow-up.",
    "",
  ].join("\n");

  const frontmatter: CommandFrontmatter = {
    description: command.description,
  };

  return {
    filename: `${command.name}.md`,
    body,
    frontmatter,
  };
}

function verbCommandFile(
  commandName: string,
  verb: string,
  subcommand: NonNullable<CommandPlacementInput["subcommand"]>,
): CommandPlacementResult {
  if (subcommand.requires?.() === false) return "drop";

  const positionalHint = (subcommand.positional ?? [])
    .map((p) => (p.required === false ? `[${p.name}]` : `<${p.name}>`))
    .join(" ");

  const body = [
    `# /${commandName} ${verb}`,
    "",
    subcommand.description,
    "",
    "## Task",
    "",
    `Perform the \`${verb}\` action for the \`${commandName}\` domain using the`,
    "following arguments verbatim:",
    "",
    "```text",
    "$ARGUMENTS",
    "```",
    "",
    "Use the appropriate MCP tool from this domain when available; otherwise",
    "report what you would have done and prompt the user to install the",
    `\`${commandName}\` MCP server.`,
    "",
  ].join("\n");

  const frontmatter: CommandFrontmatter = {
    description: subcommand.description,
  };
  if (positionalHint) frontmatter["argument-hint"] = positionalHint;

  return {
    filename: `${commandName}-${verb}.md`,
    body,
    frontmatter,
  };
}

// =============================================================================
// Default hook placement
// =============================================================================

/** Mapping table from spec-side hook event names to Claude hook events. The
 *  defaults follow the design doc's "Mapping table" §Claude family. Spec
 *  events outside this table are dropped with a warning surface (caller
 *  can override via `HookPlacementPolicy`). */
const SPEC_TO_CLAUDE_EVENTS: Record<string, ClaudeHookEvent[]> = {
  session_start: ["SessionStart"],
  session_end: ["SessionEnd"],
  turn_complete: ["Stop"],
  before_provider_request: ["UserPromptSubmit"],
};

export const defaultHookPlacement: HookPlacementPolicy = (input) => {
  const targets = SPEC_TO_CLAUDE_EVENTS[input.specEvent];
  if (!targets || targets.length === 0) return [];
  const command = buildDispatchCommand(input);
  return targets.map((event) => ({ event, command }));
};

function buildDispatchCommand(input: HookPlacementInput): ClaudeHookCommand {
  // The dispatch shim receives <specId> <specEvent> and the Claude hook
  // payload via stdin. PR 1 only writes the line; PR 2 ships the binary.
  return {
    type: "command",
    command: `${input.dispatchBinary} ${input.specId} ${input.specEvent}`,
    timeout: 5,
  };
}
