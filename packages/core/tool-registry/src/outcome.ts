import type { Display, ToolEvent } from "./types.ts";

export type ToolOutcome =
  | { ok: true; data: unknown; display?: Display }
  | { ok: false; code: string; message: string; details?: unknown };

export interface CollectToolOutcomeOptions {
  onEvent?: (event: ToolEvent) => void | Promise<void>;
}

export async function collectToolOutcome(
  events: AsyncIterable<ToolEvent>,
  options: CollectToolOutcomeOptions = {}
): Promise<ToolOutcome> {
  let lastResult: { data: unknown; display?: Display } | undefined;
  let lastError:
    | { code: string; message: string; details?: unknown }
    | undefined;

  for await (const event of events) {
    await options.onEvent?.(event);
    if (event.type === "result") {
      lastResult = {
        data: event.data,
        ...(event.display === undefined ? {} : { display: event.display }),
      };
    } else if (event.type === "error") {
      lastError = {
        code: event.code,
        message: event.message,
        ...(event.details === undefined ? {} : { details: event.details }),
      };
    }
  }

  if (lastError) return { ok: false, ...lastError };
  if (lastResult) return { ok: true, ...lastResult };
  return {
    ok: false,
    code: "NO_RESULT",
    message: "Tool produced no result",
  };
}
