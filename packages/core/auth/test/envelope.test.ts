import { describe, expect, it } from "vitest";

import {
  TRUSTED_ENVELOPE_SCHEMA_VERSION,
  TrustedEnvelopeError,
  decodeTrustedEnvelope,
  encodeTrustedEnvelope,
  type AuthenticatedPrincipal,
  type ExecutionBinding,
  type TrustedEnvelope,
} from "../src/index.ts";

function minimalPrincipal(): AuthenticatedPrincipal {
  return {
    id: "principal:minimal",
    kind: "human",
    identity: { issuer: "https://accounts.example", subject: "user-1", method: "oauth" },
    roles: [],
    scopes: [],
  };
}

function richPrincipal(): AuthenticatedPrincipal {
  return {
    id: "principal:rich",
    kind: "agent",
    identity: { issuer: "sigil:eve", subject: "agent-1", method: "custom:sigil-eve-token" },
    linkedIdentities: [
      { issuer: "https://accounts.example", subject: "user-1", method: "oauth" },
    ],
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    delegation: {
      actorKind: "agent",
      actor: { issuer: "sigil:eve", subject: "delegate-1", method: "service-token" },
      actorId: "eve-agent-1",
      actorSessionId: "session-a",
    },
    roles: ["member", "reviewer"],
    scopes: ["reviews:write"],
    expiresAt: 1_800_000_000_000,
    attributes: { source: "eve", nested: { flag: true, count: 3 } },
  };
}

describe("trusted envelope round-trip", () => {
  it("round-trips a minimal principal with no optional fields", () => {
    const encoded = encodeTrustedEnvelope({ principal: minimalPrincipal() });
    const decoded = decodeTrustedEnvelope(encoded);
    expect(decoded).toEqual({
      schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
      principal: minimalPrincipal(),
    });
  });

  it("round-trips a principal with delegation present", () => {
    const principal = richPrincipal();
    const decoded = decodeTrustedEnvelope(encodeTrustedEnvelope({ principal }));
    expect(decoded.principal).toEqual(principal);
    expect(decoded.principal.delegation).toEqual(principal.delegation);
  });

  it("round-trips a custom auth method string", () => {
    const principal: AuthenticatedPrincipal = {
      ...minimalPrincipal(),
      identity: { issuer: "test", subject: "s", method: "custom:my-provider-v2" },
    };
    const decoded = decodeTrustedEnvelope(encodeTrustedEnvelope({ principal }));
    expect(decoded.principal.identity.method).toBe("custom:my-provider-v2");
  });

  it("round-trips tenantId/workspaceId/linkedIdentities/expiresAt/attributes", () => {
    const principal = richPrincipal();
    const decoded = decodeTrustedEnvelope(encodeTrustedEnvelope({ principal }));
    expect(decoded.principal.tenantId).toBe("tenant-1");
    expect(decoded.principal.workspaceId).toBe("workspace-1");
    expect(decoded.principal.linkedIdentities).toEqual(principal.linkedIdentities);
    expect(decoded.principal.expiresAt).toBe(principal.expiresAt);
    expect(decoded.principal.attributes).toEqual(principal.attributes);
  });

  it("round-trips a fully populated execution binding", () => {
    const execution: ExecutionBinding = {
      personaId: "persona:iris",
      executionSessionId: "session-xyz",
      resourceScopeRef: "review-42",
    };
    const decoded = decodeTrustedEnvelope(
      encodeTrustedEnvelope({ principal: minimalPrincipal(), execution })
    );
    expect(decoded.execution).toEqual(execution);
  });

  it("round-trips a partially populated execution binding (some fields absent)", () => {
    const execution: ExecutionBinding = { personaId: "persona:iris" };
    const decoded = decodeTrustedEnvelope(
      encodeTrustedEnvelope({ principal: minimalPrincipal(), execution })
    );
    expect(decoded.execution).toEqual({ personaId: "persona:iris" });
  });

  it("round-trips with no execution binding at all (field entirely absent)", () => {
    const decoded = decodeTrustedEnvelope(encodeTrustedEnvelope({ principal: minimalPrincipal() }));
    expect(decoded.execution).toBeUndefined();
    expect("execution" in decoded).toBe(false);
  });

  it("decode(encode(x)) deep-equals x for every case above, generically", () => {
    const cases: TrustedEnvelope[] = [
      { schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION, principal: minimalPrincipal() },
      { schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION, principal: richPrincipal() },
      {
        schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
        principal: minimalPrincipal(),
        execution: { executionSessionId: "s-1" },
      },
    ];
    for (const envelope of cases) {
      const decoded = decodeTrustedEnvelope(encodeTrustedEnvelope(envelope));
      expect(decoded).toEqual(envelope);
    }
  });
});

