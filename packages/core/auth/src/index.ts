// =============================================================================
// @gonk/auth — the full surface. Re-exports from the split source modules so
// the package's public API is unchanged: `./types.ts` (pure contracts),
// `./envelope.ts` (the trusted envelope codec, also pure), and
// `./security.ts` (Node-touching: hashing, request-boundary capture, the
// single-owner constructor). See `./contracts.ts` for the client-safe subset
// of this surface (types.ts + envelope.ts only, GR-84).
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

export type { OwnerPrincipalOptions } from "./security.ts";
export {
  captureAuthContext,
  ownerPrincipal,
  persistentGrantKey,
  securityContextKey,
} from "./security.ts";
