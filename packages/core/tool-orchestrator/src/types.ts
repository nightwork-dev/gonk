import type {
  ToolContext,
  ToolDefinition,
  ToolEvent,
  ToolRegistry,
  ToolVisibility,
} from "@gonk/tool-registry";

export type Scope = "mcp" | "pi" | "claude";

export interface RankedTool {
  tool: ToolDefinition;
  score: number;
  reason?: string;
}

export interface RecommendationContext {
  /** Recent user/assistant text for keyword extraction. */
  recentText?: string[];
  /** Currently active tools (avoid re-recommending these). */
  activeTools?: string[];
  cwd?: string;
  hints?: Record<string, unknown>;
}

export interface PinStore {
  load(): Promise<string[]> | string[];
  save(pins: string[]): Promise<void> | void;
}

export interface OrchestratorOptions {
  registries: ToolRegistry[];
  scope: Scope;

  /** Custom search ranker. Default: keyword + tag + name fuzzy match. */
  search?: (query: string, tools: ToolDefinition[]) => RankedTool[];
  /** Custom recommender. Default: keyword overlap with recentText. */
  recommend?: (ctx: RecommendationContext, tools: ToolDefinition[]) => RankedTool[];

  /** Optional persistence for committed pins (Pi: session-scoped; MCP: ephemeral). */
  pinStore?: PinStore;

  /** Whether to register the meta-tools (list_tools, find_tools, ...) automatically.
   *  Default: true. */
  registerMetaTools?: boolean;
}

/** Outcome of pin/commit operations. */
export interface PinDiff {
  added: string[];
  tombstoned: string[];
  unchanged: string[];
}

export interface Orchestrator {
  /** All known tools across all registries (deterministic order: by name). */
  allTools(): ToolDefinition[];

  /** Tools the adapter should expose to the model right now.
   *  = sorted-by-name `always` tools, then committed pins in pin order
   *  (tombstoned pins are filtered out at activeSet-render time). */
  activeSet(): ToolDefinition[];

  /** Effective visibility in this orchestrator's scope. */
  visibilityOf(name: string): ToolVisibility;

  search(
    query: string,
    opts?: {
      limit?: number;
      /** Pre-authorized corpus. Callers must filter before ranking so hidden
       *  tools cannot affect scores or ordering. */
      candidates?: readonly ToolDefinition[];
    }
  ): RankedTool[];
  recommend(ctx: RecommendationContext, opts?: { limit?: number }): RankedTool[];

  /** Queue a pin. Doesn't take effect until commitPins(). */
  pin(name: string): void;
  /** Queue an unpin. Doesn't take effect until commitPins(). */
  unpin(name: string): void;

  pendingPins(): { add: string[]; remove: string[] };
  committedPins(): string[];

  /** Flush queued pins/unpins. Called by adapters at turn boundary / compaction.
   *  Returns the diff applied. */
  commitPins(): Promise<PinDiff>;

  /** Record a tool was used in the current span. Compaction can use this signal
   *  to prune pins that weren't actually used. */
  markUsed(name: string): void;
  usedSince(timestamp: number): string[];

  /** Dispatch path. Looks up the tool across registries and invokes it. */
  invoke(
    name: string,
    input: unknown,
    ctx: Omit<ToolContext, "invoke" | "callStack">,
  ): AsyncIterable<ToolEvent>;
}