describe("trusted envelope version mismatch", () => {
  it("fails loudly on a v-next payload with a named error", () => {
    const vNext = JSON.stringify({
      schemaVersion: 2,
      principal: minimalPrincipal(),
    });
    expect(() => decodeTrustedEnvelope(vNext)).toThrow(TrustedEnvelopeError);
    try {
      decodeTrustedEnvelope(vNext);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TrustedEnvelopeError);
      const envelopeError = error as TrustedEnvelopeError;
      expect(envelopeError.name).toBe("TrustedEnvelopeError");
      expect(envelopeError.code).toBe("UNSUPPORTED_VERSION");
      expect(envelopeError.expectedVersion).toBe(TRUSTED_ENVELOPE_SCHEMA_VERSION);
      expect(envelopeError.actualVersion).toBe(2);
    }
  });

  it("does not treat boolean schemaVersion true as numeric version 1", () => {
    const raw = JSON.stringify({
      schemaVersion: true,
      principal: minimalPrincipal(),
    });
    expect(() => decodeTrustedEnvelope(raw)).toThrow(TrustedEnvelopeError);
    try {
      decodeTrustedEnvelope(raw);
      expect.unreachable();
    } catch (error) {
      expect((error as TrustedEnvelopeError).code).toBe("UNSUPPORTED_VERSION");
      expect((error as TrustedEnvelopeError).actualVersion).toBe(true);
    }
  });
});

describe("trusted envelope malformed payloads — no best-effort parsing", () => {
  it("throws a named error on invalid JSON", () => {
    expect(() => decodeTrustedEnvelope("not json {")).toThrow(TrustedEnvelopeError);
  });

  it("throws when the payload is not a JSON object", () => {
    expect(() => decodeTrustedEnvelope("[1,2,3]")).toThrow(TrustedEnvelopeError);
    expect(() => decodeTrustedEnvelope('"a string"')).toThrow(TrustedEnvelopeError);
  });

  it("throws when the principal field is missing", () => {
    const raw = JSON.stringify({ schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION });
    expect(() => decodeTrustedEnvelope(raw)).toThrow(TrustedEnvelopeError);
  });

  it("throws when the principal fails validation rather than passing through unchecked", () => {
    const raw = JSON.stringify({
      schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
      principal: { id: "no-roles-or-scopes" },
    });
    try {
      decodeTrustedEnvelope(raw);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(TrustedEnvelopeError);
      expect((error as TrustedEnvelopeError).code).toBe("MALFORMED_PAYLOAD");
    }
  });

  it("throws on an unexpected top-level field rather than silently dropping it", () => {
    const raw = JSON.stringify({
      schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
      principal: minimalPrincipal(),
      unexpectedField: "smuggled",
    });
    expect(() => decodeTrustedEnvelope(raw)).toThrow(TrustedEnvelopeError);
  });

  it("throws when the execution binding has an invalid shape", () => {
    const raw = JSON.stringify({
      schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
      principal: minimalPrincipal(),
      execution: { personaId: 42 },
    });
    expect(() => decodeTrustedEnvelope(raw)).toThrow(TrustedEnvelopeError);
  });

  it("throws when the execution binding carries an unexpected field", () => {
    const raw = JSON.stringify({
      schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
      principal: minimalPrincipal(),
      execution: { personaId: "p-1", smuggled: true },
    });
    expect(() => decodeTrustedEnvelope(raw)).toThrow(TrustedEnvelopeError);
  });

  it("rejects JSON numeric overflow instead of admitting Infinity", () => {
    const raw =
      '{"schemaVersion":1,"principal":{"id":"p","kind":"human","identity":{"issuer":"issuer","subject":"subject","method":"oauth"},"roles":[],"scopes":[],"expiresAt":1e400}}';
    expect(() => decodeTrustedEnvelope(raw)).toThrow(TrustedEnvelopeError);
    try {
      decodeTrustedEnvelope(raw);
      expect.unreachable();
    } catch (error) {
      expect((error as TrustedEnvelopeError).code).toBe("MALFORMED_PAYLOAD");
    }
  });
});

describe("trusted envelope authority boundary — transport, not a trust source", () => {
  it("decoding never constructs an authorize() — the host must attach its own policy", () => {
    const decoded = decodeTrustedEnvelope(
      encodeTrustedEnvelope({ principal: richPrincipal() })
    );
    // A decoded envelope is plain data: a principal + optional execution
    // binding. It has no `authorize` function anywhere on it or on its
    // principal — constructing a real AuthContext (principal + policy) is
    // exclusively the receiving host's job, using whatever trust it has in
    // the channel the envelope arrived on.
    expect("authorize" in decoded).toBe(false);
    expect("authorize" in decoded.principal).toBe(false);
    expect(Object.keys(decoded).sort()).toEqual(["principal", "schemaVersion"]);
  });
});
