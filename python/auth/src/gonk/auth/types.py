"""Shared authentication records and structural validators.

The records in this module use the camelCase field names of the TypeScript
wire contract.  They intentionally remain ordinary mappings at boundaries so
that a host can pass them through JSON without an adapter-specific schema.
"""

from __future__ import annotations

import json
import math
from collections.abc import Awaitable, Mapping, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Protocol, TypedDict, TypeGuard, cast

AuthClaimValue = type(None) | str | int | float | bool | list[Any] | dict[str, Any]
AuthClaimRecord = Mapping[str, AuthClaimValue]
AuthenticatedPrincipal = Mapping[str, Any]


class AuthenticatedIdentity(TypedDict):
    issuer: str
    subject: str
    method: str


class DelegationContext(TypedDict, total=False):
    actorKind: str
    actor: AuthenticatedIdentity
    actorId: str
    actorSessionId: str


class AuthzResource(TypedDict, total=False):
    kind: str
    target: str
    scope: str
    tenantId: str
    workspaceId: str
    metadata: Any


class RedactedAuthzResource(TypedDict, total=False):
    kind: str
    target: str
    tenantId: str
    workspaceId: str


class AuthorizationRequest(TypedDict, total=False):
    action: str
    resource: AuthzResource
    relatedResources: list[AuthzResource]
    input: Any
    callStack: list[str]


class AuthorizationDecision(TypedDict, total=False):
    outcome: str
    reason: str
    policyId: str
    resource: AuthzResource


AuthorizeResult = Mapping[str, Any] | Awaitable[Mapping[str, Any]]


@dataclass(frozen=True)
class AuthContext:
    """A principal and its host-owned authorization callback.

    ``AuthContext`` is a small frozen record.  The principal supplied by a
    caller may be an ordinary mutable mapping; use :func:`captureAuthContext`
    at a request boundary to obtain a deep immutable snapshot.
    """

    principal: Mapping[str, Any]
    authorize: AuthzCallback


class AuthzCallback(Protocol):
    def __call__(self, request: AuthorizationRequest) -> AuthorizeResult: ...


class Authenticator(Protocol):
    def authenticate(
        self, request: Any
    ) -> AuthenticatedPrincipal | Awaitable[AuthenticatedPrincipal | None] | None: ...


class PrincipalKeyInput(TypedDict):
    principal: AuthenticatedPrincipal


def isRecord(value: Any) -> TypeGuard[Mapping[str, Any]]:
    """Return whether *value* is a mapping-shaped wire record."""

    return isinstance(value, Mapping)


