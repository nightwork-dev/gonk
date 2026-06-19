import type {
  Display,
  DisplayBlock,
  Logger,
  ToolDefinition,
  ToolEvent,
  ToolRegistry,
} from "@gonk/tool-registry";
import { makeBaseContext } from "@gonk/tool-registry";
import type { Orchestrator } from "@gonk/tool-orchestrator";
import type { ScopeStore } from "@gonk/scope";

export interface CliAdapterOptions {
  binaryName: string;
  version?: string;
  source: ToolRegistry | Orchestrator;
  /** When true, all output is JSON Lines on stdout. */
  jsonMode?: boolean;
  /** ScopeStore threaded into ctx.scope for every tool invocation. Optional —
   *  tools that don't need scope ignore it. */
  scope?: ScopeStore;
  /** Additional top-level commands to include in --help output. Each entry is
   *  printed as a verb + one-line description alongside the built-in verbs. */
  extraCommands?: Array<{ name: string; description: string }>;
}

export interface CliIO {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  signal?: AbortSignal;
  cwd?: string;
  env?: Readonly<Record<string, string | undefined>>;
  /** Override ScopeStore for this run (else uses options.scope). */
  scope?: ScopeStore;
}

export interface Cli {
  run(argv: string[], io?: Partial<CliIO>): Promise<number>;
}

export function createCli(options: CliAdapterOptions): Cli {
  return {
    async run(argv, ioOverrides = {}) {
      const io: CliIO = {
        stdout: ioOverrides.stdout ?? { write: (s) => process.stdout.write(s) },
        stderr: ioOverrides.stderr ?? { write: (s) => process.stderr.write(s) },
        ...(ioOverrides.signal ? { signal: ioOverrides.signal } : {}),
        ...(ioOverrides.cwd !== undefined ? { cwd: ioOverrides.cwd } : {}),
        ...(ioOverrides.env !== undefined ? { env: ioOverrides.env } : {}),
      };

      const args = argv.slice();
      const sub = args.shift();

      if (!sub || sub === "--help" || sub === "-h" || sub === "help") {
        printHelp(io.stdout, options);
        return 0;
      }
      if (sub === "--version" || sub === "-v") {
        io.stdout.write(`${options.version ?? "0.0.0"}\n`);
        return 0;
      }
      if (sub === "list") {
        printToolList(io.stdout, options);
        return 0;
      }

      const tool = lookupTool(options.source, sub);
      if (!tool) {
        io.stderr.write(`Unknown tool: ${sub}\n`);
        printHelp(io.stderr, options);
        return 2;
      }
      if (tool.capabilities?.duplex) {
        io.stderr.write(
          `Tool '${tool.name}' requires duplex (bidirectional input). The CLI adapter does not support duplex; use the Pi adapter or a custom host.\n`,
        );
        return 3;
      }

      if (args[0] === "--help" || args[0] === "-h") {
        printToolHelp(io.stdout, options.binaryName, tool);
        return 0;
      }

      const jsonMode = options.jsonMode === true || extractFlag(args, "--json", true) !== undefined;

      let input: unknown;
      try {
        input = parseInput(args, tool);
      } catch (err) {
        io.stderr.write(`Input error: ${(err as Error).message}\n`);
        return 2;
      }

      // Set up SIGINT abort if not provided.
      const ac = new AbortController();
      const externalSignal = io.signal;
      if (externalSignal) {
        if (externalSignal.aborted) ac.abort();
        else externalSignal.addEventListener("abort", () => ac.abort(), { once: true });
      }
      const sigint = () => ac.abort();
      let registeredSigint = false;
      if (!externalSignal && typeof process !== "undefined" && typeof process.on === "function") {
        process.on("SIGINT", sigint);
        registeredSigint = true;
      }

      try {
        const log = makeStderrLogger(io.stderr);
        const scope = io.scope ?? options.scope;
        const baseCtx = {
          ...makeBaseContext({ signal: ac.signal, log }),
          ...(io.cwd !== undefined ? { cwd: io.cwd } : {}),
          ...(io.env !== undefined ? { env: io.env } : {}),
          ...(scope ? { scope } : {}),
        };

        const stream = isOrchestrator(options.source)
          ? options.source.invoke(tool.name, input, baseCtx)
          : options.source.invoke(tool.name, input, baseCtx);

        let exitCode = 0;
        for await (const event of stream) {
          renderEvent(event, io, jsonMode);
          if (event.type === "error") exitCode = mapErrorToExit(event.code);
        }
        return exitCode;
      } finally {
        if (registeredSigint) process.off("SIGINT", sigint);
      }
    },
  };
}

