from __future__ import annotations

import asyncio
import unittest
from collections.abc import AsyncIterable, Callable
from typing import Any, cast

from gonk.auth import AuthContext, AuthorizationRequest

from gonk.tool_registry import (
    CancellationSignal,
    ToolContext,
    ToolDefinition,
    ToolError,
    ToolEvent,
    ToolRegistry,
    ValidationResult,
    passthrough,
)


def bind(registry: ToolRegistry, auth: Any):
    return registry.withPrincipal(cast(AuthContext, auth))


class Auth:
    def __init__(self, decision: Callable[[Any], Any] | None = None) -> None:
        self.principal: dict[str, Any] = {
            "id": "principal:test",
            "kind": "human",
            "identity": {"issuer": "test", "subject": "test", "method": "session"},
            "roles": [],
            "scopes": [],
        }
        self.requests: list[Any] = []
        self.decision: Callable[[Any], Any] = decision or allow_decision

    async def authorize(self, request: AuthorizationRequest) -> Any:
        self.requests.append(request)
        value = self.decision(request)
        if asyncio.iscoroutine(value):
            return await value
        return value


class RequireText:
    def validate(self, value: Any) -> ValidationResult:
        if isinstance(value, dict) and isinstance(cast(dict[str, Any], value).get("text"), str):
            return ValidationResult.ok(value)
        return ValidationResult.invalid({"message": "text required"})


class RejectOutput:
    def validate(self, value: Any) -> ValidationResult:
        return ValidationResult.invalid({"message": "output rejected"})


def allow_decision(_request: Any) -> dict[str, str]:
    return {"outcome": "allow", "reason": "ok"}


async def collect(events: AsyncIterable[ToolEvent]) -> list[ToolEvent]:
    return [event async for event in events]


def identity_handler(value: Any, _ctx: ToolContext) -> dict[str, Any]:
    return {"data": value}


def record_started(started: list[Any], value: Any, _ctx: ToolContext) -> None:
    started.append(value)


def record_child_started(started: list[Any], _value: Any, _ctx: ToolContext) -> None:
    started.append(True)


def bad_output_handler(_value: Any, _ctx: ToolContext) -> dict[str, Any]:
    return {"data": {"unexpected": True}}


def boom_handler(_value: Any, _ctx: ToolContext) -> Any:
    raise ToolError("BOOM", "kaboom")


def deny_decision(_request: Any) -> dict[str, str]:
    return {"outcome": "deny", "reason": "forbidden"}


def child_decision(request: AuthorizationRequest) -> dict[str, str]:
    resource = request.get("resource")
    target = resource.get("target") if resource is not None else None
    return {
        "outcome": "deny" if target == "child" else "allow",
        "reason": "child denied" if target == "child" else "ok",
    }


