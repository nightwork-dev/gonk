"""Real official-SDK stdio acceptance tests for the Python adapter."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

import anyio
import pytest
from mcp import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from mcp.types import PaginatedRequestParams

FIXTURE = Path(__file__).with_name("stdio_server.py")
PYTHON_ROOT = FIXTURE.parents[2]
SOURCE_PATH = os.pathsep.join(
    str(path / "src")
    for path in (PYTHON_ROOT / "auth", PYTHON_ROOT / "tool-registry", PYTHON_ROOT / "mcp")
)


async def _session(env: dict[str, str] | None = None):
    child_env = dict(os.environ)
    child_env["PYTHONPATH"] = os.pathsep.join(
        value for value in (SOURCE_PATH, child_env.get("PYTHONPATH")) if value
    )
    if env:
        child_env.update(env)
    params = StdioServerParameters(command=sys.executable, args=[str(FIXTURE)], env=child_env)
    streams = stdio_client(params)
    read_stream, write_stream = await streams.__aenter__()
    session = ClientSession(read_stream, write_stream)
    await session.__aenter__()
    await session.initialize()
    return streams, session


async def _close(streams: Any, session: ClientSession) -> None:
    await session.__aexit__(None, None, None)
    await streams.__aexit__(None, None, None)


@pytest.mark.asyncio
async def test_discovery_valid_call_and_invalid_input(tmp_path: Path) -> None:
    streams, session = await _session()
    try:
        tools = await session.list_tools()
        names = {tool.name for tool in tools.tools}
        assert {"write-result", "progress-result", "long-result"} <= names
        write = next(tool for tool in tools.tools if tool.name == "write-result")
        assert write.input_schema["required"] == ["path", "text"]
        scalar = next(tool for tool in tools.tools if tool.name == "scalar-echo")
        assert scalar.input_schema["required"] == ["value"]
        array = next(tool for tool in tools.tools if tool.name == "array-echo")
        assert array.input_schema["properties"]["value"]["type"] == "array"

        output = tmp_path / "result.txt"
        result = await session.call_tool("write-result", {"path": str(output), "text": "ok"})
        assert result.is_error is False
        assert result.content[0].text == "ok"  # type: ignore[union-attr]
        assert output.read_text(encoding="utf-8") == "ok"

        invalid = await session.call_tool("write-result", {"path": "/tmp/missing-text"})
        assert invalid.is_error is True
        assert invalid.structured_content["error"]["code"] == "INVALID_INPUT"

        scalar_result = await session.call_tool("scalar-echo", {"value": "hello"})
        assert scalar_result.is_error is False
        assert scalar_result.structured_content is None
        assert scalar_result.content[0].text == "hello"  # type: ignore[union-attr]

        array_result = await session.call_tool("array-echo", {"value": ["one", "two"]})
        assert array_result.is_error is False
        assert array_result.structured_content is None
        assert array_result.content[0].text == '[\n  "one",\n  "two"\n]'  # type: ignore[union-attr]

        unicode_invalid = await session.call_tool("unicode-echo", {"text": "🌱"})
        assert unicode_invalid.is_error is True
        assert unicode_invalid.structured_content["error"]["code"] == "INVALID_INPUT"
        unicode_valid = await session.call_tool("unicode-echo", {"text": "ab"})
        assert unicode_valid.is_error is False
    finally:
        await _close(streams, session)


@pytest.mark.asyncio
async def test_authorization_denied_filters_discovery_and_call() -> None:
    async def call_with_env(env: dict[str, str]) -> Any:
        streams, session = await _session(env)
        try:
            tools = await session.list_tools()
            if env.get("GONK_TEST_DENY") == "1":
                assert tools.tools == []
            return await session.call_tool("write-result", {"path": "/tmp/nope", "text": "no"})
        finally:
            await _close(streams, session)

    denied = await call_with_env({"GONK_TEST_DENY": "1"})
    missing = await call_with_env({"GONK_TEST_EMPTY": "1"})
    assert denied.is_error is True
    assert missing.is_error is True
    assert denied == missing


@pytest.mark.asyncio
async def test_discovery_returns_one_complete_page() -> None:
    streams, session = await _session()
    try:
        first = await session.list_tools()
        assert first.tools
        assert first.next_cursor is None
        for cursor in ("1", "stale-cursor"):
            assert await session.list_tools(params=PaginatedRequestParams(cursor=cursor)) == first
    finally:
        await _close(streams, session)


@pytest.mark.asyncio
async def test_request_auth_snapshot_is_fresh_for_each_call() -> None:
    streams, session = await _session()
    try:
        await session.list_tools()
        changed = await session.call_tool("mutate-auth", {})
        assert changed.is_error is False
        current = await session.call_tool("read-auth", {})
        assert current.is_error is False
        assert current.structured_content == {"phase": "changed"}
    finally:
        await _close(streams, session)


@pytest.mark.asyncio
async def test_progress_forwards_the_request_progress_token() -> None:
    progress_updates: list[tuple[float, float | None, str | None]] = []

    async def on_progress(progress: float, total: float | None, message: str | None) -> None:
        progress_updates.append((progress, total, message))

    streams, session = await _session()
    try:
        result = await session.call_tool("progress-result", {}, progress_callback=on_progress)
        assert result.is_error is False
        assert progress_updates == [(25.0, 100.0, "started"), (100.0, 100.0, "finished")]
    finally:
        await _close(streams, session)


@pytest.mark.asyncio
async def test_outcome_projection_matches_registry_collector_semantics() -> None:
    streams, session = await _session()
    try:
        empty = await session.call_tool("empty-result", {})
        assert empty.is_error is True
        assert empty.structured_content["error"]["code"] == "NO_RESULT"

        multiple = await session.call_tool("multi-result", {})
        assert multiple.is_error is False
        assert multiple.structured_content == {"step": 2}
        assert multiple.meta is None
        assert multiple.content[0].text == '{\n  "step": 2\n}'  # type: ignore[union-attr]

        error_after_result = await session.call_tool("result-then-error", {})
        assert error_after_result.is_error is True
        assert error_after_result.structured_content["error"]["code"] == "FIXTURE_ERROR"
    finally:
        await _close(streams, session)


@pytest.mark.asyncio
async def test_cancellation_reaches_handler_cleanup(tmp_path: Path) -> None:
    marker = tmp_path / "operation"
    streams, session = await _session()
    try:
        async with anyio.create_task_group() as task_group:
            async def call() -> None:
                await session.call_tool("long-result", {"path": str(marker), "text": "unused"})

            task_group.start_soon(call)
            for _ in range(100):
                if marker.with_suffix(".started").exists():
                    break
                await anyio.sleep(0.01)
            task_group.cancel_scope.cancel()
        for _ in range(100):
            if marker.with_suffix(".cleaned").exists():
                break
            await anyio.sleep(0.01)
        assert marker.with_suffix(".started").exists()
        assert marker.with_suffix(".cleaned").exists()
    finally:
        await _close(streams, session)
