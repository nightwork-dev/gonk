"""Official MCP SDK adapter for a native Python Gonk registry.

The adapter owns the protocol boundary.  A trusted host supplies the
``AuthContext`` when it creates the adapter; each MCP request gets a fresh
principal snapshot, and request arguments never carry or decode a principal.
The SDK's low-level server is used because Gonk tool
schemas are declarations at runtime rather than Python function signatures.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
from collections.abc import AsyncIterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, cast

from gonk.auth import AuthContext, AuthorizationRequest, AuthzResource, captureAuthContext
from gonk.tool_registry import (
    BoundToolRegistry,
    CancellationSignal,
    InvokeOptions,
    ToolDefinition,
    ToolRegistry,
)

from mcp.server.context import ServerRequestContext
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server
from mcp.types import (
    CallToolRequestParams,
    CallToolResult,
    ListToolsResult,
    PaginatedRequestParams,
    TextContent,
    Tool,
)

_MISSING = object()


@dataclass(frozen=True, slots=True)
class McpAdapterOptions:
    """Trusted host settings for a local MCP server."""

    serverName: str = "gonk-python"
    serverVersion: str = "0.1.0"
    cwd: str | None = None
    env: Mapping[str, str | None] | None = None


@dataclass(slots=True)
class McpAdapter:
    """A configured official-SDK MCP server and its bound Gonk registry."""

    server: Server[Any]
    bound: BoundToolRegistry
    registry: ToolRegistry
    options: McpAdapterOptions

    async def serve_stdio(self) -> None:
        """Serve one MCP connection over the process's stdin/stdout."""

        async with stdio_server() as (read_stream, write_stream):
            await self.server.run(
                read_stream,
                write_stream,
                self.server.create_initialization_options(),
            )


def create_mcp_server(
    registry: ToolRegistry,
    auth: AuthContext,
    options: McpAdapterOptions | None = None,
) -> McpAdapter:
    """Project *registry* through the official MCP server using trusted *auth*.

    ``auth`` is intentionally a required trusted-host argument. The adapter
    snapshots it independently for discovery and each root invocation, never
    reading a principal from ``arguments`` or a tool's declared schema. The
    registry's own authorization path remains authoritative for calls;
    discovery applies the same host-supplied policy to ``tool.discover``.
    """

    adapter_options = options or McpAdapterOptions()
    bound = registry.withPrincipal(auth)

    async def list_tools(
        ctx: ServerRequestContext[Any],
        params: PaginatedRequestParams | None,
    ) -> ListToolsResult:
        del ctx, params
        request_auth = captureAuthContext(auth)
        tools: list[Tool] = []
        for definition in registry.list():
            if not _is_duplex(definition) and await _authorize_discovery(request_auth, definition):
                tools.append(_project_tool(definition))
        return ListToolsResult(tools=tools)

    async def call_tool(
        ctx: ServerRequestContext[Any],
        params: CallToolRequestParams,
    ) -> CallToolResult:
        definition = registry.get(params.name)
        if definition is None:
            return _unknown_tool_result(params.name)

        signal = CancellationSignal()
        try:
            request_bound = registry.withPrincipal(auth)
            events = request_bound.invoke(
                definition.name,
                _unwrap_projected_input(definition, params.arguments),
                InvokeOptions(
                    signal=signal,
                    cwd=adapter_options.cwd or os.getcwd(),
                    env=(
                        adapter_options.env
                        if adapter_options.env is not None
                        else dict(os.environ)
                    ),
                ),
            )
            return await _collect_events(ctx, events, params.name)
        except asyncio.CancelledError:
            # The official SDK's dispatcher cancels the handler task when it
            # receives notifications/cancelled.  Mark the registry signal as
            # well so handlers that poll it observe the same cancellation.
            signal.abort()
            raise

    server: Server[Any] = Server(
        adapter_options.serverName,
        version=adapter_options.serverVersion,
        on_list_tools=list_tools,
        on_call_tool=call_tool,
        get_tool_input_schema=lambda name: _schema_for_name(registry, name),
    )
    return McpAdapter(server=server, bound=bound, registry=registry, options=adapter_options)


