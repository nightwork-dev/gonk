import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { ToolDefinition } from "@gonk/tool-registry";

import { bm25Search } from "../src/bm25.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

function tool(name: string, opts: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    name,
    description: opts.description ?? `tool ${name}`,
    visibility: opts.visibility ?? "on-demand",
    input: passthrough(),
    handler: async () => ({ data: { name } }),
    ...(opts.tags ? { tags: opts.tags } : {}),
    ...(opts.keywords ? { keywords: opts.keywords } : {}),
    ...(opts.category ? { category: opts.category } : {}),
  };
}

describe("bm25Search", () => {
  it("returns empty for empty query", () => {
    const tools = [tool("foo"), tool("bar")];
    expect(bm25Search("", tools)).toEqual([]);
    expect(bm25Search("   ", tools)).toEqual([]);
  });

  it("exact-name token match outranks body-only match", () => {
    // "email" appears as a standalone token in "send email"'s name field.
    // "notify" appears only in body description of "notify-user".
    const tools = [
      tool("email", { description: "send a notification" }),
      tool("notify-user", { description: "send an email notification to the user" }),
    ];
    // "email" is a name token for the first tool (weight 3×); second only has it in body (1×)
    const results = bm25Search("email", tools);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.tool.name).toBe("email");
    expect(results[0]!.reason).toBe("bm25:name");
  });

  it("tag match outranks description-only match", () => {
    // "deploy" has "k8s" as a tag (body field, weight 1×, TF=1).
    // "logs" has "k8s" in description multiple times.
    // But "deploy" also has "k8s" in description via joined body — so IDF is same.
    // The key: test that a tag-bearing tool with fewer description tokens isn't beaten
    // by a longer description with the same term.
    const tools = [
      tool("deploy", {
        description: "deploy workloads",
        tags: ["k8s"],
        keywords: ["k8s"],
      }),
      tool("logs", {
        description: "stream k8s logs from pods",
      }),
    ];
    const results = bm25Search("k8s", tools);
    expect(results.length).toBe(2);
    // "deploy" has "k8s" in tags AND keywords (body TF=2) vs "logs" body TF=1
    expect(results[0]!.tool.name).toBe("deploy");
  });

  it("multi-term query ranks tool matching more terms higher", () => {
    const tools = [
      tool("git-commit", {
        description: "create a git commit with a message",
        tags: ["git"],
        keywords: ["commit"],
      }),
      tool("git-push", {
        description: "push commits to remote",
        tags: ["git"],
        keywords: ["push", "remote"],
      }),
      tool("unrelated", { description: "something completely different" }),
    ];

    // "git" matches both git-commit and git-push; "commit" only matches git-commit
    const results = bm25Search("git commit", tools);
    expect(results[0]!.tool.name).toBe("git-commit");
    expect(results.find((r) => r.tool.name === "unrelated")).toBeUndefined();
  });

  it("reason is bm25:name when name field dominates", () => {
    const tools = [
      tool("search", { description: "a generic tool" }),
      tool("lookup", { description: "lookup and find items" }),
    ];
    const results = bm25Search("search", tools);
    const hit = results.find((r) => r.tool.name === "search");
    expect(hit).toBeDefined();
    expect(hit!.reason).toBe("bm25:name");
  });

  it("reason is bm25:cat when category field dominates", () => {
    const tools = [
      tool("run-workflow", {
        category: "automation",
        description: "execute a workflow step",
      }),
      tool("other", {
        description: "does something with automation tasks and processes",
      }),
    ];
    // "automation" only appears in the category field of "run-workflow"
    const results = bm25Search("automation", tools);
    const hit = results.find((r) => r.tool.name === "run-workflow");
    expect(hit).toBeDefined();
    expect(hit!.reason).toBe("bm25:cat");
  });
});
