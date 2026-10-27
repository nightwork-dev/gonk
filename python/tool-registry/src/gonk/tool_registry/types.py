"""Public Python contracts for the native tool registry."""

from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from .schema import ValidatorLike


class _NullLogger:
    def debug(self, message: str, meta: object | None = None) -> None: ...
    def info(self, message: str, meta: object | None = None) -> None: ...
    def warn(self, message: str, meta: object | None = None) -> None: ...
    def error(self, message: str, meta: object | None = None) -> None: ...


@dataclass(frozen=True, slots=True)
class InvokeOptions:
    """Optional per-call host controls accepted by ``BoundToolRegistry.invoke``."""

    signal: Any | None = None
    log: Any | None = None
    cwd: str | None = None
    env: Mapping[str, str | None] | None = None
    callStack: tuple[str, ...] = ()


@dataclass(slots=True)
class CancellationSignal:
    """Small asyncio cancellation signal usable by hosts and tests."""

    _event: asyncio.Event = field(default_factory=asyncio.Event)

    @property
    def aborted(self) -> bool:
        return self._event.is_set()

    def abort(self) -> None:
        self._event.set()

    async def wait(self) -> None:
        await self._event.wait()


@dataclass(slots=True)
class ToolContext:
    signal: Any
    log: Any
    cwd: str
    env: Mapping[str, str | None]
    auth: Any
    callStack: list[str] = field(default_factory=list[str])
    invoke: Callable[[str, Any], AsyncIterable[dict[str, Any]]] | None = None

    @property
    def call_stack(self) -> list[str]:
        return self.callStack


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    name: str
    description: str
    input: ValidatorLike
    handler: Callable[[Any, ToolContext], Any]
    output: ValidatorLike | None = None
    inputJsonSchema: Mapping[str, Any] | None = None
    validateOutput: str = "off"
    approval: Any = None
    authorization: Mapping[str, Any] | None = None
    authorizationResource: Mapping[str, Any] | None = None
    requires: Callable[[], bool] | None = None
    capabilities: Mapping[str, Any] | None = None
    visibility: str | None = None
    category: str | None = None
    tags: tuple[str, ...] = ()


type ToolEvent = dict[str, Any]
type ToolResult = Mapping[str, Any]


def default_context(auth: Any | None) -> ToolContext:
    return ToolContext(
        signal=CancellationSignal(),
        log=_NullLogger(),
        cwd=os.getcwd(),
        env=dict(os.environ),
        auth=auth,
    )
