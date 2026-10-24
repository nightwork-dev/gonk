import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  TRUSTED_ENVELOPE_SCHEMA_VERSION,
  TrustedEnvelopeError,
  decodeTrustedEnvelope,
  encodeTrustedEnvelope,
  isAuthenticatedPrincipal,
  redactAuthzResource,
  persistentGrantKey,
  securityContextKey,
  type AuthzResource,
  type AuthenticatedPrincipal,
} from "../packages/core/auth/src/index.ts";

export const CONFORMANCE_PATH = resolve(
  process.env.GONK_AUTH_CONFORMANCE_PATH ?? process.cwd(),
  "conformance/auth/cases.json"
);

function minimalPrincipal(): AuthenticatedPrincipal {
  return {
    id: "principal:minimal",
    kind: "human",
    identity: {
      issuer: "https://accounts.example",
      subject: "user-1",
      method: "oauth",
    },
    roles: [],
    scopes: [],
  };
}

function richPrincipal(): AuthenticatedPrincipal {
  return {
    id: "principal:rich",
    kind: "agent",
    identity: {
      issuer: "issuer:agent",
      subject: "agent-1",
      method: "custom:agent-token",
    },
    linkedIdentities: [
      { issuer: "https://accounts.example", subject: "user-1", method: "oauth" },
    ],
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    delegation: {
      actorKind: "agent",
      actor: {
        issuer: "issuer:agent",
        subject: "delegate-1",
        method: "service-token",
      },
      actorId: "agent-1",
      actorSessionId: "session-a",
    },
    roles: ["member", "reviewer"],
    scopes: ["reviews:write"],
    expiresAt: 1_800_000_000_000,
    attributes: { source: "fixture", nested: { flag: true, count: 3 } },
  };
}

function surrogatePrincipal(): AuthenticatedPrincipal {
  return {
    ...minimalPrincipal(),
    id: "principal:surrogate",
    identity: {
      issuer: "issuer:\ud800",
      subject: "subject:\udfff",
      method: "oauth",
    },
  };
}

function errorCode(raw: string): string {
  try {
    decodeTrustedEnvelope(raw);
    return "none";
  } catch (error) {
    return error instanceof TrustedEnvelopeError ? error.code : "unknown";
  }
}

