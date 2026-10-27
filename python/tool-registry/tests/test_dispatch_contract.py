from __future__ import annotations

import unittest
from collections.abc import AsyncIterable, Mapping
from typing import Any

from gonk.auth import AuthContext, AuthorizationDecision, AuthorizationRequest, captureAuthContext

from gonk.tool_registry import (
    ToolContext,
    ToolDefinition,
    ToolEvent,
    ToolRegistry,
    passthrough,
)


async def collect(events: AsyncIterable[ToolEvent]) -> list[ToolEvent]:
    return [event async for event in events]


class DispatchContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_registered_dispatch_uses_auth_wire_records_and_preserves_empty_env(self) -> None:
        requests: list[dict[str, Any]] = []
        handler_context: list[ToolContext] = []

        principal: dict[str, Any] = {
            "id": "principal:contract",
            "kind": "human",
            "identity": {
                "issuer": "contract",
                "subject": "contract",
                "method": "session",
            },
            "roles": [],
            "scopes": [],
        }

        def authorize(request: AuthorizationRequest) -> AuthorizationDecision:
            request_keys = set(request.keys())
            request_record = dict(request)
            resource = request.get("resource")
            if not isinstance(resource, Mapping):
                raise TypeError("authorization resource must be a mapping")
            self.assertEqual(dict(resource), request_record["resource"])
            self.assertIn("action", request_keys)
            self.assertIn("resource", request_keys)
            requests.append(request_record)
            return {"outcome": "allow", "reason": "contract"}

        registry = ToolRegistry(approvalMode="bypass")

        def handler(_value: Any, context: ToolContext) -> dict[str, str]:
            handler_context.append(context)
            return {"data": "ok"}

        registry.register(ToolDefinition("contract", "contract", passthrough(), handler))
        auth = captureAuthContext(AuthContext(principal=principal, authorize=authorize))

        events = await collect(
            registry.withPrincipal(auth).invoke("contract", {}, {"env": {}})
        )

        self.assertEqual(events, [{"type": "result", "data": "ok"}])
        self.assertEqual(len(requests), 2)
        self.assertEqual({request["action"] for request in requests}, {"tool.discover", "tool.invoke"})
        self.assertIsInstance(requests[0]["resource"], Mapping)
        self.assertEqual(handler_context[0].env, {})
        principal["id"] = "principal:changed"
        self.assertEqual(handler_context[0].auth.principal["id"], "principal:contract")
        self.assertEqual(handler_context[0].auth.principal["roles"], ())


if __name__ == "__main__":
    unittest.main()
