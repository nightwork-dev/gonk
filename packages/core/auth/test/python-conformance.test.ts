import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  decodeTrustedEnvelope,
  encodeTrustedEnvelope,
  isAuthenticatedPrincipal,
  persistentGrantKey,
  redactAuthzResource,
  securityContextKey,
  TrustedEnvelopeError,
} from "../src/index.ts";
import { assertFresh } from "../../../../scripts/python-auth-conformance.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const corpusPath = resolve(root, "conformance/auth/cases.json");

describe("Python @gonk/auth conformance corpus", () => {
  it("is fresh against the TypeScript source implementation", () => {
    expect(() => assertFresh(corpusPath)).not.toThrow();
  });

  it("replays every language-neutral case in TypeScript", () => {
    const corpus = JSON.parse(readFileSync(corpusPath, "utf8")) as {
      keyCases: Array<Record<string, any>>;
      keyRelations: Array<Record<string, any>>;
      envelopeCases: Array<Record<string, any>>;
      validationCases: Array<Record<string, any>>;
      validationRawCases: Array<Record<string, any>>;
      redactionCases: Array<Record<string, any>>;
      malformedEnvelopeCases: Array<Record<string, any>>;
    };
    expect(corpus.keyCases.length, "auth corpus keyCases must not be empty").toBeGreaterThan(0);
    expect(corpus.keyRelations.length, "auth corpus keyRelations must not be empty").toBeGreaterThan(0);
    expect(corpus.envelopeCases.length, "auth corpus envelopeCases must not be empty").toBeGreaterThan(0);
    expect(corpus.validationCases.length, "auth corpus validationCases must not be empty").toBeGreaterThan(0);
    expect(corpus.validationRawCases.length, "auth corpus validationRawCases must not be empty").toBeGreaterThan(0);
    expect(corpus.redactionCases.length, "auth corpus redactionCases must not be empty").toBeGreaterThan(0);
    expect(corpus.malformedEnvelopeCases.length, "auth corpus malformedEnvelopeCases must not be empty").toBeGreaterThan(0);
    for (const testCase of corpus.keyCases) {
      expect(securityContextKey({ principal: testCase.principal }), `case ${testCase.name}`).toBe(
        testCase.securityContextKey
      );
      expect(persistentGrantKey({ principal: testCase.principal }), `case ${testCase.name}`).toBe(
        testCase.persistentGrantKey
      );
    }
    const keyCases = new Map(corpus.keyCases.map((testCase) => [testCase.name, testCase]));
    for (const relation of corpus.keyRelations) {
      const from = keyCases.get(relation.from)!;
      const to = keyCases.get(relation.to)!;
      expect(from.securityContextKey === to.securityContextKey, `case ${relation.name}`).toBe(
        relation.securitySame
      );
      expect(from.persistentGrantKey === to.persistentGrantKey, `case ${relation.name}`).toBe(
        relation.persistentSame
      );
    }
    for (const testCase of corpus.envelopeCases) {
      expect(JSON.parse(encodeTrustedEnvelope(testCase.input)), `case ${testCase.name}`).toEqual(
        JSON.parse(testCase.encoded)
      );
      expect(decodeTrustedEnvelope(testCase.encoded), `case ${testCase.name}`).toEqual(testCase.decoded);
    }
    for (const testCase of corpus.validationCases) {
      expect(isAuthenticatedPrincipal(testCase.value), `case ${testCase.name}`).toBe(testCase.valid);
    }
    for (const testCase of corpus.validationRawCases) {
      expect(isAuthenticatedPrincipal(JSON.parse(testCase.raw)), `case ${testCase.name}`).toBe(
        testCase.valid
      );
    }
    for (const testCase of corpus.redactionCases) {
      expect(redactAuthzResource(testCase.resource), `case ${testCase.name}`).toEqual(testCase.redacted);
    }
    for (const testCase of corpus.malformedEnvelopeCases) {
      try {
        decodeTrustedEnvelope(testCase.raw);
        expect.unreachable();
      } catch (error) {
        expect(error, `case ${testCase.name}`).toBeInstanceOf(TrustedEnvelopeError);
        expect((error as TrustedEnvelopeError).code, `case ${testCase.name}`).toBe(testCase.errorCode);
      }
    }
  });
});