class ToolRegistryTests(unittest.IsolatedAsyncioTestCase):
    async def test_native_sync_async_and_generator_handlers(self):
        registry = ToolRegistry(approvalMode="bypass")
        registry.register(
            [
                ToolDefinition("sync", "sync", passthrough(), identity_handler),
                ToolDefinition("async", "async", passthrough(), self.async_result),
                ToolDefinition("stream", "stream", passthrough(), self.stream_result),
            ]
        )
        bound = bind(registry, Auth())
        self.assertEqual((await collect(bound.invoke("sync", {"n": 1})))[-1], {"type": "result", "data": {"n": 1}})
        self.assertEqual((await collect(bound.invoke("async", {})))[-1], {"type": "result", "data": {"async": True}})
        self.assertEqual(
            await collect(bound.invoke("stream", {})),
            [
                {"type": "progress", "message": "started"},
                {"type": "result", "data": {"stream": True}},
            ],
        )

    async def async_result(self, _value: Any, _ctx: ToolContext) -> dict[str, dict[str, bool]]:
        await asyncio.sleep(0)
        return {"data": {"async": True}}

    async def stream_result(self, _value: Any, _ctx: ToolContext) -> AsyncIterable[ToolEvent]:
        yield {"type": "progress", "message": "started"}
        yield {"type": "result", "data": {"stream": True}}

    async def test_auth_and_input_rejections_do_not_start_handler(self):
        started: list[Any] = []
        auth = Auth(deny_decision)
        registry = ToolRegistry(approvalMode="bypass")
        registry.register(
            ToolDefinition(
                "blocked",
                "blocked",
                RequireText(),
                lambda value, ctx: record_started(started, value, ctx),
            )
        )
        denied = await collect(bind(registry, auth).invoke("blocked", {"text": "x"}))
        self.assertEqual(denied, [{"type": "error", "code": "TOOL_NOT_FOUND", "message": "No such tool: blocked"}])
        self.assertEqual(started, [])

        allow = Auth()
        invalid = await collect(bind(registry, allow).invoke("blocked", {"wrong": True}))
        self.assertEqual(invalid[0]["code"], "INVALID_INPUT")
        self.assertEqual(started, [])

    async def test_bound_root_captures_a_fresh_immutable_auth_snapshot_each_call(self):
        seen: list[Any] = []
        auth = Auth()
        registry = ToolRegistry(approvalMode="bypass")

        async def inspect_auth(_value: Any, ctx: ToolContext) -> dict[str, Any]:
            seen.append(list(ctx.auth.principal["roles"]))
            return {"data": True}

        registry.register(ToolDefinition("inspect-auth", "inspect auth", passthrough(), inspect_auth))
        bound = bind(registry, auth)
        await collect(bound.invoke("inspect-auth", {}))
        auth.principal["roles"].append("changed")
        await collect(bound.invoke("inspect-auth", {}))
        self.assertEqual(seen, [[], ["changed"]])

    async def test_malformed_allowed_only_authorization_decision_fails_closed(self):
        started: list[Any] = []
        auth = Auth(lambda _request: {"allowed": True})
        registry = ToolRegistry(approvalMode="bypass")
        registry.register(
            ToolDefinition(
                "malformed-policy",
                "malformed policy",
                passthrough(),
                lambda value, ctx: record_started(started, value, ctx),
            )
        )
        events = await collect(bind(registry, auth).invoke("malformed-policy", {}))
        self.assertEqual(events[0]["code"], "TOOL_NOT_FOUND")
        self.assertEqual(started, [])
        auth.decision = lambda _request: {"outcome": [], "reason": "malformed"}
        events = await collect(bind(registry, auth).invoke("malformed-policy", {}))
        self.assertEqual(events[0]["code"], "TOOL_NOT_FOUND")
        self.assertEqual(started, [])

    async def test_nested_authorization_is_rechecked_and_denied_child_does_not_run(self):
        child_started: list[Any] = []
        auth = Auth(child_decision)
        registry = ToolRegistry(approvalMode="bypass")

        async def parent(_value: Any, ctx: ToolContext) -> dict[str, dict[str, Any]]:
            assert ctx.invoke is not None
            child_events = [event async for event in ctx.invoke("child", {})]
            return {"data": {"childCode": child_events[0]["code"]}}

        registry.register(
            [
                ToolDefinition("parent", "parent", passthrough(), parent),
                ToolDefinition(
                    "child",
                    "child",
                    passthrough(),
                    lambda value, ctx: record_child_started(child_started, value, ctx),
                ),
            ]
        )
        events = await collect(bind(registry, auth).invoke("parent", {}))
        self.assertEqual(events[-1], {"type": "result", "data": {"childCode": "AUTHORIZATION_DENIED"}})
        self.assertEqual(child_started, [])
        self.assertEqual(auth.requests[-1]["callStack"], ["parent", "child"])

    async def test_cancelled_await_and_generator_cleanup_emit_one_terminal_error(self):
        signal = CancellationSignal()
        await_cleanup: list[bool] = []
        generator_cleanup: list[bool] = []
        registry = ToolRegistry(approvalMode="bypass")

        async def waiting(_value: Any, _ctx: ToolContext) -> dict[str, str]:
            try:
                await asyncio.Event().wait()
            finally:
                await_cleanup.append(True)
            return {"data": "late"}

        async def looping(_value: Any, _ctx: ToolContext) -> AsyncIterable[ToolEvent]:
            try:
                yield {"type": "progress", "message": "working"}
                await asyncio.Event().wait()
            finally:
                generator_cleanup.append(True)

        registry.register(
            [
                ToolDefinition("waiting", "waiting", passthrough(), waiting),
                ToolDefinition("looping", "looping", passthrough(), looping),
            ]
        )
        bound = bind(registry, Auth())

        waiting_task = asyncio.create_task(collect(bound.invoke("waiting", {}, {"signal": signal})))
        await asyncio.sleep(0)
        signal.abort()
        waiting_events = await waiting_task
        self.assertEqual([event["code"] for event in waiting_events if event["type"] == "error"], ["ABORTED"])
        self.assertEqual(await_cleanup, [True])

        signal = CancellationSignal()
        stream_task = asyncio.create_task(collect(bound.invoke("looping", {}, {"signal": signal})))
        await asyncio.sleep(0)
        signal.abort()
        stream_events = await stream_task
        self.assertEqual([event["code"] for event in stream_events if event["type"] == "error"], ["ABORTED"])
        self.assertEqual(generator_cleanup, [True])
        self.assertEqual([event["type"] for event in stream_events].count("result"), 0)

    async def test_cancelled_consumer_task_closes_running_generator(self):
        closed: list[bool] = []
        registry = ToolRegistry(approvalMode="bypass")

        async def never_finishes(_value: Any, _ctx: ToolContext) -> AsyncIterable[ToolEvent]:
            try:
                yield {"type": "progress", "message": "working"}
                await asyncio.Event().wait()
            finally:
                closed.append(True)

        registry.register(ToolDefinition("never", "never", passthrough(), never_finishes))
        bound = bind(registry, Auth())
        task = asyncio.create_task(collect(bound.invoke("never", {})))
        await asyncio.sleep(0)
        task.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await task
        self.assertEqual(closed, [True])

    async def test_output_schema_divergence_is_strict_and_handler_errors_are_structured(self):
        registry = ToolRegistry(approvalMode="bypass")
        registry.register(
            [
                ToolDefinition(
                    "bad-output",
                    "bad-output",
                    passthrough(),
                    bad_output_handler,
                    output=RejectOutput(),
                    validateOutput="strict",
                ),
                ToolDefinition(
                    "boom",
                    "boom",
                    passthrough(),
                    boom_handler,
                ),
            ]
        )
        bound = bind(registry, Auth())
        output = await collect(bound.invoke("bad-output", {}))
        self.assertEqual(output[0]["code"], "OUTPUT_INVALID")
        boom = await collect(bound.invoke("boom", {}))
        self.assertEqual(boom, [{"type": "error", "code": "BOOM", "message": "kaboom"}])

    async def test_approval_callback_runs_after_authorization_and_before_handler(self):
        started: list[Any] = []
        approval_requests: list[Any] = []
        order: list[str] = []

        def approval(request: Any) -> dict[str, str]:
            order.append("approval")
            approval_requests.append(request)
            return {"outcome": "denied", "reason": "needs review", "approvalRequestId": "approval-1"}

        def authorize(request: AuthorizationRequest) -> dict[str, str]:
            order.append(f"auth:{request.get('action')}")
            return allow_decision(request)

        def handler(value: Any, ctx: ToolContext) -> None:
            order.append("handler")
            record_child_started(started, value, ctx)

        registry = ToolRegistry(security={"approvalProvider": approval})
        registry.register(
            ToolDefinition(
                "mutate",
                "mutate",
                passthrough(),
                handler,
                approval="write",
            )
        )
        events = await collect(bind(registry, Auth(authorize)).invoke("mutate", {}))
        self.assertEqual(events[0]["code"], "APPROVAL_DENIED")
        self.assertEqual(events[0]["details"], {"approvalRequestId": "approval-1"})
        self.assertEqual(len(approval_requests), 1)
        self.assertEqual(approval_requests[0].approval.tier, "write")
        self.assertEqual(order, ["auth:tool.discover", "auth:tool.invoke", "approval"])
        self.assertEqual(started, [])

    async def test_denied_invocation_bypasses_approval_and_handler(self):
        approval_calls: list[bool] = []
        started: list[Any] = []

        def authorize(request: AuthorizationRequest) -> dict[str, str]:
            return (
                deny_decision(request)
                if request.get("action") == "tool.invoke"
                else allow_decision(request)
            )

        def approval(_request: Any) -> dict[str, str]:
            approval_calls.append(True)
            return {"outcome": "approved"}

        registry = ToolRegistry(security={"approvalProvider": approval})
        registry.register(
            ToolDefinition(
                "mutate",
                "mutate",
                passthrough(),
                lambda value, ctx: record_started(started, value, ctx),
                approval="write",
            )
        )
        events = await collect(bind(registry, Auth(authorize)).invoke("mutate", {}))
        self.assertEqual(
            events,
            [{"type": "error", "code": "AUTHORIZATION_DENIED", "message": "forbidden"}],
        )
        self.assertEqual(approval_calls, [])
        self.assertEqual(started, [])

    async def test_approval_required_preserves_resource_and_expiry_details(self):
        def approval(_request: Any) -> dict[str, str]:
            return {
                "outcome": "required",
                "reason": "needs review",
                "approvalRequestId": "approval-2",
                "expiresAt": "2026-10-07T00:00:00Z",
            }

        registry = ToolRegistry(
            security={"approvalProvider": approval, "requestId": lambda: "request-2"}
        )

        registry.register(
            ToolDefinition(
                "review",
                "review",
                passthrough(),
                identity_handler,
                approval="write",
            )
        )
        events = await collect(bind(registry, Auth()).invoke("review", {}))
        self.assertEqual(
            events[0],
            {
                "type": "error",
                "code": "APPROVAL_REQUIRED",
                "message": "Approval required",
                "details": {
                    "requestId": "request-2",
                    "approvalRequestId": "approval-2",
                    "toolName": "review",
                    "approvalTier": "write",
                    "reason": "needs review",
                    "resource": {"kind": "tool", "target": "review"},
                    "expiresAt": "2026-10-07T00:00:00Z",
                },
            },
        )

    async def test_null_and_unhashable_approval_fields_fail_closed(self):
        decisions: list[dict[str, Any]] = [
            {"outcome": "approved", "grantScope": None},
            {"outcome": "approved", "grantId": None},
            {"outcome": "approved", "reason": None},
            {"outcome": "approved", "approvalRequestId": None},
            {"outcome": "approved", "grantScope": []},
            {"outcome": "denied", "reason": None},
            {"outcome": "denied", "reason": "denied", "approvalRequestId": None},
            {"outcome": "required", "reason": None, "approvalRequestId": "id"},
            {"outcome": "required", "reason": "required", "approvalRequestId": None},
            {"outcome": "required", "reason": "required", "approvalRequestId": "id", "expiresAt": None},
        ]
        for index, decision in enumerate(decisions):
            with self.subTest(index=index, decision=decision):
                def provider(_request: Any, value: dict[str, Any] = decision) -> dict[str, Any]:
                    return value

                registry = ToolRegistry(security={"approvalProvider": provider})
                registry.register(
                    ToolDefinition(
                        f"malformed-{index}",
                        "malformed",
                        passthrough(),
                        identity_handler,
                        approval="write",
                    )
                )
                events = await collect(
                    bind(registry, Auth()).invoke(f"malformed-{index}", {})
                )
                self.assertEqual(events[0]["code"], "APPROVAL_DENIED")
                self.assertEqual(
                    events[0]["message"],
                    "Approval provider returned an invalid decision",
                )

    async def test_cycle_detection(self):
        registry = ToolRegistry(approvalMode="bypass")

        async def recursive(_value: Any, ctx: ToolContext) -> dict[str, dict[str, Any]]:
            assert ctx.invoke is not None
            events = [event async for event in ctx.invoke("recursive", {})]
            return {"data": {"code": events[0]["code"]}}

        registry.register(ToolDefinition("recursive", "recursive", passthrough(), recursive))
        events = await collect(bind(registry, Auth()).invoke("recursive", {}))
        self.assertEqual(events, [{"type": "result", "data": {"code": "CYCLE"}}])


if __name__ == "__main__":
    unittest.main()
