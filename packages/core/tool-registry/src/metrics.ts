import type { ToolEvent } from "./types.ts";

export interface InvocationMetric {
  tool: string;
  durationMs: number;
  outcome: "ok" | "error" | "aborted";
  errorCode?: string;
}

export interface MetricsSink {
  onInvocation(event: InvocationMetric): void;
}

export const noopSink: MetricsSink = { onInvocation: () => {} };

export function consoleSink(): MetricsSink {
  return {
    onInvocation(e) {
      const tag = e.outcome === "ok" ? "OK" : e.outcome.toUpperCase();
      const code = e.errorCode ? ` ${e.errorCode}` : "";
      // eslint-disable-next-line no-console
      console.error(`[tool] ${e.tool} ${tag}${code} ${e.durationMs.toFixed(1)}ms`);
    },
  };
}

export interface InMemorySink extends MetricsSink {
  snapshot(): InvocationMetric[];
  clear(): void;
}

export function inMemorySink(): InMemorySink {
  const buf: InvocationMetric[] = [];
  return {
    onInvocation(e) {
      buf.push(e);
    },
    snapshot() {
      return buf.slice();
    },
    clear() {
      buf.length = 0;
    },
  };
}

export function compositeSink(sinks: MetricsSink[]): MetricsSink {
  return {
    onInvocation(e) {
      for (const s of sinks) s.onInvocation(e);
    },
  };
}

// Re-export for module consumers that don't need it elsewhere.
export type { ToolEvent };
