"""Generic subprocess fixture used by the MCP adapter tests."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Mapping
from pathlib import Path
from typing import Any, cast

from gonk.auth import AuthContext, AuthorizationDecision, AuthorizationRequest, ownerPrincipal
from gonk.tool_registry import ToolDefinition, ToolRegistry, json_schema_validator

from gonk.mcp import run_stdio_sync

_auth_principal: dict[str, Any] | None = None


def build_registry() -> ToolRegistry:
    registry = ToolRegistry(approvalMode="bypass")
    registry.register(
        ToolDefinition(
            name="write-result",
            description="Write a text result to a host supplied file.",
            input=json_schema_validator(_text_schema()),
            inputJsonSchema=_text_schema(),
            handler=write_result,
            capabilities={"writesFs": True},
            approval="write",
        )
    )
    registry.register(
        ToolDefinition(
            name="progress-result",
            description="Emit progress before returning a result.",
            input=json_schema_validator(
                {"type": "object", "properties": {}, "additionalProperties": False}
            ),
            inputJsonSchema={"type": "object", "properties": {}, "additionalProperties": False},
            handler=progress_result,
        )
    )
    registry.register(
        ToolDefinition(
            name="long-result",
            description="Run until the caller cancels the operation.",
            input=json_schema_validator(_text_schema()),
            inputJsonSchema=_text_schema(),
            handler=long_result,
            capabilities={"longRunning": True},
        )
    )
    registry.register(
        ToolDefinition(
            name="empty-result",
            description="Produce no terminal result.",
            input=json_schema_validator(_empty_schema()),
            inputJsonSchema=_empty_schema(),
            handler=empty_result,
        )
    )
    registry.register(
        ToolDefinition(
            name="multi-result",
            description="Produce two terminal results.",
            input=json_schema_validator(_empty_schema()),
            inputJsonSchema=_empty_schema(),
            handler=multi_result,
        )
    )
    registry.register(
        ToolDefinition(
            name="result-then-error",
            description="Produce a result followed by an error.",
            input=json_schema_validator(_empty_schema()),
            inputJsonSchema=_empty_schema(),
            handler=result_then_error,
        )
    )
    registry.register(
        ToolDefinition(
            name="scalar-echo",
            description="Echo a scalar input.",
            input=json_schema_validator({"type": "string"}),
            inputJsonSchema={"type": "string"},
            handler=scalar_echo,
        )
    )
    registry.register(
        ToolDefinition(
            name="array-echo",
            description="Echo an array input.",
            input=json_schema_validator({"type": "array", "items": {"type": "string"}}),
            inputJsonSchema={"type": "array", "items": {"type": "string"}},
            handler=array_echo,
        )
    )
    registry.register(
        ToolDefinition(
            name="unicode-echo",
            description="Echo text with an exact two-scalar length.",
            input=json_schema_validator(
                {
                    "type": "object",
                    "properties": {
                        "text": {"type": "string", "minLength": 2, "maxLength": 2}
                    },
                    "required": ["text"],
                    "additionalProperties": False,
                }
            ),
            inputJsonSchema={
                "type": "object",
                "properties": {
                    "text": {"type": "string", "minLength": 2, "maxLength": 2}
                },
                "required": ["text"],
                "additionalProperties": False,
            },
            handler=unicode_echo,
        )
    )
    registry.register(
        ToolDefinition(
            name="mutate-auth",
            description="Mutate the fixture principal for the next request.",
            input=json_schema_validator(_empty_schema()),
            inputJsonSchema=_empty_schema(),
            handler=mutate_auth,
        )
    )
    registry.register(
        ToolDefinition(
            name="read-auth",
            description="Return the current request principal phase.",
            input=json_schema_validator(_empty_schema()),
            inputJsonSchema=_empty_schema(),
            handler=read_auth,
        )
    )
    return registry


def _text_schema() -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {"path": {"type": "string"}, "text": {"type": "string"}},
        "required": ["path", "text"],
        "additionalProperties": False,
    }


def _empty_schema() -> dict[str, Any]:
    return {"type": "object", "properties": {}, "additionalProperties": False}


async def write_result(value: dict[str, str], _ctx: Any) -> dict[str, Any]:
    path = Path(value["path"])
    path.write_text(value["text"], encoding="utf-8")
    return {"data": {"path": str(path), "text": value["text"]}, "display": value["text"]}


async def progress_result(_value: dict[str, Any], _ctx: Any) -> AsyncIterator[dict[str, Any]]:
    yield {"type": "progress", "percent": 25, "message": "started"}
    await asyncio.sleep(0)
    yield {"type": "progress", "percent": 100, "message": "finished"}
    yield {"type": "result", "data": {"ok": True}}


async def empty_result(_value: dict[str, Any], _ctx: Any) -> AsyncIterator[dict[str, Any]]:
    if False:
        yield {"type": "result", "data": None}


async def multi_result(_value: dict[str, Any], _ctx: Any) -> AsyncIterator[dict[str, Any]]:
    yield {"type": "result", "data": {"step": 1}, "display": "first", "metadata": {"old": True}}
    yield {"type": "result", "data": {"step": 2}}


async def result_then_error(_value: dict[str, Any], _ctx: Any) -> AsyncIterator[dict[str, Any]]:
    yield {"type": "result", "data": {"step": 1}}
    yield {"type": "error", "code": "FIXTURE_ERROR", "message": "fixture failure"}


async def scalar_echo(value: str, _ctx: Any) -> str:
    return value


async def array_echo(value: list[str], _ctx: Any) -> list[str]:
    return value


async def unicode_echo(value: dict[str, str], _ctx: Any) -> dict[str, str]:
    return {"text": value["text"]}


async def mutate_auth(_value: dict[str, Any], _ctx: Any) -> dict[str, Any]:
    if _auth_principal is None:
        raise RuntimeError("fixture auth is not initialized")
    attributes = _auth_principal.setdefault("attributes", {})
    if isinstance(attributes, dict):
        attributes["phase"] = "changed"
    return {"data": {"phase": "changed"}}


async def read_auth(_value: dict[str, Any], ctx: Any) -> dict[str, Any]:
    principal = ctx.auth.principal
    attributes = principal.get("attributes", {})
    phase = (
        cast(Mapping[str, Any], attributes).get("phase")
        if isinstance(attributes, Mapping)
        else None
    )
    return {"data": {"phase": phase}}


async def long_result(value: dict[str, str], ctx: Any) -> AsyncIterator[dict[str, Any]]:
    marker = Path(value["path"])
    started = marker.with_suffix(marker.suffix + ".started")
    cleaned = marker.with_suffix(marker.suffix + ".cleaned")
    started.write_text("started", encoding="utf-8")
    try:
        while True:
            if getattr(ctx.signal, "aborted", False):
                return
            await asyncio.sleep(0.02)
            yield {"type": "progress", "percent": 1, "message": "working"}
    finally:
        cleaned.write_text("cleaned", encoding="utf-8")


def deny_auth() -> AuthContext:
    def authorize(request: Any) -> AuthorizationDecision:
        del request
        return {"outcome": "deny", "reason": "fixture policy"}

    return AuthContext(principal=ownerPrincipal({"USER": "fixture"}).principal, authorize=authorize)


def mutable_auth(env: dict[str, str | None]) -> AuthContext:
    global _auth_principal
    _auth_principal = dict(ownerPrincipal(env).principal)
    _auth_principal["attributes"] = {"phase": "initial"}

    def authorize(request: AuthorizationRequest) -> AuthorizationDecision:
        if "resource" not in request or dict(request["resource"]).get("kind") != "tool":
            return {"outcome": "deny", "reason": "expected a tool resource"}
        if request.get("action") not in {"tool.discover", "tool.invoke"}:
            return {"outcome": "deny", "reason": "unsupported action"}
        return {"outcome": "allow", "reason": "fixture policy"}

    return AuthContext(principal=_auth_principal, authorize=authorize)


if __name__ == "__main__":
    auth = (
        deny_auth()
        if os.environ.get("GONK_TEST_DENY") == "1"
        else mutable_auth(dict(os.environ))
    )
    registry = ToolRegistry() if os.environ.get("GONK_TEST_EMPTY") == "1" else build_registry()
    run_stdio_sync(registry, auth)