def isAuthenticationMethod(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    if value in {
        "session",
        "oauth",
        "service-token",
        "api-key",
        "mtls",
        "tailnet",
        "transport-account",
        "local",
    }:
        return True
    return value.startswith("custom:") and len(value) > len("custom:")


def isAuthenticatedIdentity(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    record = cast(Mapping[str, Any], value)
    issuer = record.get("issuer")
    subject = record.get("subject")
    return (
        isinstance(issuer, str)
        and bool(issuer.strip())
        and isinstance(subject, str)
        and bool(subject.strip())
        and isAuthenticationMethod(record.get("method"))
    )


def isDelegationContext(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    record = cast(Mapping[str, Any], value)
    actor_kind = record.get("actorKind")
    actor_id = record.get("actorId")
    actor_session = record.get("actorSessionId")
    return (
        isinstance(actor_kind, str) and actor_kind in {"agent", "service"}
        and isAuthenticatedIdentity(record.get("actor"))
        and isinstance(actor_id, str)
        and bool(actor_id.strip())
        and (
            "actorSessionId" not in record
            or (isinstance(actor_session, str) and bool(actor_session.strip()))
        )
    )


def isPrincipalKind(value: Any) -> bool:
    return isinstance(value, str) and value in {"human", "agent", "service", "local"}


def _is_finite_number(value: Any) -> bool:
    if isinstance(value, bool):
        return False
    if isinstance(value, int):
        try:
            return math.isfinite(float(value))
        except OverflowError:
            return False
    return isinstance(value, float) and math.isfinite(value)


def isPlainClaimData(value: Any) -> bool:
    """Validate JSON-like claim data, including finite-number semantics."""

    if value is None or isinstance(value, (str, bool)):
        return True
    if _is_finite_number(value):
        return True
    if isinstance(value, (list, tuple)):
        return all(isPlainClaimData(item) for item in cast(Sequence[Any], value))
    if isinstance(value, Mapping):
        mapping = cast(Mapping[Any, Any], value)
        return all(isinstance(key, str) and isPlainClaimData(item) for key, item in mapping.items())
    return False


def isAuthenticatedPrincipal(value: Any) -> bool:
    if not isinstance(value, Mapping):
        return False
    record = cast(Mapping[str, Any], value)
    if (
        not isinstance(record.get("id"), str)
        or not isPrincipalKind(record.get("kind"))
        or not isAuthenticatedIdentity(record.get("identity"))
        or not _string_sequence(record.get("roles"))
        or not _string_sequence(record.get("scopes"))
    ):
        return False
    linked = record.get("linkedIdentities")
    if "linkedIdentities" in record:
        if not _sequence(linked):
            return False
        if not all(isAuthenticatedIdentity(item) for item in cast(list[Any], linked)):
            return False
    for key in ("tenantId", "workspaceId"):
        if key in record and not isinstance(record[key], str):
            return False
    if "expiresAt" in record:
        expires = record["expiresAt"]
        if not _is_finite_number(expires):
            return False
    attributes = record.get("attributes")
    if "attributes" in record and (
        not isinstance(attributes, Mapping) or not isPlainClaimData(attributes)
    ):
        return False
    delegation = record.get("delegation")
    return "delegation" not in record or isDelegationContext(delegation)


def redactAuthzResource(resource: Mapping[str, Any]) -> dict[str, Any]:
    """Return the attributable resource projection without metadata or scope."""

    result: dict[str, Any] = {"kind": resource["kind"]}
    for key in ("target", "tenantId", "workspaceId"):
        if key in resource:
            result[key] = resource[key]
    return result


def _sequence(value: Any) -> bool:
    return isinstance(value, (list, tuple))


def _string_sequence(value: Any) -> bool:
    return _sequence(value) and all(isinstance(item, str) for item in cast(Sequence[Any], value))


def freezePlainData(value: Any) -> Any:
    """Copy JSON-like data into immutable mappings and tuples."""

    if isinstance(value, Mapping):
        raw_mapping = cast(Mapping[Any, Any], value)
        frozen: dict[str, Any] = {}
        for key, item in raw_mapping.items():
            if not isinstance(key, str):
                raise TypeError("Authenticated principal claims must contain only plain data")
            frozen[key] = freezePlainData(item)
        return MappingProxyType(frozen)
    if isinstance(value, (list, tuple)):
        return tuple(freezePlainData(item) for item in cast(Sequence[Any], value))
    if not isPlainClaimData(value):
        raise TypeError("Authenticated principal claims must contain only plain data")
    return value


def jsonStringify(value: Any) -> str:
    """Serialize JSON with the well-formed Unicode behavior of JSON.stringify."""

    serialized = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    result: list[str] = []
    index = 0
    while index < len(serialized):
        codepoint = ord(serialized[index])
        if 0xD800 <= codepoint <= 0xDBFF:
            if index + 1 < len(serialized):
                next_codepoint = ord(serialized[index + 1])
                if 0xDC00 <= next_codepoint <= 0xDFFF:
                    combined = 0x10000 + ((codepoint - 0xD800) << 10) + (next_codepoint - 0xDC00)
                    result.append(chr(combined))
                    index += 2
                    continue
            result.append(f"\\u{codepoint:04x}")
        elif 0xDC00 <= codepoint <= 0xDFFF:
            result.append(f"\\u{codepoint:04x}")
        else:
            result.append(serialized[index])
        index += 1
    return "".join(result)
