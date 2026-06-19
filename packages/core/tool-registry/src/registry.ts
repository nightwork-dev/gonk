import { ToolError } from "./errors.ts";
import { type InvocationMetric, type MetricsSink, noopSink } from "./metrics.ts";
import type {
  Logger,
  ToolContext,
  ToolDefinition,
  ToolEvent,
} from "./types.ts";

export interface ToolRegistryOptions {
  metrics?: MetricsSink;
}

export interface InvokeOptions {
  /** Internal: cycle detection across ctx.invoke chains. Root callers leave this empty. */
  callStack?: readonly string[];
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly metrics: MetricsSink;

  constructor(opts: ToolRegistryOptions = {}) {
    this.metrics = opts.metrics ?? noopSink;
  }

  register(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: ToolDefinition<any, any> | ToolDefinition<any, any>[] | ToolRegistry,
    opts?: { overwrite?: boolean },
  ): void {
    const defs =
      input instanceof ToolRegistry
        ? input.list()
        : Array.isArray(input)
          ? input
          : [input];
    for (const def of defs) {
      if (def.requires && !def.requires()) continue;
      if (this.tools.has(def.name) && !opts?.overwrite) {
        throw new Error(`Tool already registered: ${def.name}`);
      }
      this.tools.set(def.name, def as ToolDefinition);
    }
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  list(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /** Compose two registries into a new one. Inputs unchanged. */
  merge(other: ToolRegistry, opts?: { overwrite?: boolean }): ToolRegistry {
    const merged = new ToolRegistry({ metrics: this.metrics });
    merged.register(this);
    merged.register(other, opts);
    return merged;
  }

  extract(names: string[]): ToolRegistry {
    const sub = new ToolRegistry({ metrics: this.metrics });
    for (const n of names) {
      const t = this.tools.get(n);
      if (!t) throw new Error(`Tool not in registry: ${n}`);
      sub.register(t);
    }
    return sub;
  }

  filter(pred: (t: ToolDefinition) => boolean): ToolRegistry {
    const sub = new ToolRegistry({ metrics: this.metrics });
    for (const t of this.tools.values()) {
      if (pred(t)) sub.register(t);
    }
    return sub;
  }

  /** Single dispatch path. Validates input, runs handler, normalizes return into
   *  AsyncIterable<ToolEvent>, emits metrics. Adapters consume this. */
  invoke(
    name: string,
    input: unknown,
    ctx: Omit<ToolContext, "invoke" | "callStack">,
    opts: InvokeOptions = {},
  ): AsyncIterable<ToolEvent> {
    const callStack = opts.callStack ?? [];
    return this.runInvocation(name, input, ctx, callStack);
  }

  private async *runInvocation(
    name: string,
    input: unknown,
    baseCtx: Omit<ToolContext, "invoke" | "callStack">,
    callStack: readonly string[],
  ): AsyncIterable<ToolEvent> {
    const tool = this.tools.get(name);
    if (!tool) {
      const evt: ToolEvent = { type: "error", code: "TOOL_NOT_FOUND", message: `No such tool: ${name}` };
      this.metrics.onInvocation({ tool: name, durationMs: 0, outcome: "error", errorCode: "TOOL_NOT_FOUND" });
      yield evt;
      return;
    }

    if (callStack.includes(name)) {
      const message = `Cycle detected: ${[...callStack, name].join(" -> ")}`;
      this.metrics.onInvocation({ tool: name, durationMs: 0, outcome: "error", errorCode: "CYCLE" });
      yield { type: "error", code: "CYCLE", message };
      return;
    }

    const childStack = Object.freeze([...callStack, name]);
    // Strip `input` (duplex stream) when invoking children: a parent's input
    // belongs to the parent. If a tool wants to forward, it muxes explicitly.
    const { input: _parentInput, ...childBase } = baseCtx;
    const fullCtx: ToolContext = {
      ...baseCtx,
      callStack: childStack,
      invoke: (childName, childInput) =>
        this.runInvocation(childName, childInput, childBase, childStack),
    };

    const start = performance.now();
    let outcome: InvocationMetric["outcome"] = "ok";
    let errorCode: string | undefined;

    const validated = await tool.input["~standard"].validate(input);
    if (validated.issues) {
      outcome = "error";
      errorCode = "INVALID_INPUT";
      this.metrics.onInvocation({ tool: name, durationMs: performance.now() - start, outcome, errorCode });
      yield {
        type: "error",
        code: errorCode,
        message: "Input validation failed",
        details: validated.issues,
      };
      return;
    }

    try {
      const ret = tool.handler(validated.value as never, fullCtx);

      if (isAsyncIterable(ret)) {
        const iter = (ret as AsyncIterable<ToolEvent>)[Symbol.asyncIterator]();
        try {
          while (true) {
            const next = await raceAbort(iter.next(), fullCtx.signal);
            if (next === ABORTED) {
              outcome = "aborted";
              errorCode = "ABORTED";
              yield { type: "error", code: errorCode, message: "Tool execution aborted" };
              await iter.return?.(undefined);
              return;
            }
            if (next.done) break;

            const event = next.value;

            if (event.type === "result" && tool.output && tool.validateOutput && tool.validateOutput !== "off") {
              const v = await tool.output["~standard"].validate(event.data);
              if (v.issues) {
                if (tool.validateOutput === "strict") {
                  outcome = "error";
                  errorCode = "OUTPUT_INVALID";
                  yield {
                    type: "error",
                    code: errorCode,
                    message: "Output validation failed",
                    details: v.issues,
                  };
                  await iter.return?.(undefined);
                  return;
                }
                fullCtx.log.warn("Output validation failed (lax)", { issues: v.issues });
              }
            }

            yield event;

            if (event.type === "error") {
              outcome = "error";
              errorCode = event.code;
            }
          }
        } finally {
          await iter.return?.(undefined).catch(() => {});
        }
      } else {
        const result = await raceAbort(ret as Promise<unknown>, fullCtx.signal);
        if (result === ABORTED) {
          outcome = "aborted";
          errorCode = "ABORTED";
          yield { type: "error", code: errorCode, message: "Tool execution aborted" };
          return;
        }
        const r = result as { data: unknown; display?: unknown };
        if (tool.output && tool.validateOutput && tool.validateOutput !== "off") {
          const v = await tool.output["~standard"].validate(r.data);
          if (v.issues) {
            if (tool.validateOutput === "strict") {
              outcome = "error";
              errorCode = "OUTPUT_INVALID";
              yield {
                type: "error",
                code: errorCode,
                message: "Output validation failed",
                details: v.issues,
              };
              return;
            }
            fullCtx.log.warn("Output validation failed (lax)", { issues: v.issues });
          }
        }
        yield {
          type: "result",
          data: r.data,
          display: r.display as ToolEvent extends { display?: infer D } ? D : never,
        };
      }
    } catch (err) {
      outcome = "error";
      if (err instanceof ToolError) {
        errorCode = err.code;
        yield { type: "error", code: err.code, message: err.message, details: err.details };
      } else {
        errorCode = "INTERNAL";
        const message = err instanceof Error ? err.message : String(err);
        yield { type: "error", code: errorCode, message };
      }
    } finally {
      const metric: InvocationMetric = {
        tool: name,
        durationMs: performance.now() - start,
        outcome,
        ...(errorCode !== undefined ? { errorCode } : {}),
      };
      this.metrics.onInvocation(metric);
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

const ABORTED = Symbol("aborted");

function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T | typeof ABORTED> {
  if (signal.aborted) return Promise.resolve(ABORTED);
  return new Promise<T | typeof ABORTED>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      resolve(ABORTED);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

function isAsyncIterable(x: unknown): x is AsyncIterable<unknown> {
  return (
    x != null &&
    typeof (x as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function"
  );
}

// Convenience for adapters: build a base context.
export function makeBaseContext(overrides: Partial<Omit<ToolContext, "invoke" | "callStack">> = {}): Omit<ToolContext, "invoke" | "callStack"> {
  const noopLog: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  return {
    signal: overrides.signal ?? new AbortController().signal,
    log: overrides.log ?? noopLog,
    cwd: overrides.cwd ?? process.cwd(),
    env: overrides.env ?? process.env,
  };
}
