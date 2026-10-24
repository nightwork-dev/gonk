"""MCP projection for the native Python Gonk tool registry."""

from .adapter import (
    McpAdapter,
    McpAdapterOptions,
    create_mcp_server,
    run_stdio,
    run_stdio_sync,
)

__all__ = [
    "McpAdapter",
    "McpAdapterOptions",
    "create_mcp_server",
    "run_stdio",
    "run_stdio_sync",
]
