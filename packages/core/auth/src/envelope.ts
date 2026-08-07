// =============================================================================
// The trusted envelope codec (GR-84 part a).
//
// The portable, versioned, string-shaped representation of an
// AuthenticatedPrincipal plus its execution binding, for crossing a host seam
// that only carries strings — an attribute bag (eve), an environment
// variable, a hook's stdin payload. This IS the one trusted-envelope contract
// gonk-core ships (reconciled with Sigil IDP.1, 2026-08-07): `@gonk/eve-host`
// and other host bindings conform to this schema rather than defining their
// own; do not fork a second envelope shape elsewhere.
//
// AUTHORITY BOUNDARY — read before wiring this into a host:
// This codec is a TRANSPORT, not a trust source. `decodeTrustedEnvelope`
// reconstructs the DATA a principal claimed on the other side of the seam; it
// does not authenticate anyone and never constructs an `authorize()` policy
// (see `AuthContext` in `./types.ts` — an envelope carries no policy, only a
// principal). The host boundary that calls `decodeTrustedEnvelope` MUST
// already trust the channel the string arrived on (a signed/authenticated
// transport, a same-process handoff, a host-verified hook payload) before it
// treats the decoded principal as real. A decoded envelope handed to
// `registry.withPrincipal(...)` (`@gonk/tool-registry`) without that
// upstream trust check is exactly the "ambient owner" failure mode GR-83
// eliminated, reintroduced one layer up.
//
// Node-free by design (client-safe, GR-84 part b): only imports from
// `./types.ts`, which has no Node built-ins either. Do not add a Node import
// to this file or to `./types.ts` — see `scripts/check-client-safe-contracts.mjs`.
// =============================================================================

import {
  isAuthenticatedPrincipal,
  isRecord,
  type AuthenticatedPrincipal,
} from "./types.ts";

/** Current envelope schema version. Bump on any breaking field change and
 *  add a new decode branch — `decodeTrustedEnvelope` never guesses at an
 *  unrecognized version; see `TrustedEnvelopeError`. */
export const TRUSTED_ENVELOPE_SCHEMA_VERSION = 1;

/** Execution-binding fields carried alongside the principal — which persona
 *  is acting, which execution session it's acting within, and which resource
 *  scope the seam is bound to. All three are optional: a principal can cross
 *  a seam before any execution session exists (e.g. an initial handshake),
 *  so the envelope doesn't force a host to fabricate values it doesn't have
 *  yet. Field names intentionally mirror existing gonk-core concepts
 *  (`ScopeStore`'s session tier, `AuthzResource.target`) rather than
 *  inventing new ones. */
export interface ExecutionBinding {
  /** Stable id of the active persona, when one is bound. */
  personaId?: string;
  /** Stable id of the execution session the principal is acting within
   *  (the same shape as `ScopeEnvironment.sessionId` in `@gonk/scope`). */
  executionSessionId?: string;
  /** Reference to the resource scope this seam is bound to (the same shape
   *  as `AuthzResource.target` in `./types.ts`). */
  resourceScopeRef?: string;
}

/** The versioned, portable principal + execution-binding envelope. Plain
 *  data only — no `authorize()`, no policy, no capability to act. See the
 *  module doc's authority-boundary note. */
export interface TrustedEnvelope {
  schemaVersion: typeof TRUSTED_ENVELOPE_SCHEMA_VERSION;
  principal: AuthenticatedPrincipal;
  execution?: ExecutionBinding;
}

export type TrustedEnvelopeErrorCode =
  | "UNSUPPORTED_VERSION"
  | "MALFORMED_PAYLOAD";

/** Named error thrown by `decodeTrustedEnvelope`. Never a silent best-effort
 *  parse and never a generic `Error` — callers can `instanceof` this to
 *  distinguish "wire format changed under me" (`UNSUPPORTED_VERSION`) from
 *  "the payload isn't a valid envelope at all" (`MALFORMED_PAYLOAD`). */
export class TrustedEnvelopeError extends Error {
  readonly code: TrustedEnvelopeErrorCode;
  readonly expectedVersion?: number;
  readonly actualVersion?: unknown;

