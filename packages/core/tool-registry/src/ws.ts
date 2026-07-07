import type { ToolContext, ToolDefinition, ToolEvent } from "./types.ts";
import { ToolRegistry, makeBaseContext } from "./registry.ts";

// =============================================================================
// registry → WebSocket projection (transport-agnostic).
//
// Defines the WIRE PROTOCOL and the per-request handler; it does NOT depend on a
// ws library. A host (Nitro/crossws, ws, uWebSockets) wires a real socket to
// `makeWsHandler` and provides the broadcast `emitter`; tests use an in-memory
// emitter. One JSON message per frame, both directions:
//
//   client → server:  { op, input?, reqId?, caller }
//   server → client:  { type:"result",    reqId, result }   (reply)
//                     { type:"broadcast", op, payload }      (mutate fan-out)
//                     { type:"error",     reqId, message }   (denied / failed)
//
// AUTHORIZATION MODEL — read before trusting this as a boundary:
//   Authorization is HOST-ENFORCED (declared-in-core / enforced-in-host, the same
//   split as `approval` → `@gonk/pi-guard`). The host injects `authorize(tool,
//   caller, input)` and the projection checks it BEFORE dispatching the
//   **top-level** op. `caller` is an opaque, TRANSPORT-authenticated identity: the
//   socket layer establishes who the caller is; this projection trusts that field.
//
//   TRANSITIVE AUTHORITY (important): `authorize` gates ENTRY to the requested op
//   only. If that op's handler composes other tools via `ctx.invoke(...)`, those
//   composed invocations run with the entered tool's authority and are NOT
//   re-authorized against the caller (the registry owns `ctx.invoke` and dispatches
//   composition auth-agnostically — same as `approval`). CONSEQUENCE: do not expose
//   (via `authorize`) a tool whose handler composes an operation the caller must not
//   reach — entering it grants its transitive authority. A stronger guarantee
//   (re-authorizing every composed call against the original caller) requires a
//   registry-level authorize hook and is deliberately out of scope here.
//
// BROADCAST / DISCLOSURE: `emitter.broadcast` fans a succeeded op's result to ALL
// connected clients regardless of THEIR authorization — `shouldBroadcast` sees the
// invoker, never the recipients. The default therefore broadcasts ONLY unrestricted
// writes (`readOnly === false` AND no `authorization` restriction); a restricted
// op's result never fans out by default. A host that deliberately broadcasts a
// restricted op (e.g. collaborative editing where all connected clients are trusted)
// must override `shouldBroadcast` AND ensure audience scoping at the socket layer.
//
// REQUEST LIFETIME: this is request/reply — the handler's event stream is consumed
// to completion (so a trailing `error` correctly fails the request; see
// `collectOutcome`). A WS-reachable handler therefore MUST terminate; a
// non-terminating (subscription/duplex-style) handler pins the request forever. The
// projection has no built-in timeout — to bound a runaway handler, supply an
// aborting `AbortSignal` via `makeContext` (the registry's dispatch races it and
// yields a terminal `ABORTED` error). Duplex/streaming ops want a different surface,
// not this request/reply projection.
// =============================================================================

export interface WsRequest<Caller = unknown> {
  op: string;
  input?: unknown;
  reqId?: string;
  /** Opaque, transport-authenticated caller identity. The `authorize` policy
   *  interprets it; this projection trusts it (does not authenticate). */
  caller: Caller;
}

export type WsMessage =
  | { type: "result"; reqId?: string; result: unknown }
  | { type: "broadcast"; op: string; payload: unknown }
  | { type: "error"; reqId?: string; message: string };

export interface WsEmitter {
  broadcast(msg: Extract<WsMessage, { type: "broadcast" }>): void;
}

/** In-memory emitter for tests / local preview. */
export class InMemoryWsEmitter implements WsEmitter {
  readonly sent: Extract<WsMessage, { type: "broadcast" }>[] = [];
  broadcast(msg: Extract<WsMessage, { type: "broadcast" }>): void {
    this.sent.push(msg);
  }
}

export interface WsProjectionConfig<Caller> {
  /** Host-enforced authorization: may `caller` invoke `tool` with `input`? Checked
   *  BEFORE the handler runs. Input-aware (parity with `approval`, which is a
   *  function of input) so input-scoped policy is expressible. Return false to
   *  deny → error reply, no invocation, no broadcast. Governs the TOP-LEVEL op
   *  only; see the transitive-authority note in the module header. */
  authorize(tool: ToolDefinition, caller: Caller, input: unknown): boolean;
  /** Whether a SUCCEEDED op should broadcast its result to all clients. Default:
   *  only UNRESTRICTED writes broadcast (`readOnly === false` and no `authorization`
   *  restriction). Override to match the host's mutation model — but a restricted
   *  op broadcast reaches clients that could not invoke it (see header). */
  shouldBroadcast?(tool: ToolDefinition, caller: Caller): boolean;
  /** Build the per-invocation ToolContext (signal, cwd, scope, …). Defaults to
   *  `makeBaseContext()`. */
  makeContext?(caller: Caller): Omit<ToolContext, "invoke" | "callStack">;
  /** Broadcast sink. Omit to disable broadcasts (request/reply only). */
  emitter?: WsEmitter;
}

