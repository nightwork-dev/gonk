import type { CodexHookPlacementPolicy } from "./types.ts";

/** Default portable-hook mapping. `session_start` includes Codex's `fork`
 *  and `compact` start sources. Turn hooks remain side-effect-only by default
 *  to preserve cache stability. */
export const defaultCodexHookPlacement: CodexHookPlacementPolicy = (input) => {
  switch (input.specEvent) {
    case "session_start": {
      const placement = {
        kind: "boundary-context",
        event: "SessionStart",
        matcher: "startup|resume|clear|compact|fork",
      } as const;
      return [{ ...placement, command: input.dispatchCommand(placement) }];
    }
    case "before_provider_request": {
      const placement = { kind: "side-effect", event: "UserPromptSubmit" } as const;
      return [{ ...placement, command: input.dispatchCommand(placement) }];
    }
    case "turn_complete": {
      const placement = { kind: "side-effect", event: "Stop" } as const;
      return [{ ...placement, command: input.dispatchCommand(placement) }];
    }
    default:
      return [];
  }
};
