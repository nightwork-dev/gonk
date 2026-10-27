"""Versioned trusted-envelope transport codec.

Decoding reconstructs data received over a seam.  It does not authenticate
the sender or create an authorization policy.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from typing import Any, cast

from .types import isAuthenticatedPrincipal, isRecord, jsonStringify

TRUSTED_ENVELOPE_SCHEMA_VERSION = 1
_MISSING = object()


class TrustedEnvelopeError(ValueError):
    """Named failure for an unsupported or malformed envelope."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        expectedVersion: int | None = None,
        actualVersion: object = _MISSING,
    ) -> None:
        super().__init__(message)
        self.name = "TrustedEnvelopeError"
        self.code = code
        if expectedVersion is not None:
            self.expectedVersion = expectedVersion
        if actualVersion is not _MISSING:
            self.actualVersion = actualVersion


def encodeTrustedEnvelope(envelope: Mapping[str, Any]) -> str:
    payload: dict[str, Any] = {
        "schemaVersion": TRUSTED_ENVELOPE_SCHEMA_VERSION,
        "principal": _jsonValue(envelope["principal"]),
    }
    if "execution" in envelope:
        payload["execution"] = _jsonValue(envelope["execution"])
    try:
        return jsonStringify(payload)
    except (TypeError, ValueError) as error:
        raise TrustedEnvelopeError(
            "MALFORMED_PAYLOAD", f"Trusted envelope is not JSON-serializable: {error}"
        ) from error


def decodeTrustedEnvelope(raw: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw, parse_constant=_rejectNonFinite)
    except (TypeError, ValueError) as error:
        raise TrustedEnvelopeError(
            "MALFORMED_PAYLOAD", f"Trusted envelope is not valid JSON: {error}"
        ) from error

    if not isRecord(parsed):
        raise TrustedEnvelopeError(
            "MALFORMED_PAYLOAD", "Trusted envelope must decode to a JSON object"
        )
    allowed = {"schemaVersion", "principal", "execution"}
    for key in parsed:
        if key not in allowed:
            raise TrustedEnvelopeError(
                "MALFORMED_PAYLOAD", f'Trusted envelope has unexpected field "{key}"'
            )
    actual = parsed.get("schemaVersion", _MISSING)
    if (
        isinstance(actual, bool)
        or not isinstance(actual, (int, float))
        or actual != TRUSTED_ENVELOPE_SCHEMA_VERSION
    ):
        actual_display = (
            "undefined" if actual is _MISSING else json.dumps(actual, ensure_ascii=False)
        )
        raise TrustedEnvelopeError(
            "UNSUPPORTED_VERSION",
            f"Trusted envelope schema version {actual_display} is not supported; "
            f"this decoder handles version {TRUSTED_ENVELOPE_SCHEMA_VERSION} only",
            expectedVersion=TRUSTED_ENVELOPE_SCHEMA_VERSION,
            **({} if actual is _MISSING else {"actualVersion": actual}),
        )
    if not isAuthenticatedPrincipal(parsed.get("principal")):
        raise TrustedEnvelopeError(
            "MALFORMED_PAYLOAD",
            "Trusted envelope's principal field is not a valid AuthenticatedPrincipal",
        )
    if "execution" in parsed and not _isExecutionBinding(parsed["execution"]):
        raise TrustedEnvelopeError(
            "MALFORMED_PAYLOAD",
            "Trusted envelope's execution field is not a valid ExecutionBinding",
        )
    result: dict[str, Any] = {
        "schemaVersion": TRUSTED_ENVELOPE_SCHEMA_VERSION,
        "principal": parsed["principal"],
    }
    if "execution" in parsed:
        result["execution"] = parsed["execution"]
    return result


def _isExecutionBinding(value: object) -> bool:
    if not isinstance(value, Mapping):
        return False
    record = cast(Mapping[str, Any], value)
    allowed = {"personaId", "executionSessionId", "resourceScopeRef"}
    return all(key in allowed for key in record) and all(
        isinstance(record[key], str) for key in record
    )


def _jsonValue(value: Any) -> Any:
    if isinstance(value, Mapping):
        record = cast(Mapping[Any, Any], value)
        return {str(key): _jsonValue(item) for key, item in record.items()}
    if isinstance(value, (list, tuple)):
        return [_jsonValue(item) for item in cast(Sequence[Any], value)]
    return value


def _rejectNonFinite(value: str) -> Any:
    raise ValueError(f"invalid constant {value}")
