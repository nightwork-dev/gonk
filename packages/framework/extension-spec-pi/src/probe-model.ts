/** The model/provider info Pi attaches to its per-event ExtensionContext,
 *  beyond the typed {@link PiExtensionContext} surface. */
export interface PiModelProbe {
  provider: string;
  /** Pi's model id (e.g. "claude-opus-4-8"). Consumers that expose this as a
   *  "model" field map `id` to their own shape. */
  id: string;
  displayName?: string;
}

/** Probe Pi's per-event ExtensionContext for the running model. Pi hands
 *  extensions the full context with `model` beyond the typed surface, so this
 *  reads `ctx.model.{provider, id, displayName}` cast-through-unknown and returns
 *  undefined when absent or partial — CLI/MCP hosts, or before Pi has resolved a
 *  model. The single home for the probe the runtime-surfacing consumers share
 *  (pi-introspect's harness_status, pi-persona's substrate line). Does NOT read
 *  `modelRegistry` — aux-LLM consumers (curator/rlm/reflector) need that and
 *  keep their own `AuxModelContext` probe. */
export function probePiModel(ctx: unknown): PiModelProbe | undefined {
  if (!ctx || typeof ctx !== "object") return undefined;
  const model = (ctx as Record<string, unknown>).model;
  if (!model || typeof model !== "object") return undefined;
  const m = model as Record<string, unknown>;
  const provider = typeof m.provider === "string" ? m.provider : undefined;
  const id = typeof m.id === "string" ? m.id : undefined;
  if (!provider || !id) return undefined;
  const out: PiModelProbe = { provider, id };
  if (typeof m.displayName === "string") out.displayName = m.displayName;
  return out;
}
