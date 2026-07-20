import {
  ToolError,
  shape,
  type ToolDefinition,
} from "@gonk/tool-registry";

export interface GitHubIssuesOptions {
  owner: string;
  repository: string;
  resolveToken(): string | Promise<string>;
  fetch?: typeof globalThis.fetch;
  apiBase?: string;
  timeoutMs?: number;
}

export interface GitHubIssueResult {
  number: number;
  title: string;
  state: "open" | "closed";
  url: string;
  body: string | null;
}

export interface GitHubCommentResult {
  id: number;
  issueNumber: number;
  url: string;
  body: string;
}

const issueInput = shape<{ number: number }>(
  (value): value is { number: number } =>
    isRecord(value) &&
    typeof value.number === "number" &&
    Number.isInteger(value.number) &&
    value.number > 0,
  "expected a positive integer issue number",
  {
    type: "object",
    properties: { number: { type: "integer", minimum: 1 } },
    required: ["number"],
    additionalProperties: false,
  }
);

const commentInput = shape<{ number: number; body: string }>(
  (value): value is { number: number; body: string } =>
    isRecord(value) &&
    typeof value.number === "number" &&
    Number.isInteger(value.number) &&
    value.number > 0 &&
    typeof value.body === "string" &&
    value.body.trim().length > 0,
  "expected a positive issue number and non-empty comment body",
  {
    type: "object",
    properties: {
      number: { type: "integer", minimum: 1 },
      body: { type: "string", minLength: 1 },
    },
    required: ["number", "body"],
    additionalProperties: false,
  }
);

const issueOutput = shape<GitHubIssueResult>(
  isGitHubIssueResult,
  "GitHub returned an invalid issue",
  {
    type: "object",
    properties: {
      number: { type: "integer" },
      title: { type: "string" },
      state: { type: "string", enum: ["open", "closed"] },
      url: { type: "string" },
      body: { type: ["string", "null"] },
    },
    required: ["number", "title", "state", "url", "body"],
    additionalProperties: false,
  }
);

const commentOutput = shape<GitHubCommentResult>(
  isGitHubCommentResult,
  "GitHub returned an invalid comment",
  {
    type: "object",
    properties: {
      id: { type: "integer" },
      issueNumber: { type: "integer" },
      url: { type: "string" },
      body: { type: "string" },
    },
    required: ["id", "issueNumber", "url", "body"],
    additionalProperties: false,
  }
);

export function createGitHubIssueTools(
  options: GitHubIssuesOptions
): [
  ToolDefinition<{ number: number }, GitHubIssueResult>,
  ToolDefinition<{ number: number; body: string }, GitHubCommentResult>,
] {
  const request = createGitHubRequest(options);

  return [
    {
      name: "github-issue-read",
      description: `Read an issue from ${options.owner}/${options.repository}`,
      category: "github",
      approval: "read",
      authorization: { requiredRole: "github-reader" },
      capabilities: { network: true, idempotent: true },
      input: issueInput,
      output: issueOutput,
      validateOutput: "strict",
      handler: async ({ number }, ctx) => {
        const raw = await request(
          `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repository)}/issues/${number}`,
          { method: "GET", signal: ctx.signal }
        );
        if (!isGitHubIssue(raw)) {
          throw new ToolError(
            "GITHUB_RESPONSE_INVALID",
            "GitHub returned an invalid issue response"
          );
        }
        return {
          data: {
            number: raw.number,
            title: raw.title,
            state: raw.state,
            url: raw.html_url,
            body: raw.body,
          },
        };
      },
    },
    {
      name: "github-issue-comment",
      description: `Add a comment to an issue in ${options.owner}/${options.repository}`,
      category: "github",
      approval: {
        tier: "write",
        reason: "Creates a durable GitHub issue comment",
      },
      authorization: { requiredRole: "github-writer" },
      capabilities: { network: true },
      input: commentInput,
      output: commentOutput,
      validateOutput: "strict",
      handler: async ({ number, body }, ctx) => {
        const raw = await request(
          `/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repository)}/issues/${number}/comments`,
          {
            method: "POST",
            signal: ctx.signal,
            body: JSON.stringify({ body }),
          }
        );
        if (!isGitHubComment(raw)) {
          throw new ToolError(
            "GITHUB_RESPONSE_INVALID",
            "GitHub returned an invalid comment response"
          );
        }
        return {
          data: {
            id: raw.id,
            issueNumber: number,
            url: raw.html_url,
            body: raw.body,
          },
        };
      },
    },
  ];
}

function createGitHubRequest(options: GitHubIssuesOptions) {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const apiBase = options.apiBase ?? "https://api.github.com";
  const timeoutMs = options.timeoutMs ?? 15_000;

  return async function request(
    path: string,
    init: { method: "GET" | "POST"; signal: AbortSignal; body?: string }
  ): Promise<unknown> {
    const token = await options.resolveToken();
    if (!token) throw new ToolError("GITHUB_CREDENTIAL_MISSING", "GitHub token is not configured");
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = AbortSignal.any([init.signal, timeout]);
    let response: Response;
    try {
      response = await fetchImpl(new URL(path, apiBase), {
        method: init.method,
        signal,
        redirect: "error",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "X-GitHub-Api-Version": "2022-11-28",
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: init.body }),
      });
    } catch (error) {
      if (init.signal.aborted) {
        throw new ToolError("GITHUB_CANCELLED", "GitHub request was cancelled");
      }
      if (timeout.aborted) {
        throw new ToolError("GITHUB_TIMEOUT", "GitHub request timed out");
      }
      throw new ToolError(
        "GITHUB_TRANSPORT_ERROR",
        "GitHub request failed",
        error instanceof Error ? { name: error.name, message: error.message } : undefined
      );
    }

    const value = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new ToolError(
        "GITHUB_HTTP_ERROR",
        `GitHub request failed with HTTP ${response.status}`,
        {
          status: response.status,
          requestId: response.headers.get("x-github-request-id") ?? undefined,
          message: isRecord(value) && typeof value.message === "string" ? value.message : undefined,
        }
      );
    }
    return value;
  };
}

interface GitHubIssueResponse {
  number: number;
  title: string;
  state: "open" | "closed";
  html_url: string;
  body: string | null;
}

interface GitHubCommentResponse {
  id: number;
  html_url: string;
  body: string;
}

function isGitHubIssue(value: unknown): value is GitHubIssueResponse {
  return (
    isRecord(value) &&
    Number.isInteger(value.number) &&
    typeof value.title === "string" &&
    (value.state === "open" || value.state === "closed") &&
    typeof value.html_url === "string" &&
    (typeof value.body === "string" || value.body === null)
  );
}

function isGitHubComment(value: unknown): value is GitHubCommentResponse {
  return (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    typeof value.html_url === "string" &&
    typeof value.body === "string"
  );
}

function isGitHubIssueResult(value: unknown): value is GitHubIssueResult {
  return (
    isRecord(value) &&
    Number.isInteger(value.number) &&
    typeof value.title === "string" &&
    (value.state === "open" || value.state === "closed") &&
    typeof value.url === "string" &&
    (typeof value.body === "string" || value.body === null)
  );
}

function isGitHubCommentResult(value: unknown): value is GitHubCommentResult {
  return (
    isRecord(value) &&
    Number.isInteger(value.id) &&
    Number.isInteger(value.issueNumber) &&
    typeof value.url === "string" &&
    typeof value.body === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
