# Hand-authored GitHub Issues adapter

This example wraps two GitHub REST operations as ordinary Gonk tools:

- `github-issue-read` reads an issue.
- `github-issue-comment` adds an issue comment.

It is deliberately hand-authored. The API client remains consumer-owned; Gonk
provides validation, authorization, approval, cancellation, and MCP projection.

```ts
import { ToolRegistry } from "@gonk/tool-registry";
import { createMcpServer } from "@gonk/tool-registry-mcp";

import { createGitHubIssueTools } from "./github-issues.js";

const registry = new ToolRegistry({ security });
registry.register(
  createGitHubIssueTools({
    owner: "nightwork-dev",
    repository: "gonk",
    resolveToken: () => process.env.GITHUB_TOKEN ?? "",
  })
);

const mcp = createMcpServer({
  serverName: "github-issues",
  serverVersion: "1",
  source: registry,
  makeAuthContext,
  writeToolPolicy: "require-allowlist",
  // The MCP adapter conservatively treats every network tool as requiring an
  // allowlist entry, including the read operation.
  allowlist: ["github-issue-read", "github-issue-comment"],
});
```

Credentials are resolved inside the handler after registry authorization. They
never appear in tool input or error output. The write also passes through the
registry approval provider before any HTTP request is made.

The focused test uses a real loopback HTTP server, not a mocked `fetch`. It proves
bearer authentication, read and write behavior, denial before credential resolution
or network I/O, sanitized HTTP failures, cancellation, timeout, and MCP reprojection:

```bash
pnpm --filter @gonk/tool-registry-mcp exec vitest run test/github-issues.test.ts
pnpm --filter @gonk/tool-registry-mcp typecheck
```

No live GitHub mutation is part of this proof. Running these tools against
`api.github.com` requires a separately authorized repository and credential.
