"""Internal neutral replay handlers shared by the Python conformance tests."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any, cast

from gonk.auth import AuthContext

from gonk.tool_registry import (
    ToolDefinition,
    ToolError,
    ToolRegistry,
    ValidationResult,
    passthrough,
)


class ReplayAuth:
    def __init__(self, malformed: bool = False) -> None:
        principal: dict[str, Any] = {
            "id": "replay-principal",
            "kind": "human",
            "identity": {"issuer": "replay", "subject": "replay", "method": "session"},
            "roles": [],
            "scopes": [],
        }
        self.context = AuthContext(principal=principal, authorize=self.authorize)
        self.malformed = malformed

    def authorize(self, request: Any) -> Any:
        del request
        if self.malformed:
            return {"allowed": True}
        return {"outcome": "allow", "reason": "replay"}


class _RequireText:
    def validate(self, value: Any) -> ValidationResult:
        if isinstance(value, dict) and isinstance(cast(dict[str, Any], value).get("text"), str):
            return ValidationResult.ok(value)
        return ValidationResult.invalid({"message": "text required"})


async def _stream_handler(_value: Any, _ctx: Any):
    yield {"type": "progress", "message": "working"}
    yield {"type": "result", "data": {"streamed": True}}


async def _multi_stream_handler(_value: Any, _ctx: Any):
    yield {"type": "result", "data": {"n": 1}}
    yield {"type": "result", "data": {"n": 2}}


async def _flaky_stream_handler(_value: Any, _ctx: Any):
    yield {"type": "result", "data": {"partial": True}}
    yield {"type": "error", "code": "INTERNAL", "message": "actually it blew up"}


async def _async_echo(value: dict[str, str], _ctx: Any):
    await asyncio.sleep(0)
    return {"data": {"echoed": value["text"]}}


def _approval_required(_request: Any) -> dict[str, str]:
    return {
        "outcome": "required",
        "reason": "replay approval",
        "approvalRequestId": "approval-replay",
        "expiresAt": "2026-10-07T00:00:00Z",
    }


def _approval_malformed_grant(_request: Any) -> dict[str, str]:
    return {"outcome": "approved", "grantScope": "invalid"}


def _approval_required_missing_id(_request: Any) -> dict[str, str]:
    return {"outcome": "required", "reason": "replay approval"}


def _approval_null_grant_scope(_request: Any) -> dict[str, Any]:
    return {"outcome": "approved", "grantScope": None}


def _approval_null_request_id(_request: Any) -> dict[str, Any]:
    return {"outcome": "denied", "reason": "replay approval", "approvalRequestId": None}


def _approval_null_reason(_request: Any) -> dict[str, Any]:
    return {"outcome": "required", "reason": None, "approvalRequestId": "approval-replay"}


def build_replay_registry(security: dict[str, Any] | None = None) -> ToolRegistry:
    registry = ToolRegistry(
        security=security,
        approvalMode="bypass" if security is None else "enforce",
    )
    registry.register(
        [
            ToolDefinition(
                "echo",
                "echo",
                _RequireText(),
                lambda value, _ctx: {"data": {"echoed": value["text"]}},
            ),
            ToolDefinition("async-echo", "async echo", _RequireText(), _async_echo),
            ToolDefinition("stream", "stream", passthrough(), _stream_handler),
            ToolDefinition("multi-stream", "multi stream", passthrough(), _multi_stream_handler),
            ToolDefinition("flaky-stream", "flaky stream", passthrough(), _flaky_stream_handler),
            ToolDefinition(
                "approval",
                "approval",
                passthrough(),
                lambda _value, _ctx: {"data": {"approved": True}},
                approval="write",
            ),
            ToolDefinition(
                "boom",
                "boom",
                passthrough(),
                lambda _value, _ctx: (_ for _ in ()).throw(ToolError("BOOM", "kaboom")),
            ),
        ]
    )
    return registry


async def replay_fixture(path: Path) -> dict[str, Any]:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    cases: list[dict[str, Any]] = []
    for case in fixture["cases"]:
        approval_case = case["tool"] == "approval"
        security: dict[str, Any] = {"approvalMode": "bypass"}
        if approval_case:
            security = {
                "requestId": lambda: "request-replay",
                "approvalProvider": {
                    "malformed-grant": _approval_malformed_grant,
                    "required-missing-id": _approval_required_missing_id,
                    "null-grant-scope": _approval_null_grant_scope,
                    "null-request-id": _approval_null_request_id,
                    "null-reason": _approval_null_reason,
                }.get(case.get("approvalDecision"), _approval_required),
            }
        registry = build_replay_registry(None if not approval_case else security)
        bound = registry.withPrincipal(ReplayAuth(case.get("auth") == "malformed").context)
        events = [event async for event in bound.invoke(case["tool"], case["input"])]
        cases.append({"id": case["id"], "events": events})
    return {"version": fixture["version"], "cases": cases}