async def run_stdio(
    registry: ToolRegistry,
    auth: AuthContext,
    options: McpAdapterOptions | None = None,
) -> None:
    """Create and run a local stdio adapter until the MCP connection closes."""

    await create_mcp_server(registry, auth, options).serve_stdio()


def run_stdio_sync(
    registry: ToolRegistry,
    auth: AuthContext,
    options: McpAdapterOptions | None = None,
) -> None:
    """Synchronous entry point for a small host process."""

    asyncio.run(run_stdio(registry, auth, options))


async def _collect_events(
    ctx: ServerRequestContext[Any],
    events: AsyncIterable[Mapping[str, Any]],
    requested_name: str,
) -> CallToolResult:
    result_data: Any = None
    result_display: Any = _MISSING
    metadata: Any = _MISSING
    error: dict[str, Any] | None = None
    saw_result = False

    async for event in events:
        event_type = event.get("type")
        if event_type == "progress":
            await ctx.session.report_progress(
                _number(event.get("percent"), 0),
                100,
                _optional_string(event.get("message")),
            )
        elif event_type == "log":
            # Logging is deliberately kept off stdout; MCP's SDK owns the
            # protocol stream and the host can inspect stderr if needed.
            continue
        elif event_type == "data":
            # MCP tools/call has one final result. Intermediate data events are
            # consumed here without changing the registry event contract.
            continue
        elif event_type == "result":
            saw_result = True
            result_data = event.get("data")
            result_display = _MISSING
            metadata = _MISSING
            if "display" in event:
                result_display = event["display"]
            if "metadata" in event:
                metadata = event["metadata"]
        elif event_type == "error":
            error = {
                "code": str(event.get("code", "INTERNAL")),
                "message": str(event.get("message", "Tool failed")),
            }
            if "details" in event:
                error["details"] = event["details"]

    if error is not None:
        if "details" in error:
            if error["code"] == "TOOL_NOT_FOUND":
                return _unknown_tool_result(requested_name)
            return _error_result(error["code"], error["message"], error["details"])
        if error["code"] == "TOOL_NOT_FOUND":
            return _unknown_tool_result(requested_name)
        return _error_result(error["code"], error["message"])
    if not saw_result:
        return _error_result("NO_RESULT", "Tool produced no result")

    content = _render_display(
        None if result_display is _MISSING else result_display,
        result_data,
    )
    kwargs: dict[str, Any] = {"content": content}
    if isinstance(result_data, Mapping):
        kwargs["structured_content"] = result_data
    if metadata is not _MISSING:
        kwargs["meta"] = {"gonk/tool-result-metadata": metadata}
    return CallToolResult(**kwargs)


def _unwrap_projected_input(
    definition: ToolDefinition, arguments: Mapping[str, Any] | None
) -> Any:
    schema = definition.inputJsonSchema
    if not schema or schema.get("type") == "object":
        return dict(arguments or {})
    values = arguments or {}
    if set(values) == {"value"}:
        return values["value"]
    return dict(values)


async def _authorize_discovery(auth: AuthContext, definition: ToolDefinition) -> bool:
    metadata: dict[str, Any] = {}
    authorization = definition.authorization
    if authorization is not None:
        metadata["authorization"] = authorization
    capabilities = definition.capabilities
    if capabilities is not None:
        metadata["capabilities"] = capabilities
    resource: AuthzResource = {"kind": "tool", "target": definition.name}
    if metadata:
        resource["metadata"] = metadata
    request: AuthorizationRequest = {"action": "tool.discover", "resource": resource}
    try:
        decision = auth.authorize(request)
        if inspect.isawaitable(decision):
            decision = await decision
    except Exception:
        return False
    candidate: object = cast(object, decision)
    if not isinstance(candidate, Mapping):
        return False
    decision_record = cast(Mapping[str, Any], candidate)
    return decision_record.get("outcome") == "allow" and isinstance(
        decision_record.get("reason"), str
    )


