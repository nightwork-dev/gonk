from __future__ import annotations

from typing import Any, cast

import pytest

from gonk.auth import (
    AuthContext,
    AuthorizationDecision,
    TrustedEnvelopeError,
    captureAuthContext,
    decodeTrustedEnvelope,
    encodeTrustedEnvelope,
    isAuthenticatedPrincipal,
    isPlainClaimData,
)


def test_captured_principal_can_be_validated_and_recaptured_without_mutation_leaks() -> None:
    source: dict[str, Any] = {
        "id": "principal:snapshot",
        "kind": "agent",
        "identity": {"issuer": "issuer", "subject": "subject", "method": "oauth"},
        "roles": ["member", "reviewer"],
        "scopes": ["read:records"],
        "linkedIdentities": [
            {"issuer": "issuer:linked", "subject": "linked", "method": "service-token"}
        ],
        "attributes": {
            "labels": ["one", "two"],
            "nested": {"flags": [True, False]},
        },
    }
    context = AuthContext(
        principal=source,
        authorize=lambda request: cast(
            AuthorizationDecision, {"outcome": "allow", "reason": "snapshot"}
        ),
    )

    captured = captureAuthContext(context)
    source["roles"].append("mutated")
    source["linkedIdentities"][0]["subject"] = "changed"
    source["attributes"]["labels"].append("mutated")
    source["attributes"]["nested"]["flags"][0] = False

    assert isAuthenticatedPrincipal(captured.principal)
    assert captured.principal["roles"] == ("member", "reviewer")
    assert captured.principal["scopes"] == ("read:records",)
    assert captured.principal["linkedIdentities"][0]["subject"] == "linked"
    assert captured.principal["attributes"]["labels"] == ("one", "two")
    assert captured.principal["attributes"]["nested"]["flags"] == (True, False)

    recaptured = captureAuthContext(captured)
    assert recaptured.principal == captured.principal
    assert isAuthenticatedPrincipal(recaptured.principal)
    with pytest.raises(TypeError):
        recaptured.principal["roles"] += ("overwrite",)  # type: ignore[index]
    with pytest.raises(TypeError):
        recaptured.principal["attributes"]["nested"]["flags"][0] = True  # type: ignore[index]


def test_python_integers_beyond_js_finite_range_are_rejected_at_boundaries() -> None:
    principals: list[dict[str, Any]] = [
        {
            "id": "principal:huge-expiry",
            "kind": "human",
            "identity": {"issuer": "issuer", "subject": "subject", "method": "oauth"},
            "roles": [],
            "scopes": [],
            "expiresAt": 10**400,
        },
        {
            "id": "principal:huge-claim",
            "kind": "human",
            "identity": {"issuer": "issuer", "subject": "subject", "method": "oauth"},
            "roles": [],
            "scopes": [],
            "attributes": {"nested": {"huge": 10**400}},
        },
    ]
    for principal in principals:
        assert isAuthenticatedPrincipal(principal) is False
        with pytest.raises(TypeError):
            captureAuthContext(
                AuthContext(
                    principal=principal,
                    authorize=lambda request: cast(
                        AuthorizationDecision, {"outcome": "allow", "reason": "snapshot"}
                    ),
                )
            )
        encoded = encodeTrustedEnvelope({"principal": principal})
        with pytest.raises(TrustedEnvelopeError):
            decodeTrustedEnvelope(encoded)

    ordinary_large = dict(principals[0])
    ordinary_large["id"] = "principal:large-finite"
    ordinary_large["expiresAt"] = 10**300
    assert isAuthenticatedPrincipal(ordinary_large)
    assert isPlainClaimData({"large": 10**300, "boolean": True})

    boolean_expiry = dict(ordinary_large)
    boolean_expiry["expiresAt"] = True
    assert isAuthenticatedPrincipal(boolean_expiry) is False