// =============================================================================
// Lookup
// =============================================================================

function isOrchestrator(s: ToolRegistry | Orchestrator): s is Orchestrator {
  return typeof (s as Orchestrator).activeSet === "function";
}

function lookupTool(source: ToolRegistry | Orchestrator, name: string): ToolDefinition | undefined {
  if (isOrchestrator(source)) {
    return source.allTools().find((t) => t.name === name);
  }
  return source.get(name);
}

function listAllTools(source: ToolRegistry | Orchestrator): ToolDefinition[] {
  return isOrchestrator(source) ? source.allTools() : source.list();
}

// =============================================================================
// Argv parsing
// =============================================================================

function extractFlag(args: string[], name: string, isBoolean = false): string | true | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name) {
      if (isBoolean) {
        args.splice(i, 1);
        return true;
      }
      const v = args[i + 1];
      if (v === undefined) throw new Error(`Flag ${name} requires a value`);
      args.splice(i, 2);
      return v;
    }
  }
  return undefined;
}

function parseInput(args: string[], tool: ToolDefinition): unknown {
  // --input '<json>' wins.
  const explicit = extractFlag(args, "--input");
  if (typeof explicit === "string") {
    try {
      return JSON.parse(explicit);
    } catch (err) {
      throw new Error(`--input must be valid JSON: ${(err as Error).message}`);
    }
  }

  // Build an object from positional + flags.
  const positionalNames = tool.hints?.cli?.positional ?? [];
  const obj: Record<string, unknown> = {};

  // Pull --key value flags.
  for (let i = 0; i < args.length; ) {
    const a = args[i];
    if (a !== undefined && a.startsWith("--")) {
      const key = a.slice(2);
      const val = args[i + 1];
      if (val === undefined || val.startsWith("--")) {
        obj[key] = true;
        args.splice(i, 1);
      } else {
        obj[key] = coerceArg(val);
        args.splice(i, 2);
      }
    } else {
      i++;
    }
  }

  // Whatever's left is positional.
  for (let i = 0; i < args.length && i < positionalNames.length; i++) {
    const key = positionalNames[i];
    const val = args[i];
    if (key === undefined || val === undefined) continue;
    if (!(key in obj)) obj[key] = coerceArg(val);
  }

  return obj;
}

function coerceArg(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw === "null") return null;
  if (/^-?\d+$/.test(raw)) return Number.parseInt(raw, 10);
  if (/^-?\d+\.\d+$/.test(raw)) return Number.parseFloat(raw);
  return raw;
}

// =============================================================================
// Help / list
// =============================================================================

function printHelp(out: { write(s: string): void }, options: CliAdapterOptions): void {
  out.write(`Usage: ${options.binaryName} <tool> [flags] [positional...]\n\n`);
  out.write(`  ${options.binaryName} list                     List all tools\n`);
  out.write(`  ${options.binaryName} <tool> --help            Tool-specific help\n`);
  out.write(`  ${options.binaryName} <tool> --input '<json>'  Provide input as JSON\n`);
  out.write(`  ${options.binaryName} --version                Print version\n`);
  if (options.extraCommands && options.extraCommands.length > 0) {
    out.write(`\n`);
    for (const cmd of options.extraCommands) {
      out.write(`  ${options.binaryName} ${cmd.name.padEnd(24)}  ${cmd.description}\n`);
    }
  }
}

function printToolList(out: { write(s: string): void }, options: CliAdapterOptions): void {
  const tools = listAllTools(options.source).filter((t) => !t.capabilities?.duplex);
  const byCategory = new Map<string, ToolDefinition[]>();
  for (const t of tools) {
    const cat = t.category ?? "(uncategorized)";
    const bucket = byCategory.get(cat) ?? [];
    bucket.push(t);
    byCategory.set(cat, bucket);
  }
  for (const [cat, bucket] of byCategory) {
    out.write(`${cat}\n`);
    for (const t of bucket) out.write(`  ${t.name.padEnd(24)}  ${t.description}\n`);
  }
}

