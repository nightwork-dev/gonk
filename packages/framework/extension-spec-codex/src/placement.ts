import type {
  CodexHookCommand,
  CodexHookPlacement,
  CodexHookPlacementInput,
  CodexHookPlacementPolicy,
} from "./types.ts";

/** Default portable-hook mapping. `session_start` includes Codex's `compact`
 *  start source, which is the supported post-compaction reinjection boundary.
 *  Turn hooks remain side-effect-only even where Codex itself could accept
 *  `additionalContext`; this preserves the prompt-cache prefix. */
export const defaultCodexHookPlacement: CodexHookPlacementPolicy = (input) => {
  const command = buildDispatchCommand(input);
  switch (input.specEvent) {
    case "session_start":
      return [{
        kind: "boundary-context",
        event: "SessionStart",
        matcher: "startup|resume|clear|compact",
        command,
      }];
    case "before_provider_request":
      return [{ kind: "side-effect", event: "UserPromptSubmit", command }];
    case "turn_complete":
      return [{ kind: "side-effect", event: "Stop", command }];
    default:
      return [];
  }
};

function buildDispatchCommand(input: CodexHookPlacementInput): CodexHookCommand {
  return {
    type: "command",
    command: `${input.dispatchBinary} ${input.specId} ${input.specEvent}`,
    timeout: 5,
  };
}
