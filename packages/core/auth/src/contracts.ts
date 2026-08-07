// =============================================================================
// @gonk/auth/contracts — the client-safe subset (GR-84 part b).
//
// Types and pure functions only, re-exported from the same source files the
// full `.` entry uses (`./types.ts`, `./envelope.ts`) — never copied
// declarations. Deliberately excludes `./security.ts`'s Node-touching
// surface (`captureAuthContext`, `securityContextKey`, `persistentGrantKey`,
// `ownerPrincipal`) — a browser/UI consumer that wants the SHAPE of a
// principal, an authorization decision, or a security receipt gets it here
// without pulling in node:crypto/node:os.
//
// Verified by `scripts/check-client-safe-contracts.mjs`: a fixture tsconfig
// with `types: []` and no Node builtins compiles an import of this file's
// source directly (not the built dist) — so a Node import added HERE, or to
// anything it transitively imports, fails that check immediately.
// =============================================================================

export type {
  AuthAuditSink,
  AuthClaimRecord,
  AuthClaimValue,
  AuthContext,
  AuthSecurityReceipt,
  AuthenticatedIdentity,
  AuthenticatedPrincipal,
  AuthenticationMethod,
  Authenticator,
  AuthorizationDecision,
  AuthorizationOutcome,
  AuthorizationReceipt,
  AuthorizationRequest,
  AuthzAction,
  AuthzResource,
  AuthzResourceKind,
  AuthzScope,
  ApprovalReceipt,
  DelegationContext,
  PrincipalKeyInput,
  RedactedAuthzResource,
  SecurityReceiptBase,
  SessionBindingReceipt,
} from "./types.ts";
export { isAuthenticatedPrincipal, redactAuthzResource } from "./types.ts";

export type {
  ExecutionBinding,
  TrustedEnvelope,
  TrustedEnvelopeErrorCode,
} from "./envelope.ts";
export {
  TRUSTED_ENVELOPE_SCHEMA_VERSION,
  TrustedEnvelopeError,
  decodeTrustedEnvelope,
  encodeTrustedEnvelope,
} from "./envelope.ts";
