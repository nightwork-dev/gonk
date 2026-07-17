import {
  captureAuthContext,
  redactAuthzResource,
  securityContextKey,
  type AuthContext,
  type AuthSecurityReceipt,
  type AuthorizationDecision,
  type AuthzResource,
  type SecurityReceiptBase,
} from "@gonk/auth";

import { resolveApproval } from "./approval.ts";
import { ToolError } from "./errors.ts";
import {
  type InvocationMetric,
  type MetricsSink,
  noopSink,
} from "./metrics.ts";
import {
  redactAuthorizationResources,
  toolAuthorizationResource,
  validateResolvedResource,
  type ApprovalDecision,
  type ToolRegistrySecurityOptions,
} from "./security.ts";
import type {
  Logger,
  ToolContext,
  ToolDefinition,
  ToolEvent,
} from "./types.ts";

export interface ToolRegistryOptions {
  metrics?: MetricsSink;
  security?: ToolRegistrySecurityOptions;
}

export interface InvokeOptions {
  /** Internal: cycle detection across ctx.invoke chains. Root callers leave this empty. */
  callStack?: readonly string[];
}

interface InvocationSecurityState {
  requestId: string;
  securityContextKey: string;
  auth: AuthContext;
}

const DEFAULT_AUTHENTICATED_APPROVAL = Object.freeze({
  tier: "exec" as const,
  override: false,
  reason: "Missing or invalid approval declaration",
});

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly metrics: MetricsSink;
  private readonly security: ToolRegistrySecurityOptions;

  constructor(opts: ToolRegistryOptions = {}) {
    this.metrics = opts.metrics ?? noopSink;
    this.security = opts.security ?? {};
  }

  register(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    input: ToolDefinition<any, any> | ToolDefinition<any, any>[] | ToolRegistry,
    opts?: { overwrite?: boolean }
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
    const merged = new ToolRegistry({
      metrics: this.metrics,
      security: this.security,
    });
    merged.register(this);
    merged.register(other, opts);
    return merged;
  }

  extract(names: string[]): ToolRegistry {
    const sub = new ToolRegistry({
      metrics: this.metrics,
      security: this.security,
    });
    for (const n of names) {
      const t = this.tools.get(n);
      if (!t) throw new Error(`Tool not in registry: ${n}`);
      sub.register(t);
    }
    return sub;
  }

  filter(pred: (t: ToolDefinition) => boolean): ToolRegistry {
    const sub = new ToolRegistry({
      metrics: this.metrics,
      security: this.security,
    });
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
    opts: InvokeOptions = {}
  ): AsyncIterable<ToolEvent> {
    const callStack = opts.callStack ?? [];
    return this.runInvocation(name, input, ctx, callStack, undefined);
  }

  private async *runInvocation(
    name: string,
    input: unknown,
    baseCtx: Omit<ToolContext, "invoke" | "callStack">,
    callStack: readonly string[],
    inheritedSecurityState: InvocationSecurityState | undefined
  ): AsyncIterable<ToolEvent> {
    const tool = this.tools.get(name);
    if (!tool) {
      this.metrics.onInvocation({
        tool: name,
        durationMs: 0,
        outcome: "error",
        errorCode: "TOOL_NOT_FOUND",
      });
      yield toolNotFound(name);
      return;
    }

    if (callStack.includes(name)) {
      const message = `Cycle detected: ${[...callStack, name].join(" -> ")}`;
      this.metrics.onInvocation({
        tool: name,
        durationMs: 0,
        outcome: "error",
        errorCode: "CYCLE",
      });
      yield { type: "error", code: "CYCLE", message };
      return;
    }

    const start = performance.now();
    const childStack = Object.freeze([...callStack, name]);
    let securityState = inheritedSecurityState;
    if (baseCtx.auth && !securityState) {
      try {
        const auth = captureAuthContext(baseCtx.auth);
        securityState = {
          requestId: (this.security.requestId ?? defaultRequestId)(),
          securityContextKey: securityContextKey({
            principal: auth.principal,
          }),
          auth,
        };
      } catch (error) {
        const code =
          callStack.length === 0 ? "TOOL_NOT_FOUND" : "AUTHORIZATION_DENIED";
        this.metrics.onInvocation({
          tool: name,
          durationMs: performance.now() - start,
          outcome: "error",
          errorCode: code,
        });
        yield code === "TOOL_NOT_FOUND"
          ? toolNotFound(name)
          : {
              type: "error",
              code,
              message: "Invalid authenticated principal",
            };
        baseCtx.log.error("registry security principal validation failed", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
        return;
      }
    }
    const auth = securityState?.auth;

    if (auth && securityState && callStack.length === 0) {
      const resource = toolAuthorizationResource(tool);
      const decision = await authorizeSafely(auth, {
        action: "tool.discover",
        resource,
        callStack: childStack,
      });
      const receipt: AuthSecurityReceipt = {
        ...securityReceiptBase(
          auth,
          securityState,
          (this.security.now ?? defaultNow)()
        ),
        kind: "authorization",
        action: "tool.discover",
        resource: redactAuthzResource(resource),
        toolName: tool.name,
        outcome: decision.outcome,
        reason: decision.reason,
        ...(decision.policyId === undefined
          ? {}
          : { policyId: decision.policyId }),
      };
      const audited = await writeAudit(this.security, receipt, baseCtx.log);
      if (decision.outcome === "deny") {
        this.metrics.onInvocation({
          tool: name,
          durationMs: performance.now() - start,
          outcome: "error",
          errorCode: "TOOL_NOT_FOUND",
        });
        yield toolNotFound(name);
        return;
      }
      if (!audited) {
        this.metrics.onInvocation({
          tool: name,
          durationMs: performance.now() - start,
          outcome: "error",
          errorCode: "AUTH_AUDIT_FAILED",
        });
        yield {
          type: "error",
          code: "AUTH_AUDIT_FAILED",
          message: "Mandatory authorization audit failed",
        };
        return;
      }
    }

    let outcome: InvocationMetric["outcome"] = "ok";
    let errorCode: string | undefined;

    let validated: Awaited<ReturnType<typeof validateToolInput>>;
    try {
      validated = await validateToolInput(tool, input);
    } catch (error) {
      this.metrics.onInvocation({
        tool: name,
        durationMs: performance.now() - start,
        outcome: "error",
        errorCode: "INVALID_INPUT",
      });
      yield {
        type: "error",
        code: "INVALID_INPUT",
        message: "Input validation failed",
        details: [
          {
            message:
              error instanceof Error ? error.message : "input validator threw",
          },
        ],
      };
      return;
    }
    if (validated.issues) {
      outcome = "error";
      errorCode = "INVALID_INPUT";
      this.metrics.onInvocation({
        tool: name,
        durationMs: performance.now() - start,
        outcome,
        errorCode,
      });
      yield {
        type: "error",
        code: errorCode,
        message: "Input validation failed",
        details: validated.issues,
      };
      return;
    }

    const approval =
      resolveApproval(tool.approval, validated.value) ??
      DEFAULT_AUTHENTICATED_APPROVAL;
    const resource = toolAuthorizationResource(tool, approval);
    let relatedResources: readonly AuthzResource[] | undefined;

    if (auth && securityState && tool.authorizationResource?.required) {
      let resolved: AuthzResource | null = null;
      try {
        resolved = this.security.resourceResolver
          ? await this.security.resourceResolver.resolve({
              principal: auth.principal,
              tool,
              input: validated.value,
              callStack: childStack,
            })
          : null;
      } catch (error) {
        baseCtx.log.error("registry authorization resource resolution failed", {
          tool: tool.name,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }

      if (!validateResolvedResource(tool.authorizationResource, resolved)) {
        const receipt: AuthSecurityReceipt = {
          ...securityReceiptBase(
            auth,
            securityState,
            (this.security.now ?? defaultNow)()
          ),
          kind: "authorization",
          action: "tool.invoke",
          resource: redactAuthzResource(resource),
          toolName: tool.name,
          outcome: "deny",
          reason: "Required authorization resource could not be resolved",
        };
        const audited = await writeAudit(this.security, receipt, baseCtx.log);
        const code = audited ? "AUTH_RESOURCE_UNRESOLVED" : "AUTH_AUDIT_FAILED";
        this.metrics.onInvocation({
          tool: name,
          durationMs: performance.now() - start,
          outcome: "error",
          errorCode: code,
        });
        yield {
          type: "error",
          code,
          message: audited
            ? "Required authorization resource could not be resolved"
            : "Mandatory authorization audit failed",
        };
        return;
      }
      relatedResources = [resolved];
    }

    if (auth && securityState) {
      const decision = await authorizeSafely(auth, {
        action: "tool.invoke",
        resource,
        ...(relatedResources === undefined ? {} : { relatedResources }),
        input: validated.value,
        callStack: childStack,
      });
      const receipt: AuthSecurityReceipt = {
        ...securityReceiptBase(
          auth,
          securityState,
          (this.security.now ?? defaultNow)()
        ),
        kind: "authorization",
        action: "tool.invoke",
        resource: redactAuthzResource(resource),
        ...(relatedResources === undefined
          ? {}
          : {
              relatedResources: relatedResources.map(redactAuthzResource),
            }),
        toolName: tool.name,
        outcome: decision.outcome,
        reason: decision.reason,
        ...(decision.policyId === undefined
          ? {}
          : { policyId: decision.policyId }),
      };
      const audited = await writeAudit(this.security, receipt, baseCtx.log);
      if (!audited) {
        this.metrics.onInvocation({
          tool: name,
          durationMs: performance.now() - start,
          outcome: "error",
          errorCode: "AUTH_AUDIT_FAILED",
        });
        yield {
          type: "error",
          code: "AUTH_AUDIT_FAILED",
          message: "Mandatory authorization audit failed",
        };
        return;
      }
      if (decision.outcome === "deny") {
        this.metrics.onInvocation({
          tool: name,
          durationMs: performance.now() - start,
          outcome: "error",
          errorCode: "AUTHORIZATION_DENIED",
        });
        yield {
          type: "error",
          code: "AUTHORIZATION_DENIED",
          message: decision.reason,
        };
        return;
      }

      const approvalProvider = this.security.approvalProvider;
      const approvalEnforced = this.security.approvalMode !== "bypass";
      if (
        approvalEnforced &&
        (approvalProvider !== undefined || approval.tier !== "read")
      ) {
        let approvalDecision: ApprovalDecision;
        if (!approvalProvider) {
          approvalDecision = {
            outcome: "denied",
            reason: "Approval provider not configured",
          };
        } else {
          try {
            const candidate = await approvalProvider.decide({
              principal: auth.principal,
              tool,
              input: validated.value,
              resource,
              ...(relatedResources === undefined ? {} : { relatedResources }),
              approval,
            });
            if (isApprovalDecision(candidate)) {
              approvalDecision = candidate;
            } else {
              baseCtx.log.error(
                "registry approval provider returned an invalid decision",
                { tool: tool.name }
              );
              approvalDecision = {
                outcome: "denied",
                reason: "Approval provider returned an invalid decision",
              };
            }
          } catch (error) {
            baseCtx.log.error("registry approval provider failed", {
              tool: tool.name,
              errorType: error instanceof Error ? error.name : "UnknownError",
            });
            approvalDecision = {
              outcome: "denied",
              reason: "Approval provider failed",
            };
          }
        }

        const approvalReceipt: AuthSecurityReceipt = {
          ...securityReceiptBase(
            auth,
            securityState,
            (this.security.now ?? defaultNow)()
          ),
          kind: "approval",
          ...(approvalDecision.approvalRequestId === undefined
            ? {}
            : {
                approvalRequestId: approvalDecision.approvalRequestId,
              }),
          toolName: tool.name,
          approvalTier: approval.tier,
          outcome: approvalDecision.outcome,
          reason: approvalDecision.reason ?? "approved",
          ...(approvalDecision.outcome === "approved" &&
          approvalDecision.grantId !== undefined
            ? { grantId: approvalDecision.grantId }
            : {}),
          ...(approvalDecision.outcome === "approved" &&
          approvalDecision.grantScope !== undefined
            ? { grantScope: approvalDecision.grantScope }
            : {}),
        };
        const approvalAudited = await writeAudit(
          this.security,
          approvalReceipt,
          baseCtx.log
        );
        if (!approvalAudited) {
          this.metrics.onInvocation({
            tool: name,
            durationMs: performance.now() - start,
            outcome: "error",
            errorCode: "AUTH_AUDIT_FAILED",
          });
          yield {
            type: "error",
            code: "AUTH_AUDIT_FAILED",
            message: "Mandatory approval audit failed",
          };
          return;
        }

        if (approvalDecision.outcome === "denied") {
          this.metrics.onInvocation({
            tool: name,
            durationMs: performance.now() - start,
            outcome: "error",
            errorCode: "APPROVAL_DENIED",
          });
          yield {
            type: "error",
            code: "APPROVAL_DENIED",
            message: approvalDecision.reason,
            ...(approvalDecision.approvalRequestId === undefined
              ? {}
              : {
                  details: {
                    approvalRequestId: approvalDecision.approvalRequestId,
                  },
                }),
          };
          return;
        }

        if (approvalDecision.outcome === "required") {
          this.metrics.onInvocation({
            tool: name,
            durationMs: performance.now() - start,
            outcome: "error",
            errorCode: "APPROVAL_REQUIRED",
          });
          yield {
            type: "error",
            code: "APPROVAL_REQUIRED",
            message: "Approval required",
            details: {
              requestId: securityState.requestId,
              approvalRequestId: approvalDecision.approvalRequestId,
              toolName: tool.name,
              approvalTier: approval.tier,
              reason: approvalDecision.reason,
              resource: redactAuthzResource(resource),
              ...(relatedResources === undefined
                ? {}
                : {
                    relatedResources:
                      redactAuthorizationResources(relatedResources),
                  }),
              ...(approvalDecision.expiresAt === undefined
                ? {}
                : { expiresAt: approvalDecision.expiresAt }),
            },
          };
          return;
        }
      }
    }

    // Strip `input` (duplex stream) when invoking children: a parent's input
    // belongs to the parent. If a tool wants to forward, it muxes explicitly.
    const { input: _parentInput, ...childBase } = baseCtx;
    const fullCtx: ToolContext = {
      ...baseCtx,
      ...(auth === undefined ? {} : { auth }),
      callStack: childStack,
      invoke: (childName, childInput) =>
        this.runInvocation(
          childName,
          childInput,
          childBase,
          childStack,
          securityState
        ),
    };

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
              yield {
                type: "error",
                code: errorCode,
                message: "Tool execution aborted",
              };
              await iter.return?.(undefined);
              return;
            }
            if (next.done) break;

            const event = next.value;

            if (
              event.type === "result" &&
              tool.output &&
              tool.validateOutput &&
              tool.validateOutput !== "off"
            ) {
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
                fullCtx.log.warn("Output validation failed (lax)", {
                  issues: v.issues,
                });
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
          yield {
            type: "error",
            code: errorCode,
            message: "Tool execution aborted",
          };
          return;
        }
        const r = result as { data: unknown; display?: unknown };
        if (
          tool.output &&
          tool.validateOutput &&
          tool.validateOutput !== "off"
        ) {
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
            fullCtx.log.warn("Output validation failed (lax)", {
              issues: v.issues,
            });
          }
        }
        yield {
          type: "result",
          data: r.data,
          display: r.display as ToolEvent extends { display?: infer D }
            ? D
            : never,
        };
      }
    } catch (err) {
      outcome = "error";
      if (err instanceof ToolError) {
        errorCode = err.code;
        yield {
          type: "error",
          code: err.code,
          message: err.message,
          details: err.details,
        };
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

let requestSequence = 0;

function defaultRequestId(): string {
  requestSequence += 1;
  return `auth-${Date.now().toString(36)}-${requestSequence.toString(36)}`;
}

function defaultNow(): string {
  return new Date().toISOString();
}

function toolNotFound(name: string): ToolEvent {
  return {
    type: "error",
    code: "TOOL_NOT_FOUND",
    message: `No such tool: ${name}`,
  };
}

async function authorizeSafely(
  auth: AuthContext,
  request: Parameters<AuthContext["authorize"]>[0]
): Promise<AuthorizationDecision> {
  try {
    const decision = await auth.authorize(request);
    if (
      decision &&
      (decision.outcome === "allow" || decision.outcome === "deny") &&
      typeof decision.reason === "string"
    ) {
      return decision;
    }
    return {
      outcome: "deny",
      reason: "Authorization policy returned an invalid decision",
    };
  } catch {
    return {
      outcome: "deny",
      reason: "Authorization policy failed",
    };
  }
}

function isApprovalDecision(value: unknown): value is ApprovalDecision {
  if (!value || typeof value !== "object") return false;
  const decision = value as Record<string, unknown>;
  const optionalString = (field: string): boolean =>
    decision[field] === undefined || typeof decision[field] === "string";
  if (!optionalString("reason") || !optionalString("approvalRequestId")) {
    return false;
  }
  if (decision.outcome === "approved") {
    return (
      optionalString("grantId") &&
      (decision.grantScope === undefined ||
        decision.grantScope === "persistent" ||
        decision.grantScope === "session")
    );
  }
  if (decision.outcome === "denied") {
    return typeof decision.reason === "string";
  }
  if (decision.outcome === "required") {
    return (
      typeof decision.reason === "string" &&
      typeof decision.approvalRequestId === "string" &&
      optionalString("expiresAt")
    );
  }
  return false;
}

function securityReceiptBase(
  auth: AuthContext,
  state: InvocationSecurityState,
  timestamp: string
): SecurityReceiptBase {
  const principal = auth.principal;
  const delegation = principal.delegation;
  return {
    requestId: state.requestId,
    principalId: principal.id,
    securityContextKey: state.securityContextKey,
    subjectIssuer: principal.identity.issuer,
    subjectId: principal.identity.subject,
    ...(delegation === undefined
      ? {}
      : {
          actorIssuer: delegation.actor.issuer,
          actorSubject: delegation.actor.subject,
          actorId: delegation.actorId,
          ...(delegation.actorSessionId === undefined
            ? {}
            : { actorSessionId: delegation.actorSessionId }),
        }),
    ...(principal.tenantId === undefined
      ? {}
      : { tenantId: principal.tenantId }),
    ...(principal.workspaceId === undefined
      ? {}
      : { workspaceId: principal.workspaceId }),
    timestamp,
  };
}

async function writeAudit(
  security: ToolRegistrySecurityOptions,
  receipt: AuthSecurityReceipt,
  log: Logger
): Promise<boolean> {
  if (!security.auditSink) return security.mandatoryAudit !== true;
  try {
    await security.auditSink.write(receipt);
    return true;
  } catch (error) {
    log.error("registry security audit failed", {
      kind: receipt.kind,
      requestId: receipt.requestId,
      errorType: error instanceof Error ? error.name : "UnknownError",
    });
    return security.mandatoryAudit !== true;
  }
}

async function validateToolInput(tool: ToolDefinition, input: unknown) {
  return tool.input["~standard"].validate(input);
}

const ABORTED = Symbol("aborted");

function raceAbort<T>(
  p: Promise<T>,
  signal: AbortSignal
): Promise<T | typeof ABORTED> {
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
      }
    );
  });
}

function isAsyncIterable(x: unknown): x is AsyncIterable<unknown> {
  return (
    x != null &&
    typeof (x as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] ===
      "function"
  );
}

// Convenience for adapters: build a base context.
export function makeBaseContext(
  overrides: Partial<Omit<ToolContext, "invoke" | "callStack">> = {}
): Omit<ToolContext, "invoke" | "callStack"> {
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
    ...(overrides.scope === undefined ? {} : { scope: overrides.scope }),
    ...(overrides.input === undefined ? {} : { input: overrides.input }),
    ...(overrides.notify === undefined ? {} : { notify: overrides.notify }),
    ...(overrides.host === undefined ? {} : { host: overrides.host }),
    ...(overrides.auth === undefined ? {} : { auth: overrides.auth }),
  };
}