  constructor(
    code: TrustedEnvelopeErrorCode,
    message: string,
    details?: { expectedVersion?: number; actualVersion?: unknown }
  ) {
    super(message);
    this.name = "TrustedEnvelopeError";
    this.code = code;
    if (details?.expectedVersion !== undefined) {
      this.expectedVersion = details.expectedVersion;
    }
    if (details?.actualVersion !== undefined) {
      this.actualVersion = details.actualVersion;
    }
  }
}

/** Encode a principal (+ optional execution binding) as a versioned JSON
 *  string. Plain `JSON.stringify` — no base64/binary framing — because every
 *  seam this targets (attribute bags, env vars set programmatically, hook
 *  stdin) already carries arbitrary string content; adding a second encoding
 *  layer would only cost bytes and code for no seam that needs it today. */
export function encodeTrustedEnvelope(
  envelope: Omit<TrustedEnvelope, "schemaVersion">
): string {
  const payload: TrustedEnvelope = {
    schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
    principal: envelope.principal,
    ...(envelope.execution === undefined
      ? {}
      : { execution: envelope.execution }),
  };
  return JSON.stringify(payload);
}

/** Decode and strictly validate a trusted-envelope string. Throws
 *  `TrustedEnvelopeError` — never returns a partial/best-effort result and
 *  never silently drops a field. A schema-version mismatch fails loudly
 *  rather than attempting to interpret an unrecognized shape. See the module
 *  doc's authority-boundary note: this function reconstructs data, not
 *  trust — it never constructs an `authorize()`. */
export function decodeTrustedEnvelope(raw: string): TrustedEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new TrustedEnvelopeError(
      "MALFORMED_PAYLOAD",
      `Trusted envelope is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }

  if (!isRecord(parsed)) {
    throw new TrustedEnvelopeError(
      "MALFORMED_PAYLOAD",
      "Trusted envelope must decode to a JSON object"
    );
  }

  const allowedKeys = new Set(["schemaVersion", "principal", "execution"]);
  for (const key of Object.keys(parsed)) {
    if (!allowedKeys.has(key)) {
      throw new TrustedEnvelopeError(
        "MALFORMED_PAYLOAD",
        `Trusted envelope has unexpected field "${key}"`
      );
    }
  }

  if (parsed.schemaVersion !== TRUSTED_ENVELOPE_SCHEMA_VERSION) {
    throw new TrustedEnvelopeError(
      "UNSUPPORTED_VERSION",
      `Trusted envelope schema version ${JSON.stringify(
        parsed.schemaVersion
      )} is not supported; this decoder handles version ${TRUSTED_ENVELOPE_SCHEMA_VERSION} only`,
      {
        expectedVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
        actualVersion: parsed.schemaVersion,
      }
    );
  }

  if (!isAuthenticatedPrincipal(parsed.principal)) {
    throw new TrustedEnvelopeError(
      "MALFORMED_PAYLOAD",
      "Trusted envelope's principal field is not a valid AuthenticatedPrincipal"
    );
  }

  if (parsed.execution !== undefined && !isExecutionBinding(parsed.execution)) {
    throw new TrustedEnvelopeError(
      "MALFORMED_PAYLOAD",
      "Trusted envelope's execution field is not a valid ExecutionBinding"
    );
  }

  return {
    schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
    principal: parsed.principal,
    ...(parsed.execution === undefined
      ? {}
      : { execution: parsed.execution as ExecutionBinding }),
  };
}

function isExecutionBinding(value: unknown): value is ExecutionBinding {
  if (!isRecord(value)) return false;
  const allowedKeys = new Set([
    "personaId",
    "executionSessionId",
    "resourceScopeRef",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) return false;
  }
  return (
    (value.personaId === undefined || typeof value.personaId === "string") &&
    (value.executionSessionId === undefined ||
      typeof value.executionSessionId === "string") &&
    (value.resourceScopeRef === undefined ||
      typeof value.resourceScopeRef === "string")
  );
}
