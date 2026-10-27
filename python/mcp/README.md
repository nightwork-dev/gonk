# gonk-tool-registry-mcp

`gonk-tool-registry-mcp` exposes the native Python Gonk registry through the
official Model Context Protocol SDK. Each process serves one stdio connection.
Tool schemas come from `ToolDefinition.inputJsonSchema`. Calls use the Python
registry and its bound `AuthContext`, including input validation,
authorization, streamed events, progress, and cancellation.

The host supplies the principal and policy when it creates the adapter. Each
request receives a fresh principal snapshot, and tool arguments are never
decoded as authentication data.

```python
from gonk.auth import ownerPrincipal
from gonk.mcp import McpAdapterOptions, run_stdio_sync
from gonk.tool_registry import ToolDefinition, ToolRegistry, passthrough

registry = ToolRegistry()
registry.register(
    ToolDefinition(
        name="echo",
        description="Return the supplied value.",
        input=passthrough(),
        inputJsonSchema={
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
            "additionalProperties": False,
        },
        handler=lambda value, _ctx: {"data": value},
    )
)

run_stdio_sync(
    registry,
    ownerPrincipal({"USER": "owner", "HOSTNAME": "example"}),
    McpAdapterOptions(serverName="example", serverVersion="0.1.0"),
)
```

Install it in a Python 3.12 or newer environment:

```sh
python -m pip install ./python/mcp
```

The package depends on `gonk-tool-registry`, `gonk-auth`, and the official
`mcp` SDK. The adapter delegates MCP framing to that SDK and exposes stdio.
