"""Request-boundary capture and principal-derived security keys."""

from __future__ import annotations

import base64
import getpass
import hashlib
import socket
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from .types import (
    AuthContext,
    AuthenticatedPrincipal,
    AuthorizationDecision,
    AuthorizationRequest,
    freezePlainData,
    isAuthenticatedPrincipal,
    jsonStringify,
)


def captureAuthContext(auth: AuthContext) -> AuthContext:
    if not isAuthenticatedPrincipal(auth.principal):
        raise TypeError("Authenticated principal must contain only valid plain claim data")
    if not callable(auth.authorize):
        raise TypeError("AuthContext authorize must be a function")
    principal = freezePlainData(dict(auth.principal))
    authorize = auth.authorize

    def bound(request: AuthorizationRequest):
        return authorize(request)

    return AuthContext(principal=principal, authorize=bound)


@dataclass(frozen=True)
class OwnerPrincipalOptions:
    subject: str | None = None
    issuer: str | None = None
    roles: Sequence[str] | None = None


def ownerPrincipal(
    env: Mapping[str, str | None],
    opts: OwnerPrincipalOptions | Mapping[str, Any] | None = None,
) -> AuthContext:
    options = _ownerOptions(opts)
    subject = options.subject
    if subject is None:
        subject = env.get("USER") or env.get("USERNAME") or _safeUser() or "owner"
    host = env.get("HOSTNAME") or env.get("COMPUTERNAME") or _safeHostname() or "local"
    issuer = options.issuer if options.issuer is not None else f"gonk:local:{host}"
    roles = ["owner"]
    if options.roles is not None:
        for role in options.roles:
            if role not in roles:
                roles.append(role)
    principal: dict[str, Any] = {
        "id": f"local:{issuer}:{subject}",
        "kind": "local",
        "identity": {"issuer": issuer, "subject": subject, "method": "local"},
        "roles": roles,
        "scopes": [],
    }

    def authorize(request: AuthorizationRequest) -> AuthorizationDecision:
        del request
        return cast(
            AuthorizationDecision,
            {"outcome": "allow", "reason": "owner principal — single-owner host"},
        )

    return AuthContext(principal=principal, authorize=authorize)


def securityContextKey(input: Mapping[str, Any]) -> str:
    return _principalHash("gsk", input["principal"], includeActorSession=True)


def persistentGrantKey(input: Mapping[str, Any]) -> str:
    return _principalHash("gpg", input["principal"], includeActorSession=False)


def _principalHash(
    prefix: str, principal: AuthenticatedPrincipal, *, includeActorSession: bool
) -> str:
    _validatePrincipal(principal)
    delegation = principal.get("delegation")
    payload: dict[str, Any] = {
        "version": 1,
        "subject": {
            "issuer": principal["identity"]["issuer"],
            "subject": principal["identity"]["subject"],
            "kind": principal.get("kind"),
        },
        "tenantId": principal.get("tenantId"),
        "workspaceId": principal.get("workspaceId"),
        "actor": None,
    }
    if delegation is not None:
        actor = delegation["actor"]
        actor_record: dict[str, Any] = {
            "issuer": actor["issuer"],
            "subject": actor["subject"],
            "kind": delegation["actorKind"],
            "id": delegation["actorId"],
        }
        if includeActorSession:
            actor_record["sessionId"] = delegation.get("actorSessionId")
        payload["actor"] = actor_record
    payload_json = jsonStringify(payload)
    digest = hashlib.sha256(
        f"gonk-auth:{prefix}:v1\0".encode() + payload_json.encode("utf-8")
    ).digest()
    encoded = base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")
    return f"{prefix}:v1:{encoded}"


def _validatePrincipal(principal: AuthenticatedPrincipal) -> None:
    _requireNonEmpty("principal.id", principal.get("id"))
    _requireIdentity("principal.identity", principal.get("identity"))
    delegation = principal.get("delegation")
    if delegation is not None:
        _requireIdentity("principal.delegation.actor", delegation.get("actor"))
        _requireNonEmpty("principal.delegation.actorId", delegation.get("actorId"))
        if "actorSessionId" in delegation:
            _requireNonEmpty(
                "principal.delegation.actorSessionId", delegation.get("actorSessionId")
            )


def _requireIdentity(label: str, identity: Any) -> None:
    if not isinstance(identity, Mapping):
        raise TypeError(f"{label} must be an object")
    record = cast(Mapping[str, Any], identity)
    _requireNonEmpty(f"{label}.issuer", record.get("issuer"))
    _requireNonEmpty(f"{label}.subject", record.get("subject"))
    _requireNonEmpty(f"{label}.method", record.get("method"))


def _requireNonEmpty(label: str, value: Any) -> None:
    if not isinstance(value, str) or not value.strip():
        raise TypeError(f"{label} must be a non-empty string")


def _ownerOptions(opts: OwnerPrincipalOptions | Mapping[str, Any] | None) -> OwnerPrincipalOptions:
    if opts is None:
        return OwnerPrincipalOptions()
    if isinstance(opts, OwnerPrincipalOptions):
        return opts
    return OwnerPrincipalOptions(
        subject=opts.get("subject"), issuer=opts.get("issuer"), roles=opts.get("roles")
    )


def _safeUser() -> str | None:
    try:
        return getpass.getuser()
    except (KeyError, OSError):
        return None


def _safeHostname() -> str | None:
    try:
        return socket.gethostname()
    except OSError:
        return None