function printToolHelp(
  out: { write(s: string): void },
  bin: string,
  tool: ToolDefinition,
): void {
  const positional = tool.hints?.cli?.positional ?? [];
  const positionalStr = positional.map((p) => `<${p}>`).join(" ");
  out.write(`${tool.name} — ${tool.description}\n\n`);
  out.write(`Usage: ${bin} ${tool.name} ${positionalStr} [flags]\n`);

  const schema = tool.inputJsonSchema as Record<string, unknown> | undefined;
  const props = schema?.properties as Record<string, Record<string, unknown>> | undefined;
  if (props && Object.keys(props).length > 0) {
    const required = new Set(Array.isArray(schema?.required) ? (schema.required as string[]) : []);
    out.write(`\nInput flags:\n`);
    for (const [key, def] of Object.entries(props)) {
      const typeStr = typeof def.type === "string" ? def.type : "value";
      const req = required.has(key) ? " (required)" : "";
      const desc = typeof def.description === "string" ? `  ${def.description}` : "";
      out.write(`  --${key} <${typeStr}>${req}${desc}\n`);
    }
  } else {
    out.write(`\nInput: JSON via --input '<json>'`);
    const readme = tool.hints?.cli?.examples?.length ? "" : " — see package README";
    out.write(`${readme}\n`);
  }

  if (tool.hints?.cli?.examples?.length) {
    out.write(`\nExamples:\n`);
    for (const ex of tool.hints.cli.examples) out.write(`  ${ex}\n`);
  }
}

// =============================================================================
// Event rendering
// =============================================================================

function renderEvent(event: ToolEvent, io: CliIO, jsonMode: boolean): void {
  if (jsonMode) {
    io.stdout.write(`${JSON.stringify(event)}\n`);
    return;
  }

  switch (event.type) {
    case "log":
      io.stderr.write(`[${event.level}] ${event.message}\n`);
      break;
    case "progress": {
      const pct = event.percent !== undefined ? `${Math.round(event.percent)}% ` : "";
      io.stderr.write(`${pct}${event.message ?? ""}\n`);
      break;
    }
    case "data":
      // Pretty-printing intermediate chunks is tool-specific; default = JSON.
      io.stdout.write(`${JSON.stringify(event.chunk)}\n`);
      break;
    case "result": {
      if (event.display !== undefined) {
        renderDisplay(event.display, io.stdout);
      } else {
        io.stdout.write(`${JSON.stringify(event.data)}\n`);
      }
      break;
    }
    case "error":
      io.stderr.write(`Error [${event.code}]: ${event.message}\n`);
      if (event.details !== undefined) {
        io.stderr.write(`${JSON.stringify(event.details, null, 2)}\n`);
      }
      break;
  }
}

function renderDisplay(display: Display, out: { write(s: string): void }): void {
  if (typeof display === "string") {
    out.write(display.endsWith("\n") ? display : `${display}\n`);
    return;
  }
  for (const block of display) {
    out.write(`${renderBlock(block)}\n`);
  }
}

function renderBlock(block: DisplayBlock): string {
  switch (block.type) {
    case "text":
      return block.text;
    case "markdown":
      return block.markdown;
    case "code":
      return `\`\`\`${block.language}\n${block.code}\n\`\`\``;
    case "json":
      return JSON.stringify(block.value, null, 2);
    case "link":
      return block.title ? `${block.title}: ${block.url}` : block.url;
    case "image":
      return `[image ${block.mimeType}${block.alt ? ` — ${block.alt}` : ""}]`;
  }
}

function mapErrorToExit(code: string): number {
  switch (code) {
    case "TOOL_NOT_FOUND":
      return 127;
    case "INVALID_INPUT":
      return 2;
    case "ABORTED":
      return 130;
    default:
      return 1;
  }
}

function makeStderrLogger(stderr: { write(s: string): void }): Logger {
  const w = (level: string, msg: string, meta?: unknown) => {
    const m = meta !== undefined ? ` ${JSON.stringify(meta)}` : "";
    stderr.write(`[${level}] ${msg}${m}\n`);
  };
  return {
    debug: (m, meta) => w("debug", m, meta),
    info: (m, meta) => w("info", m, meta),
    warn: (m, meta) => w("warn", m, meta),
    error: (m, meta) => w("error", m, meta),
  };
}