export function buildCorpus() {
  const minimal = minimalPrincipal();
  const rich = richPrincipal();
  const surrogate = surrogatePrincipal();
  const keyInputs = [
    { name: "minimal", principal: minimal },
    { name: "rich", principal: rich },
    { name: "surrogate-identifiers", principal: surrogate },
    {
      name: "rich-session-b",
      principal: {
        ...rich,
        delegation: { ...rich.delegation!, actorSessionId: "session-b" },
      },
    },
    {
      name: "rich-refreshed-claims",
      principal: {
        ...rich,
        roles: ["member", "reviewer", "admin"],
        scopes: ["reviews:write", "reviews:read"],
        expiresAt: 1_900_000_000_000,
        attributes: { refreshed: true },
      },
    },
  ];

  const envelopeInputs = [
    { name: "minimal", input: { principal: minimal } },
    { name: "rich", input: { principal: rich } },
    {
      name: "execution",
      input: {
        principal: minimal,
        execution: {
          personaId: "persona:example",
          executionSessionId: "session-1",
          resourceScopeRef: "resource-1",
        },
      },
    },
    {
      name: "partial-execution",
      input: { principal: minimal, execution: { personaId: "persona:example" } },
    },
  ];

  const malformed = [
    {
      name: "invalid-json",
      raw: "not json {",
    },
    {
      name: "unsupported-version",
      raw: JSON.stringify({ schemaVersion: 2, principal: minimal }),
    },
    {
      name: "boolean-version",
      raw: JSON.stringify({ schemaVersion: true, principal: minimal }),
    },
    {
      name: "unexpected-top-level-field",
      raw: JSON.stringify({
        schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
        principal: minimal,
        unexpectedField: true,
      }),
    },
    {
      name: "invalid-execution",
      raw: JSON.stringify({
        schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
        principal: minimal,
        execution: { personaId: 42 },
      }),
    },
  ];

  const validPrincipal = richPrincipal();
  const validationInputs: Array<{ name: string; value: unknown }> = [
    { name: "minimal", value: minimal },
    { name: "rich", value: validPrincipal },
    {
      name: "custom-method",
      value: { ...minimal, identity: { ...minimal.identity, method: "custom:passkey" } },
    },
    {
      name: "empty-actor-session",
      value: {
        ...validPrincipal,
        delegation: { ...validPrincipal.delegation!, actorSessionId: "" },
      },
    },
    {
      name: "unknown-method",
      value: { ...minimal, identity: { ...minimal.identity, method: "unregistered" } },
    },
    {
      name: "unhashable-kind",
      value: { ...minimal, kind: [] },
    },
    {
      name: "unhashable-method",
      value: { ...minimal, identity: { ...minimal.identity, method: {} } },
    },
    {
      name: "unhashable-actor-kind",
      value: { ...rich, delegation: { ...rich.delegation!, actorKind: [] } },
    },
    {
      name: "non-plain-attribute",
      value: { ...minimal, attributes: [] },
    },
    { name: "incomplete", value: { id: "incomplete" } },
  ];
  const validationRawInputs = [
    {
      name: "overflow-expiry",
      raw: '{"id":"principal:overflow","kind":"human","identity":{"issuer":"issuer","subject":"subject","method":"oauth"},"roles":[],"scopes":[],"expiresAt":1e400}',
    },
    {
      name: "overflow-claim",
      raw: '{"id":"principal:overflow","kind":"human","identity":{"issuer":"issuer","subject":"subject","method":"oauth"},"roles":[],"scopes":[],"attributes":{"score":-1e400}}',
    },
    {
      name: "overflow-integer-expiry",
      raw: `{"id":"principal:overflow","kind":"human","identity":{"issuer":"issuer","subject":"subject","method":"oauth"},"roles":[],"scopes":[],"expiresAt":1${"0".repeat(400)}}`,
    },
    {
      name: "overflow-integer-claim",
      raw: `{"id":"principal:overflow","kind":"human","identity":{"issuer":"issuer","subject":"subject","method":"oauth"},"roles":[],"scopes":[],"attributes":{"scores":[-1${"0".repeat(400)}]}}`,
    },
  ];

  const redactionInputs: Array<{ name: string; resource: AuthzResource }> = [
    {
      name: "drops-private-fields",
      resource: {
        kind: "tool",
        target: "review-1",
        tenantId: "tenant-1",
        workspaceId: "workspace-1",
        scope: "project",
        metadata: { token: "secret", documentBody: "private" },
      },
    },
    { name: "kind-only", resource: { kind: "tool" } },
  ];

  return {
    formatVersion: 1,
    generatedBy: "packages/core/auth/src/index.ts",
    schemaVersion: TRUSTED_ENVELOPE_SCHEMA_VERSION,
    keyCases: keyInputs.map(({ name, principal }) => ({
      name,
      principal,
      securityContextKey: securityContextKey({ principal }),
      persistentGrantKey: persistentGrantKey({ principal }),
    })),
    keyRelations: [
      {
        name: "actor-session-is-security-scoped",
        from: "rich",
        to: "rich-session-b",
        securitySame: false,
        persistentSame: true,
      },
      {
        name: "claims-are-outside-both-key-scopes",
        from: "rich",
        to: "rich-refreshed-claims",
        securitySame: true,
        persistentSame: true,
      },
    ],
    envelopeCases: envelopeInputs.map(({ name, input }) => {
      const encoded = encodeTrustedEnvelope(input);
      return { name, input, encoded, decoded: decodeTrustedEnvelope(encoded) };
    }),
    validationCases: validationInputs.map(({ name, value }) => ({
      name,
      value,
      valid: isAuthenticatedPrincipal(value),
    })),
    validationRawCases: validationRawInputs.map(({ name, raw }) => ({
      name,
      raw,
      valid: isAuthenticatedPrincipal(JSON.parse(raw)),
    })),
    redactionCases: redactionInputs.map(({ name, resource }) => ({
      name,
      resource,
      redacted: redactAuthzResource(resource),
    })),
    malformedEnvelopeCases: malformed.map(({ name, raw }) => ({
      name,
      raw,
      errorCode: errorCode(raw),
    })),
  };
}

export function renderCorpus(): string {
  return `${JSON.stringify(buildCorpus(), null, 2)}\n`;
}

export function writeCorpus(path = CONFORMANCE_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, renderCorpus(), "utf8");
}

export function assertFresh(path = CONFORMANCE_PATH): void {
  const current = readFileSync(path, "utf8");
  if (current !== renderCorpus()) {
    throw new Error(
      `Auth conformance corpus is stale. Run: pnpm exec vite-node scripts/python-auth-conformance.ts`
    );
  }
}

if (process.argv[1]?.endsWith("python-auth-conformance.ts") || process.argv.includes("--write")) {
  if (process.argv.includes("--check")) {
    assertFresh();
  } else {
    writeCorpus();
  }
}
