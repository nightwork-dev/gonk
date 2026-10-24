"""Local document tools over host-owned Mirk artifacts.

Install mirk-store and mirk-artifact alongside the Gonk Python packages.
The sole positional argument selects the host's storage directory.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

from gonk.auth import ownerPrincipal
from gonk.mcp import run_stdio_sync
from gonk.tool_registry import ToolContext, ToolDefinition, ToolError, ToolRegistry
from gonk.tool_registry.schema import json_schema_validator
from mirk.artifact import ArtifactCoordinator, digestStream
from mirk.artifact.fs import FileObjectStore
from mirk.artifact.store import StoreArtifactRepository
from mirk.store import SqliteStore


def main(root: Path) -> None:
    root.mkdir(parents=True, exist_ok=True)
    with SqliteStore(str(root / "metadata.sqlite")) as store:
        artifacts = ArtifactCoordinator(
            FileObjectStore(str(root / "objects")),
            StoreArtifactRepository(store, namespace="documents"),
            namespace="documents",
            concurrency={"mode": "repository-atomic"},
        )
        registry = ToolRegistry(approvalMode="bypass")
        create_schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "requestKey": {"type": "string"},
            },
            "required": ["text", "requestKey"],
            "additionalProperties": False,
        }
        read_schema: dict[str, Any] = {
            "type": "object",
            "properties": {"id": {"type": "string"}},
            "required": ["id"],
            "additionalProperties": False,
        }

        def create_document(value: dict[str, str], _ctx: ToolContext) -> dict[str, Any]:
            record = artifacts.write(
                {
                    "bytes": value["text"].encode("utf-8"),
                    "mediaType": "text/plain",
                    "idempotencyKey": value["requestKey"],
                    "producer": {"system": "document-example", "operation": "create"},
                }
            )
            return {"data": {"artifact": record}}

        def read_document(value: dict[str, str], _ctx: ToolContext) -> dict[str, Any]:
            result = artifacts.read(value["id"])
            if result is None:
                raise ToolError("NOT_FOUND", "Document does not exist")
            content = b"".join(result["bytes"])
            digest, size = digestStream(content)
            if (
                digest != result["artifact"]["digest"]
                or size != result["artifact"]["sizeBytes"]
            ):
                raise ToolError("INTEGRITY", "Document failed integrity verification")
            return {
                "data": {
                    "artifact": result["artifact"],
                    "text": content.decode("utf-8"),
                }
            }

        registry.register(
            ToolDefinition(
                name="document.create",
                description="Store a text document.",
                input=json_schema_validator(create_schema),
                inputJsonSchema=create_schema,
                handler=create_document,
                approval="write",
            )
        )
        registry.register(
            ToolDefinition(
                name="document.read",
                description="Read a verified text document.",
                input=json_schema_validator(read_schema),
                inputJsonSchema=read_schema,
                handler=read_document,
                approval="read",
            )
        )
        # This example serves one trusted local process over stdio.
        auth = ownerPrincipal({"USER": "document-example", "HOSTNAME": "local"})
        run_stdio_sync(registry, auth)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: artifact_documents.py STORAGE_DIRECTORY")
    main(Path(sys.argv[1]).resolve())
