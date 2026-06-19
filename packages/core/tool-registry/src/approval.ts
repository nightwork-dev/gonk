/**
 * Tool approval tiers — a tool self-declares how dangerous it is, independent
 * of any pattern policy. Hosts (e.g. the gonk guard) map these tiers onto
 * their own gate so that UNKNOWN / MCP / custom tools fail safe.
 *
 * The contract mirrors oh-my-pi's approval axis so the two ecosystems read the
 * same way:
 *   - "read":  reads data or updates UI-only session metadata.
 *   - "write": mutates workspace/session state, no arbitrary code execution.
 *   - "exec":  executes code, shells out, drives a browser, spawns agents —
 *              the broad-blast-radius tier.
 *
 * A tool with NO declaration is treated as "exec" by any consumer that fails
 * safe. That default lives in the consumer (the guard), not here — this module
 * only resolves a declaration that IS present.
 */

/** Coarse danger class a tool declares for itself. Ordered least → most. */
export type ToolTier = "read" | "write" | "exec";

/** A resolved approval decision: a tier plus optional escalation metadata.
 *  `override: true` lets a tool force its decision to win over a host's
 *  permissive policy (e.g. bash escalating `rm -rf /` to exec even when the
 *  active mode would otherwise auto-allow). `reason` surfaces in the gate's
 *  block/warn message. */
export interface ToolApprovalObject {
  tier: ToolTier;
  override?: boolean;
  reason?: string;
}

/** What a tool declares. Bare string is shorthand for `{ tier }`. The function
 *  form is evaluated per call with the tool's own input, so a tool can pick a
 *  tier from its args (e.g. an LSP tool that's "read" for query actions and
 *  "write" for rename). */
export type ToolApprovalDecision = ToolTier | ToolApprovalObject;
export type ToolApproval =
  | ToolApprovalDecision
  | ((args: unknown) => ToolApprovalDecision);

/** Normalized form every consumer works with. `override`/`reason` are always
 *  present (defaulted) so call sites don't branch on `undefined`. */
export interface ResolvedApproval {
  tier: ToolTier;
  override: boolean;
  reason?: string;
}

const TIERS: readonly ToolTier[] = ["read", "write", "exec"];

export function isToolTier(value: unknown): value is ToolTier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** Numeric rank for tier comparison. Higher = more dangerous. */
export function tierRank(tier: ToolTier): number {
  return TIERS.indexOf(tier);
}

/**
 * Resolve a tool's `approval` declaration to a normalized decision, given the
 * call's input. Returns `undefined` when the tool declared nothing — the
 * caller decides the fail-safe default (the guard uses "exec").
 *
 * Tolerant of malformed declarations: a function that throws, or an object
 * with a bad `tier`, resolves to `undefined` rather than crashing the host —
 * a broken declaration must not take down the tool loop. The guard then treats
 * `undefined` as the most-restrictive tier, so a malformed declaration fails
 * safe rather than open.
 */
export function resolveApproval(
  approval: ToolApproval | undefined,
  args: unknown,
): ResolvedApproval | undefined {
  if (approval === undefined) return undefined;

  let decision: ToolApprovalDecision;
  if (typeof approval === "function") {
    try {
      decision = approval(args);
    } catch {
      return undefined;
    }
  } else {
    decision = approval;
  }

  if (isToolTier(decision)) {
    return { tier: decision, override: false };
  }

  if (
    decision &&
    typeof decision === "object" &&
    isToolTier((decision as ToolApprovalObject).tier)
  ) {
    const obj = decision as ToolApprovalObject;
    return {
      tier: obj.tier,
      override: obj.override === true,
      ...(typeof obj.reason === "string" ? { reason: obj.reason } : {}),
    };
  }

  return undefined;
}
