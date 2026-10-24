"""Errors emitted by the native Python tool registry."""

from __future__ import annotations


class ToolError(Exception):
    """A handler error with a stable client-visible code."""

    def __init__(self, code: str, message: str, details: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.details = details


ERROR_CODES = {
    "TOOL_NOT_FOUND": "TOOL_NOT_FOUND",
    "INVALID_INPUT": "INVALID_INPUT",
    "OUTPUT_INVALID": "OUTPUT_INVALID",
    "ABORTED": "ABORTED",
    "CYCLE": "CYCLE",
    "AUTH_REQUIRED": "AUTH_REQUIRED",
    "AUTHORIZATION_DENIED": "AUTHORIZATION_DENIED",
    "AUTH_RESOURCE_UNRESOLVED": "AUTH_RESOURCE_UNRESOLVED",
    "APPROVAL_REQUIRED": "APPROVAL_REQUIRED",
    "APPROVAL_DENIED": "APPROVAL_DENIED",
    "INTERNAL": "INTERNAL",
}