def _project_tool(definition: ToolDefinition) -> Tool:
    schema: dict[str, Any] = dict(
        definition.inputJsonSchema
        or {"type": "object", "properties": {}, "additionalProperties": True}
    )
    if not schema:
        schema = {"type": "object", "properties": {}, "additionalProperties": True}
    elif schema.get("type") != "object":
        schema = {
            "type": "object",
            "properties": {"value": dict(schema)},
            "required": ["value"],
            "additionalProperties": False,
        }
    annotations: dict[str, bool] = {}
    capabilities = definition.capabilities
    if capabilities is not None:
        if "readOnly" in capabilities:
            annotations["readOnlyHint"] = bool(capabilities["readOnly"])
        if "idempotent" in capabilities:
            annotations["idempotentHint"] = bool(capabilities["idempotent"])
        if "destructive" in capabilities:
            annotations["destructiveHint"] = bool(capabilities["destructive"])
        if "openWorld" in capabilities:
            annotations["openWorldHint"] = bool(capabilities["openWorld"])
    kwargs: dict[str, Any] = {
        "name": definition.name,
        "description": definition.description,
        "input_schema": dict(schema),
    }
    if annotations:
        kwargs["annotations"] = annotations
    return Tool(**kwargs)


def _is_duplex(definition: ToolDefinition) -> bool:
    capabilities = definition.capabilities
    return capabilities is not None and capabilities.get("duplex") is True


def _schema_for_name(registry: ToolRegistry, name: str) -> Mapping[str, Any] | None:
    definition = registry.get(name)
    if definition is None:
        return None
    projected = _project_tool(definition)
    return projected.input_schema


def _error_result(code: str, message: str, details: Any = _MISSING) -> CallToolResult:
    error: dict[str, Any] = {"code": code, "message": message}
    if details is not _MISSING:
        error["details"] = details
    text = f"Error [{code}]: {message}"
    if details is not _MISSING:
        text += f"\n{_stringify(details)}"
    return CallToolResult(
        is_error=True,
        content=[TextContent(text=text)],
        structured_content={"error": error},
    )


def _unknown_tool_result(name: str) -> CallToolResult:
    return _error_result("TOOL_NOT_FOUND", f"Unknown tool: {name}")


def _render_display(display: Any, data: Any) -> list[TextContent]:
    if display is None:
        return [TextContent(text=_stringify(data))]
    if isinstance(display, str):
        return [TextContent(text=display)]
    if isinstance(display, Sequence) and not isinstance(display, (str, bytes, bytearray)):
        content: list[TextContent] = []
        for raw_block in cast(Sequence[Any], display):
            block_value: object = raw_block
            if not isinstance(block_value, Mapping):
                content.append(TextContent(text=_stringify(block_value)))
                continue
            block = cast(Mapping[str, Any], block_value)
            kind = block.get("type")
            if kind == "text":
                content.append(TextContent(text=str(block.get("text", ""))))
            elif kind == "markdown":
                content.append(TextContent(text=str(block.get("markdown", ""))))
            elif kind == "code":
                language = str(block.get("language", ""))
                content.append(TextContent(text=f"```{language}\n{block.get('code', '')}\n```"))
            elif kind == "json":
                content.append(TextContent(text=_stringify(block.get("value"))))
            elif kind == "link":
                title = block.get("title")
                url = str(block.get("url", ""))
                content.append(TextContent(text=f"{title}: {url}" if title else url))
            else:
                content.append(TextContent(text=_stringify(block)))
        return content or [TextContent(text=_stringify(data))]
    return [TextContent(text=_stringify(display))]


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value, ensure_ascii=False, indent=2, default=str)
    except (TypeError, ValueError):
        return str(value)


def _number(value: Any, default: float) -> float:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return default


def _optional_string(value: Any) -> str | None:
    return value if isinstance(value, str) else None
