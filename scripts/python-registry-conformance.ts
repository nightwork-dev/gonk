import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { ownerPrincipal } from "../packages/core/auth/src/index.ts";
import {
  ToolError,
  ToolRegistry,
  makeBaseContext,
  passthrough,
  shape,
  type ToolDefinition,
  type ToolEvent,
} from "../packages/core/tool-registry/src/index.ts";
import type { AuthContext } from "../packages/core/auth/src/index.ts";

export interface RegistryReplayFixture {
  version: number;
  cases: readonly {
    id: string;
    tool: string;
    input: unknown;
    auth?: "malformed";
    approvalDecision?:
      | "malformed-grant"
      | "required-missing-id"
      | "null-grant-scope"
      | "null-request-id"
      | "null-reason";
  }[];
}

export interface RegistryReplayResult {
  generatedBy: "typescript-tool-registry";
  version: number;
  cases: readonly { id: string; events: readonly ToolEvent[] }[];
}

export const REGISTRY_REPLAY_FIXTURE = resolve(
  new URL("../conformance/tool-registry/cases.json", import.meta.url).pathname
);
export const REGISTRY_REPLAY_EXPECTED = resolve(
  new URL("../conformance/tool-registry/expected.json", import.meta.url).pathname
);

function textInput() {
  return shape<{ text: string }>(
    (value): value is { text: string } =>
      !!value &&
      typeof value === "object" &&
      typeof (value as { text?: unknown }).text === "string",
    "text required"
  );
}

function replayTools(): ToolDefinition[] {
  return [
    {
      name: "echo",
      description: "echo",
      input: textInput(),
      handler: async (value) => ({
        data: { echoed: (value as { text: string }).text },
      }),
    },
    {
      name: "async-echo",
      description: "async echo",
      input: textInput(),
      handler: async (value) => ({
        data: { echoed: (value as { text: string }).text },
      }),
    },
    {
      name: "stream",
      description: "stream",
      input: passthrough(),
      handler: async function* () {
        yield { type: "progress", message: "working" };
        yield { type: "result", data: { streamed: true } };
      },
    },
    {
      name: "multi-stream",
      description: "multi stream",
      input: passthrough(),
      handler: async function* () {
        yield { type: "result", data: { n: 1 } };
        yield { type: "result", data: { n: 2 } };
      },
    },
    {
      name: "flaky-stream",
      description: "flaky stream",
      input: passthrough(),
      handler: async function* () {
        yield { type: "result", data: { partial: true } };
        yield { type: "error", code: "INTERNAL", message: "actually it blew up" };
      },
    },
    {
      name: "boom",
      description: "boom",
      input: passthrough(),
      handler: async () => {
        throw new ToolError("BOOM", "kaboom");
      },
    },
    {
      name: "approval",
      description: "approval",
      input: passthrough(),
      approval: "write",
      handler: async () => ({ data: { approved: true } }),
    },
  ];
}

async function collect(events: AsyncIterable<ToolEvent>): Promise<ToolEvent[]> {
  const result: ToolEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

export async function runTypeScriptRegistryConformance(
  fixturePath: string = REGISTRY_REPLAY_FIXTURE
): Promise<RegistryReplayResult> {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8")) as RegistryReplayFixture;
  const cases: { id: string; events: readonly ToolEvent[] }[] = [];
  for (const replayCase of fixture.cases) {
    const approvalCase = replayCase.tool === "approval";
    const registry = new ToolRegistry({
      security: approvalCase
        ? {
            requestId: () => "request-replay",
            approvalProvider: {
              decide: () => {
                if (replayCase.approvalDecision === "malformed-grant") {
                  return { outcome: "approved", grantScope: "invalid" } as never;
                }
                if (replayCase.approvalDecision === "required-missing-id") {
                  return { outcome: "required", reason: "replay approval" } as never;
                }
                if (replayCase.approvalDecision === "null-grant-scope") {
                  return { outcome: "approved", grantScope: null } as never;
                }
                if (replayCase.approvalDecision === "null-request-id") {
                  return { outcome: "denied", reason: "replay approval", approvalRequestId: null } as never;
                }
                if (replayCase.approvalDecision === "null-reason") {
                  return { outcome: "required", reason: null, approvalRequestId: "approval-replay" } as never;
                }
                return {
                  outcome: "required" as const,
                  reason: "replay approval",
                  approvalRequestId: "approval-replay",
                  expiresAt: "2026-10-07T00:00:00Z",
                };
              },
            },
          }
        : { approvalMode: "bypass" },
    });
    registry.register(replayTools());
    const owner = ownerPrincipal({ USER: "replay", HOSTNAME: "replay" });
    const auth: AuthContext = replayCase.auth === "malformed"
      ? { ...owner, authorize: () => ({ allowed: true } as never) }
      : owner;
    const context = makeBaseContext({ auth });
    cases.push({
      id: replayCase.id,
      events: await collect(registry.invoke(replayCase.tool, replayCase.input, context)),
    });
  }
  return { generatedBy: "typescript-tool-registry", version: fixture.version, cases };
}

export async function writeTypeScriptRegistryConformance(
  outputPath: string,
  fixturePath: string = REGISTRY_REPLAY_FIXTURE
): Promise<RegistryReplayResult> {
  const result = await runTypeScriptRegistryConformance(fixturePath);
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  await writeTypeScriptRegistryConformance(process.argv[2] ?? REGISTRY_REPLAY_EXPECTED);
}
