import { describe, expect, it } from "vitest";
import type { StandardSchemaV1 } from "@standard-schema/spec";

import { ToolRegistry, type ToolDefinition, type ToolEvent } from "@gonk/tool-registry";

import { createCli } from "../src/index.ts";

function passthrough<T>(): StandardSchemaV1<unknown, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: (value: unknown) => ({ value: value as T }),
    },
  };
}

function failingValidator(): StandardSchemaV1<unknown, unknown> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate: () => ({ issues: [{ message: "bad" }] }),
    },
  };
}

class CapturingStream {
  chunks: string[] = [];
  write(s: string): void {
    this.chunks.push(s);
  }
  text(): string {
    return this.chunks.join("");
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function setup(tools: ToolDefinition<any, any>[], opts: { jsonMode?: boolean } = {}): {
  cli: ReturnType<typeof createCli>;
  stdout: CapturingStream;
  stderr: CapturingStream;
} {
  const r = new ToolRegistry();
  r.register(tools);
  const cli = createCli({
    binaryName: "test-bin",
    version: "1.2.3",
    source: r,
    ...(opts.jsonMode !== undefined ? { jsonMode: opts.jsonMode } : {}),
  });
  return { cli, stdout: new CapturingStream(), stderr: new CapturingStream() };
}

const echoTool: ToolDefinition<{ text: string }, { echoed: string }> = {
  name: "echo",
  description: "echo input",
  category: "demo",
  input: passthrough(),
  hints: { cli: { positional: ["text"] } },
  handler: async (input) => ({
    data: { echoed: input.text },
    display: `echoed: ${input.text}`,
  }),
};

describe("createCli", () => {
  it("prints version", async () => {
    const { cli, stdout } = setup([echoTool]);
    const code = await cli.run(["--version"], { stdout });
    expect(code).toBe(0);
    expect(stdout.text().trim()).toBe("1.2.3");
  });

  it("prints help when no args", async () => {
    const { cli, stdout } = setup([echoTool]);
    const code = await cli.run([], { stdout });
    expect(code).toBe(0);
    expect(stdout.text()).toContain("Usage: test-bin");
  });

  it("lists tools by category", async () => {
    const { cli, stdout } = setup([echoTool]);
    const code = await cli.run(["list"], { stdout });
    expect(code).toBe(0);
    expect(stdout.text()).toContain("demo");
    expect(stdout.text()).toContain("echo");
  });

  it("invokes a tool with positional argument", async () => {
    const { cli, stdout, stderr } = setup([echoTool]);
    const code = await cli.run(["echo", "hello"], { stdout, stderr });
    expect(code).toBe(0);
    expect(stdout.text()).toContain("echoed: hello");
  });

  it("invokes a tool with --input json", async () => {
    const { cli, stdout, stderr } = setup([echoTool]);
    const code = await cli.run(["echo", "--input", '{"text":"world"}'], { stdout, stderr });
    expect(code).toBe(0);
    expect(stdout.text()).toContain("echoed: world");
  });

  it("invokes a tool with --flag value syntax", async () => {
    const { cli, stdout, stderr } = setup([echoTool]);
    const code = await cli.run(["echo", "--text", "hi-there"], { stdout, stderr });
    expect(code).toBe(0);
    expect(stdout.text()).toContain("echoed: hi-there");
  });

  it("returns 127 for unknown tool", async () => {
    const { cli, stdout, stderr } = setup([echoTool]);
    const code = await cli.run(["ghost"], { stdout, stderr });
    expect(code).toBe(2);
    expect(stderr.text()).toContain("Unknown tool: ghost");
  });

  it("returns 2 on invalid input", async () => {
    const tool: ToolDefinition = {
      name: "strict",
      description: "strict",
      input: failingValidator(),
      handler: async () => ({ data: null }),
    };
    const { cli, stdout, stderr } = setup([tool]);
    const code = await cli.run(["strict", "anything"], { stdout, stderr });
    expect(code).toBe(2);
    expect(stderr.text()).toContain("INVALID_INPUT");
  });

  it("emits jsonl events in --json mode", async () => {
    const { cli, stdout, stderr } = setup([echoTool]);
    const code = await cli.run(["echo", "--json", "hi"], { stdout, stderr });
    expect(code).toBe(0);
    const lines = stdout.text().trim().split("\n");
    const events = lines.map((l) => JSON.parse(l) as ToolEvent);
    expect(events[0]).toMatchObject({ type: "result", data: { echoed: "hi" } });
  });

  it("renders streaming progress to stderr and data to stdout", async () => {
    const tool: ToolDefinition = {
      name: "stream",
      description: "stream",
      input: passthrough(),
      handler: async function* () {
        yield { type: "progress", message: "step-1" } as ToolEvent;
        yield { type: "data", chunk: { n: 1 } } as ToolEvent;
        yield { type: "result", data: { ok: true }, display: "done" } as ToolEvent;
      },
    };
    const { cli, stdout, stderr } = setup([tool]);
    const code = await cli.run(["stream"], { stdout, stderr });
    expect(code).toBe(0);
    expect(stderr.text()).toContain("step-1");
    expect(stdout.text()).toContain('{"n":1}');
    expect(stdout.text()).toContain("done");
  });

  it("refuses to run duplex tools and hides them from list", async () => {
    const duplexTool: ToolDefinition = {
      name: "voice",
      description: "duplex voice",
      input: passthrough(),
      capabilities: { duplex: true },
      handler: async () => ({ data: 1 }),
    };
    const { cli, stdout, stderr } = setup([echoTool, duplexTool]);

    const listCode = await cli.run(["list"], { stdout });
    expect(listCode).toBe(0);
    expect(stdout.text()).not.toContain("voice");
    expect(stdout.text()).toContain("echo");

    const stdout2 = new CapturingStream();
    const code = await cli.run(["voice"], { stdout: stdout2, stderr });
    expect(code).toBe(3);
    expect(stderr.text()).toContain("duplex");
  });

  it("renders rich display blocks", async () => {
    const tool: ToolDefinition = {
      name: "rich",
      description: "rich",
      input: passthrough(),
      handler: async () => ({
        data: { ok: true },
        display: [
          { type: "markdown", markdown: "# heading" },
          { type: "code", language: "ts", code: "const x = 1;" },
          { type: "link", url: "https://example.com", title: "Ex" },
        ],
      }),
    };
    const { cli, stdout, stderr } = setup([tool]);
    const code = await cli.run(["rich"], { stdout, stderr });
    expect(code).toBe(0);
    const out = stdout.text();
    expect(out).toContain("# heading");
    expect(out).toContain("```ts");
    expect(out).toContain("Ex: https://example.com");
  });
});
