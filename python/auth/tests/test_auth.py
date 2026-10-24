from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast

import pytest

from gonk.auth import (
    AuthContext,
    AuthorizationDecision,
    AuthorizationRequest,
    TrustedEnvelopeError,
    captureAuthContext,
    decodeTrustedEnvelope,
    encodeTrustedEnvelope,
    isAuthenticatedPrincipal,
    ownerPrincipal,
    persistentGrantKey,
    redactAuthzResource,
    securityContextKey,
)

ROOT = Path(__file__).resolve().parents[3]
CORPUS = ROOT / "conformance" / "auth" / "cases.json"


def corpus() -> dict[str, Any]:
    return json.loads(CORPUS.read_text(encoding="utf-8"))


def assert_nonempty(fixture: dict[str, Any], *categories: str) -> None:
    for category in categories:
        cases = fixture.get(category)
        assert isinstance(cases, list) and cases, f"auth corpus {category} must not be empty"


def test_language_neutral_key_vectors() -> None:
    fixture = corpus()
    assert_nonempty(fixture, "keyCases", "keyRelations")
    by_name = {case["name"]: case for case in fixture["keyCases"]}
    for case in fixture["keyCases"]:
        principal = case["principal"]
        assert (
            securityContextKey({"principal": principal}) == case["securityContextKey"]
        ), case["name"]
        assert (
            persistentGrantKey({"principal": principal}) == case["persistentGrantKey"]
        ), case["name"]
    for relation in fixture["keyRelations"]:
        left = by_name[relation["from"]]
        right = by_name[relation["to"]]
        assert (left["securityContextKey"] == right["securityContextKey"]) is relation[
            "securitySame"
        ], relation["name"]
        assert (left["persistentGrantKey"] == right["persistentGrantKey"]) is relation[
            "persistentSame"
        ], relation["name"]


def test_language_neutral_envelope_vectors() -> None:
    fixture = corpus()
    assert_nonempty(fixture, "envelopeCases")
    for case in fixture["envelopeCases"]:
        assert (
            json.loads(encodeTrustedEnvelope(case["input"])) == json.loads(case["encoded"])
        ), case["name"]
        assert decodeTrustedEnvelope(case["encoded"]) == case["decoded"], case["name"]


def test_language_neutral_validation_and_redaction_vectors() -> None:
    fixture = corpus()
    assert_nonempty(
        fixture,
        "validationCases",
        "validationRawCases",
        "redactionCases",
    )
    for case in fixture["validationCases"]:
        assert isAuthenticatedPrincipal(case["value"]) is case["valid"], case["name"]
    for case in fixture["validationRawCases"]:
        assert isAuthenticatedPrincipal(json.loads(case["raw"])) is case["valid"], case["name"]
    for case in fixture["redactionCases"]:
        assert redactAuthzResource(case["resource"]) == case["redacted"], case["name"]


def test_language_neutral_malformed_envelope_vectors() -> None:
    fixture = corpus()
    assert_nonempty(fixture, "malformedEnvelopeCases")
    for case in fixture["malformedEnvelopeCases"]:
        with pytest.raises(TrustedEnvelopeError) as raised:
            decodeTrustedEnvelope(case["raw"])
        assert raised.value.code == case["errorCode"], case["name"]


def test_nonfinite_claims_are_rejected() -> None:
    principal: dict[str, Any] = {
        "id": "principal:finite",
        "kind": "human",
        "identity": {"issuer": "issuer", "subject": "subject", "method": "oauth"},
        "roles": [],
        "scopes": [],
        "expiresAt": float("nan"),
    }
    assert isAuthenticatedPrincipal(principal) is False
    with pytest.raises(TrustedEnvelopeError):
        decodeTrustedEnvelope(
            '{"schemaVersion":1,"principal":{"id":"p","kind":"human","identity":{"issuer":"i","subject":"s","method":"oauth"},"roles":[],"scopes":[],"attributes":{"n":NaN}}}'
        )


def test_unhashable_validator_fields_return_false() -> None:
    principal: dict[str, Any] = {
        "id": "principal:invalid",
        "kind": [],
        "identity": {"issuer": "issuer", "subject": "subject", "method": {}},
        "roles": [],
        "scopes": [],
        "delegation": {
            "actorKind": [],
            "actor": {"issuer": "issuer", "subject": "subject", "method": "oauth"},
            "actorId": "actor",
        },
    }
    assert isAuthenticatedPrincipal(principal) is False


def test_capture_freezes_principal_and_binds_callback() -> None:
    source: dict[str, Any] = {
        "id": "principal:mutable",
        "kind": "human",
        "identity": {"issuer": "issuer", "subject": "subject", "method": "oauth"},
        "roles": ["member"],
        "scopes": [],
        "attributes": {"nested": {"flag": True}},
    }
    context = AuthContext(
        principal=source,
        authorize=lambda request: cast(
            AuthorizationDecision, {"outcome": "allow", "reason": source["id"]}
        ),
    )
    captured = captureAuthContext(context)
    source["id"] = "principal:changed"
    source["attributes"]["nested"]["flag"] = False
    assert captured.principal["id"] == "principal:mutable"
    assert captured.principal["attributes"]["nested"]["flag"] is True
    with pytest.raises(TypeError):
        captured.principal["id"] = "overwrite"  # type: ignore[index]
    with pytest.raises(TypeError):
        captured.principal["attributes"]["nested"]["flag"] = False  # type: ignore[index]


def test_capture_supports_async_authorize() -> None:
    async def authorize(request: AuthorizationRequest) -> AuthorizationDecision:
        del request
        return cast(AuthorizationDecision, {"outcome": "allow", "reason": "async"})

    context = captureAuthContext(
        AuthContext(
            principal=ownerPrincipal({"USER": "owner", "HOSTNAME": "host"}).principal,
            authorize=authorize,
        )
    )
    result = asyncio.run(
        cast(
            Any,
            context.authorize({"action": "tool.invoke", "resource": {"kind": "tool"}}),
        )
    )
    assert result == {"outcome": "allow", "reason": "async"}


def test_owner_principal_is_deterministic_and_permissive() -> None:
    first = ownerPrincipal({"USER": "owner", "HOSTNAME": "host"})
    second = ownerPrincipal({"USER": "owner", "HOSTNAME": "host"})
    assert first.principal == second.principal
    assert first.principal["identity"] == {
        "issuer": "gonk:local:host",
        "subject": "owner",
        "method": "local",
    }
    decision = cast(
        AuthorizationDecision,
        first.authorize({"action": "tool.invoke", "resource": {"kind": "tool"}}),
    )
    assert decision.get("outcome") == "allow"