function isAuthorizationRestricted(tool: ToolDefinition): boolean {
  const a = tool.authorization;
  if (!a) return false;
  // Fail CLOSED for a disclosure check: a declared-but-blank restriction still
  // counts as restricted. An empty `allowedCallers: []` conventionally means
  // "allow nobody" (maximally restricted), and a blank role/level is degenerate —
  // in both cases suppress the default broadcast rather than fan the result out.
  return a.requiredRole != null || a.authLevel != null || Array.isArray(a.allowedCallers);
}

function defaultShouldBroadcast(tool: ToolDefinition): boolean {
  // Safe default: broadcast only unrestricted writes. A restricted op's result
  // must not fan to clients that could not invoke it — the host opts such ops in
  // explicitly (and scopes the audience) via `shouldBroadcast`.
  return tool.hints?.mcp?.annotations?.readOnly === false && !isAuthorizationRestricted(tool);
}

function resultMsg(reqId: string | undefined, result: unknown): WsMessage {
  return reqId === undefined ? { type: "result", result } : { type: "result", reqId, result };
}

function errorMsg(reqId: string | undefined, message: string): WsMessage {
  return reqId === undefined ? { type: "error", message } : { type: "error", reqId, message };
}

/** Collapse a tool's event stream to a single request/reply outcome. Consumes the
 *  ENTIRE stream: ANY `error` event is terminal-failure (even after a `result`, so
 *  a "partial then blew up" streaming handler correctly fails — no false success,
 *  no broadcast); otherwise the LAST `result` wins (multiple results collapse to
 *  the final one, none silently dropped without being the chosen answer). */
async function collectOutcome(
  events: AsyncIterable<ToolEvent>,
): Promise<{ ok: true; data: unknown } | { ok: false; message: string }> {
  let lastResult: { data: unknown } | undefined;
  let errorMessage: string | undefined;
  for await (const event of events) {
    if (event.type === "result") lastResult = { data: event.data };
    else if (event.type === "error") errorMessage = event.message;
  }
  if (errorMessage !== undefined) return { ok: false, message: errorMessage };
  if (lastResult !== undefined) return { ok: true, data: lastResult.data };
  return { ok: false, message: "Tool produced no result" };
}

/** Build the per-request WS handler. `registry.list()` snapshots the advertised
 *  ops at construction, so a tool the registry skipped (`requires() => false`) is
 *  unreachable. NOTE: the snapshot is static per handler — if the registry gains
 *  or loses tools afterward, rebuild the handler; a live-mutating registry is not
 *  reflected here. */
export function makeWsHandler<Caller = unknown>(
  registry: ToolRegistry,
  config: WsProjectionConfig<Caller>,
): (req: WsRequest<Caller>) => Promise<WsMessage> {
  const byName = new Map(registry.list().map((t) => [t.name, t]));
  const shouldBroadcast = config.shouldBroadcast ?? defaultShouldBroadcast;

  return async function handle(req: WsRequest<Caller>): Promise<WsMessage> {
    try {
      const tool = byName.get(req.op);
      if (!tool) return errorMsg(req.reqId, `No such op: ${req.op}`);

      // Authorize the TOP-LEVEL op before dispatch (composed ctx.invoke calls run
      // with this tool's transitive authority — see module header).
      if (!config.authorize(tool, req.caller, req.input)) {
        return errorMsg(req.reqId, `Not authorized to invoke ${req.op}`);
      }

      const ctx = config.makeContext ? config.makeContext(req.caller) : makeBaseContext();
      const outcome = await collectOutcome(registry.invoke(req.op, req.input, ctx));
      if (!outcome.ok) return errorMsg(req.reqId, outcome.message);

      if (config.emitter && shouldBroadcast(tool, req.caller)) {
        config.emitter.broadcast({ type: "broadcast", op: req.op, payload: outcome.data });
      }
      return resultMsg(req.reqId, outcome.data);
    } catch (err) {
      // authorize / makeContext / dispatch threw — a boundary returns an error
      // reply rather than rejecting (no unhandled rejection for the host).
      return errorMsg(req.reqId, err instanceof Error ? err.message : String(err));
    }
  };
}
