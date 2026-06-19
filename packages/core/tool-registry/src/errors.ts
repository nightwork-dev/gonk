export class ToolError extends Error {
  readonly code: string;
  readonly details?: unknown;

  constructor(code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.details = details;
  }
}

export const ERROR_CODES = {
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  OUTPUT_INVALID: "OUTPUT_INVALID",
  ABORTED: "ABORTED",
  CYCLE: "CYCLE",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES] | (string & {});
