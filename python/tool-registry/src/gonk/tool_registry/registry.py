"""Native Python tool registration and asynchronous dispatch.

The order of the supported dispatch path intentionally follows the TypeScript
registry: discover (root calls), validate input, resolve approval/resource,
authorize invocation, then start the handler. Every rejection before the last
step is an event stream and the handler is never started.
"""

from __future__ import annotations

import asyncio
import inspect
import itertools
from collections.abc import AsyncGenerator, AsyncIterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, cast

from gonk.auth import (
    AuthContext,
    AuthorizationRequest,
    AuthzResource,
    captureAuthContext,
)

from .errors import ToolError
from .schema import (
    ValidatorLike,
    format_issues,
    normalize_validation_result,
)
from .types import (
    InvokeOptions,
    ToolContext,
    ToolDefinition,
    ToolEvent,
    default_context,
)


@dataclass(frozen=True, slots=True)
class ResolvedApproval:
    tier: str
    override: bool = False
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class ApprovalRequest:
    principal: Any
    tool: ToolDefinition
    input: Any
    resource: AuthzResource
    approval: ResolvedApproval
    relatedResources: list[AuthzResource] = field(default_factory=list[AuthzResource])

    @property
    def related_resources(self) -> list[AuthzResource]:
        return self.relatedResources

    def __getitem__(self, key: str) -> Any:
        return getattr(self, key)

    def get(self, key: str, default: Any = None) -> Any:
        return getattr(self, key, default)


@dataclass(frozen=True, slots=True)
class ToolRegistrySecurityOptions:
    approvalProvider: Any | None = None
    approvalMode: str = "enforce"
    resourceResolver: Any | None = None
    requestId: Any | None = None


@dataclass(frozen=True, slots=True)
class BoundToolRegistry:
    _registry: ToolRegistry
    _auth: AuthContext

    def invoke(
        self,
        name: str,
        input: Any,
        options: InvokeOptions | Mapping[str, Any] | ToolContext | None = None,
    ) -> AsyncIterable[ToolEvent]:
        return self._registry.invoke(name, input, options, auth=self._auth)


class ToolRegistry:
    """A registry of native Python handlers with one canonical dispatch path."""

    request_sequence = itertools.count(1)

    def __init__(
        self,
        *,
        security: ToolRegistrySecurityOptions | Mapping[str, Any] | None = None,
        approvalProvider: Any | None = None,
        approvalMode: str = "enforce",
    ) -> None:
        self._tools: dict[str, ToolDefinition] = {}
        self._security = security
        self._approval_provider = approvalProvider
        self._approval_mode = approvalMode

    def register(
        self,
        definition: ToolDefinition | Sequence[ToolDefinition],
        *,
        overwrite: bool = False,
    ) -> None:
        definitions = [definition] if isinstance(definition, ToolDefinition) else list(definition)
        for tool in definitions:
            if tool.requires is not None and not tool.requires():
                continue
            if tool.name in self._tools and not overwrite:
                raise ValueError(f"Tool already registered: {tool.name}")
            self._tools[tool.name] = tool

    def get(self, name: str) -> ToolDefinition | None:
        return self._tools.get(name)

    def has(self, name: str) -> bool:
        return name in self._tools

    def list(self) -> list[ToolDefinition]:
        return list(self._tools.values())

    def withPrincipal(self, auth: AuthContext) -> BoundToolRegistry:
        if cast(Any, auth) is None:
            raise TypeError("AuthContext is required")
        return BoundToolRegistry(self, auth)

    def invoke(
        self,
        name: str,
        input: Any,
        options: InvokeOptions | Mapping[str, Any] | ToolContext | None = None,
        *,
        auth: Any | None = None,
    ) -> AsyncIterable[ToolEvent]:
        context = _context_from_options(options, auth=auth)
        return self._run(
            name,
            input,
            context,
            _call_stack_from_options(options),
            captured_auth=False,
        )

    async def _run(
        self,
        name: str,
        input: Any,
        base_context: ToolContext,
        call_stack: tuple[str, ...],
        *,
        captured_auth: bool = False,
    ) -> AsyncGenerator[ToolEvent, None]:
        tool = self._tools.get(name)
        if tool is None:
            yield _error("TOOL_NOT_FOUND", f"No such tool: {name}")
            return
        if name in call_stack:
            yield _error("CYCLE", f"Cycle detected: {' -> '.join((*call_stack, name))}")
            return

        if base_context.auth is None:
            yield _error(
                "AUTH_REQUIRED",
                "ToolContext.auth is required. Bind a principal once with registry.withPrincipal(...).",
            )
            return

        current_stack = (*call_stack, name)
        auth = base_context.auth
        if not captured_auth or not call_stack:
            try:
                auth = captureAuthContext(auth)
            except Exception:  # noqa: BLE001 - security capture fails closed below
                # Match the TypeScript public behavior: an invalid root principal
                # is indistinguishable from an undiscoverable tool; child calls
                # retain an explicit authorization denial.
                if not call_stack:
                    yield _error("TOOL_NOT_FOUND", f"No such tool: {name}")
                else:
                    yield _error("AUTHORIZATION_DENIED", "Invalid authenticated principal")
                return

        if not call_stack:
            decision = await _authorize(
                auth,
                AuthorizationRequest(
                    action="tool.discover",
                    resource=_tool_resource(tool),
                    callStack=list(current_stack),
                ),
            )
            if decision[0] == "deny":
                yield _error("TOOL_NOT_FOUND", f"No such tool: {name}")
                return

        try:
            validated = await _validate(tool.input, input)
        except Exception as error:  # noqa: BLE001 - validators report through the event contract
            yield _error(
                "INVALID_INPUT",
                "Input validation failed",
                details=[{"message": str(error) or "input validator threw"}],
            )
            return
        if validated.issues:
            yield _error(
                "INVALID_INPUT",
                "Input validation failed",
                details=format_issues(validated.issues),
            )
            return

        approval = _resolve_approval(tool.approval, validated.value)
        resource = _tool_resource(tool, approval)
        related: tuple[AuthzResource, ...] = ()

        declaration = tool.authorizationResource
        if declaration is not None and bool(_field(declaration, "required", True)):
            resolver = _field(self._security, "resourceResolver")
            if resolver is None:
                resolver = _field(self._security, "resource_resolver")
            resolved: Any = None
            try:
                if resolver is not None:
                    resolved = await _call_provider(
                        resolver,
                        "resolve",
                        {
                            "principal": _field(auth, "principal"),
                            "tool": tool,
                            "input": validated.value,
                            "callStack": current_stack,
                        },
                    )
            except Exception:  # noqa: BLE001 - resource resolution fails closed
                resolved = None
            if not _valid_resource(declaration, resolved):
                yield _error("AUTH_RESOURCE_UNRESOLVED", "Required authorization resource could not be resolved")
                return
            related = (_resource_from_value(resolved),)

        decision = await _authorize(
            auth,
            AuthorizationRequest(
                action="tool.invoke",
                resource=resource,
                relatedResources=list(related),
                input=validated.value,
                callStack=list(current_stack),
            ),
        )
        if decision[0] == "deny":
            yield _error("AUTHORIZATION_DENIED", decision[1])
            return

        provider = _field(self._security, "approvalProvider") or _field(
            self._security, "approval_provider"
        )
        provider = provider if provider is not None else self._approval_provider
        mode = _field(self._security, "approvalMode") or _field(
            self._security, "approval_mode"
        ) or self._approval_mode
        if mode != "bypass" and (provider is not None or approval.tier != "read"):
            approval_decision = await _approval(
                provider,
                ApprovalRequest(
                    principal=_field(auth, "principal"),
                    tool=tool,
                    input=validated.value,
                    resource=resource,
                    relatedResources=list(related),
                    approval=approval,
                ),
            )
            if approval_decision.get("outcome") == "denied":
                details = {}
                if approval_decision.get("approvalRequestId"):
                    details["approvalRequestId"] = approval_decision["approvalRequestId"]
                yield _error(
                    "APPROVAL_DENIED",
                    str(approval_decision.get("reason") or "Approval denied"),
                    details=details or None,
                )
                return
            if approval_decision.get("outcome") == "required":
                request_id = approval_decision.get("approvalRequestId") or "approval-required"
                approval_details: dict[str, Any] = {
                    "requestId": _request_id(self._security),
                    "approvalRequestId": request_id,
                    "toolName": tool.name,
                    "approvalTier": approval.tier,
                    "reason": approval_decision.get("reason", "Approval required"),
                    "resource": _redact_resource(resource),
                }
                if related:
                    approval_details["relatedResources"] = [
                        _redact_resource(item) for item in related
                    ]
                if approval_decision.get("expiresAt") is not None:
                    approval_details["expiresAt"] = approval_decision["expiresAt"]
                yield _error(
                    "APPROVAL_REQUIRED",
                    "Approval required",
                    details=approval_details,
                )
                return

        handler_context = ToolContext(
            signal=base_context.signal,
            log=base_context.log,
            cwd=base_context.cwd,
            env=base_context.env,
            auth=auth,
            callStack=list(current_stack),
        )
        # The child context intentionally does not carry a duplex input stream;
        # that host-specific surface is outside this initial Python contract.
        handler_context.invoke = lambda child_name, child_input: self._run(
            child_name,
            child_input,
            ToolContext(
                signal=base_context.signal,
                log=base_context.log,
                cwd=base_context.cwd,
                env=base_context.env,
                auth=auth,
            ),
            current_stack,
            captured_auth=True,
        )

        iterator: Any = None
        try:
            returned = tool.handler(validated.value, handler_context)
            if inspect.isawaitable(returned):
                returned = await _await_with_abort(returned, base_context.signal)
            if _is_async_iterable(returned):
                iterator = returned.__aiter__()
                async for event in _iter_with_abort(iterator, base_context.signal):
                    normalized = _normalize_event(event)
                    if normalized.get("type") == "result":
                        normalized, valid = await self._validate_output(tool, normalized, handler_context.log)
                        if not valid:
                            yield normalized
                            return
                    yield normalized
            else:
                result = _normalize_result(returned)
                result, valid = await self._validate_output(tool, result, handler_context.log)
                if not valid:
                    yield result
                    return
                yield result
        except _Aborted:
            yield _error("ABORTED", "Tool execution aborted")
        except ToolError as error:
            yield _error(error.code, str(error), details=error.details)
        except asyncio.CancelledError:
            # A cancelled consumer should still close a generator and let its
            # finally block run. Do not emit a second terminal event.
            raise
        except Exception as error:  # noqa: BLE001 - handler failures become INTERNAL events
            yield _error("INTERNAL", str(error))
        finally:
            if iterator is not None:
                await _close_async_iterator(iterator)

    async def _validate_output(
        self, tool: ToolDefinition, result: ToolEvent, log: Any = None
    ) -> tuple[ToolEvent, bool]:
        if tool.output is None or tool.validateOutput in (None, "off"):
            return result, True
        try:
            validated = await _validate(tool.output, result.get("data"))
        except Exception as error:  # noqa: BLE001 - validator failures follow strict/lax policy
            validated = None
            issue: Any = {"message": str(error) or "output validator threw"}
            if tool.validateOutput == "strict":
                return _error("OUTPUT_INVALID", "Output validation failed", details=[issue]), False
        if validated is not None and validated.issues:
            details = format_issues(validated.issues)
            if tool.validateOutput == "strict":
                return _error("OUTPUT_INVALID", "Output validation failed", details=details), False
            if log is not None:
                warn = getattr(log, "warn", None)
                if callable(warn):
                    warn("Output validation failed (lax)", {"issues": details})
        return result, True


class _Aborted(Exception):
    pass


async def _iter_with_abort(iterator: Any, signal: Any) -> AsyncGenerator[Any, None]:
    while True:
        try:
            item = await _await_with_abort(iterator.__anext__(), signal)
        except StopAsyncIteration:
            return
        yield item


async def _await_with_abort(awaitable: Any, signal: Any) -> Any:
    task = asyncio.ensure_future(awaitable)
    if _signal_aborted(signal):
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise _Aborted()
    abort_task = asyncio.ensure_future(_wait_signal(signal))
    try:
        done, _ = await asyncio.wait((task, abort_task), return_when=asyncio.FIRST_COMPLETED)
    except asyncio.CancelledError:
        task.cancel()
        abort_task.cancel()
        await asyncio.gather(task, abort_task, return_exceptions=True)
        raise
    if abort_task in done and task not in done:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise _Aborted()
    abort_task.cancel()
    await asyncio.gather(abort_task, return_exceptions=True)
    return task.result()


async def _wait_signal(signal: Any) -> None:
    wait = getattr(signal, "wait", None)
    if callable(wait):
        result = wait()
        if inspect.isawaitable(result):
            await result
            return
    while not _signal_aborted(signal):
        await asyncio.sleep(0.01)


def _signal_aborted(signal: Any) -> bool:
    value = getattr(signal, "aborted", None)
    if value is not None:
        return bool(value)
    is_set = getattr(signal, "is_set", None)
    return bool(is_set()) if callable(is_set) else False


async def _close_async_iterator(iterator: Any) -> None:
    close = getattr(iterator, "aclose", None) or getattr(iterator, "close", None)
    if not callable(close):
        return
    try:
        result = close()
        if inspect.isawaitable(result):
            await result
    except (RuntimeError, StopAsyncIteration):
        # A generator that already completed or was cancelled is clean.
        pass


async def _validate(validator: ValidatorLike, value: Any):
    method = getattr(validator, "validate", None)
    result: Any = (
        cast(Any, method)(value) if callable(method) else cast(Any, validator)(value)
    )
    if inspect.isawaitable(result):
        result = await result
    return normalize_validation_result(result, value)


def _normalize_result(returned: Any) -> ToolEvent:
    if isinstance(returned, Mapping) and "data" in returned:
        result: ToolEvent = {"type": "result", "data": returned["data"]}
        for key in ("display", "metadata"):
            if key in returned:
                result[key] = returned[key]
        return result
    return {"type": "result", "data": returned}


def _normalize_event(event: Any) -> ToolEvent:
    if isinstance(event, Mapping):
        return dict(cast(Mapping[str, Any], event))
    if hasattr(event, "type"):
        result = {"type": event.type}
        for key in ("level", "message", "meta", "percent", "data", "chunk", "display", "metadata", "code", "details"):
            if hasattr(event, key):
                result[key] = getattr(event, key)
        return result
    raise TypeError("Tool event must be a mapping or event object")


def _error(code: str, message: str, *, details: Any = None) -> ToolEvent:
    event: ToolEvent = {"type": "error", "code": code, "message": message}
    if details is not None:
        event["details"] = details
    return event


def _tool_resource(tool: ToolDefinition, approval: ResolvedApproval | None = None) -> AuthzResource:
    metadata: dict[str, Any] = {}
    if tool.authorization is not None:
        metadata["authorization"] = tool.authorization
    if tool.capabilities is not None:
        metadata["capabilities"] = tool.capabilities
    if approval is not None:
        metadata["approvalTier"] = approval.tier
    resource: dict[str, Any] = {"kind": "tool", "target": tool.name}
    if metadata:
        resource["metadata"] = metadata
    return cast(AuthzResource, resource)


def _resource_from_value(value: Any) -> AuthzResource:
    if isinstance(value, Mapping):
        return cast(AuthzResource, dict(cast(Mapping[str, Any], value)))
    return cast(
        AuthzResource,
        {
            "kind": str(_field(value, "kind", "application:unknown")),
            "target": _field(value, "target"),
            "scope": _field(value, "scope"),
            "tenantId": _field(value, "tenantId"),
            "workspaceId": _field(value, "workspaceId"),
            "metadata": _field(value, "metadata"),
        },
    )


def _redact_resource(resource: AuthzResource) -> dict[str, Any]:
    result: dict[str, Any] = {"kind": _field(resource, "kind")}
    for field_name in ("target", "tenantId", "workspaceId"):
        value = _field(resource, field_name)
        if value is not None:
            result[field_name] = value
    return result


def _valid_resource(declaration: Mapping[str, Any], value: Any) -> bool:
    if value is None:
        return False
    resource = _resource_from_value(value)
    if _field(resource, "kind") != _field(declaration, "kind"):
        return False
    required = _field(declaration, "requiredFields", ("target",)) or ("target",)
    return all(isinstance(_field(resource, field), str) and _field(resource, field).strip() for field in required)


def _resolve_approval(declaration: Any, input: Any) -> ResolvedApproval:
    value = declaration
    if callable(value):
        try:
            value = value(input)
        except Exception:  # noqa: BLE001 - malformed approval declarations fail safe
            value = None
    if isinstance(value, str) and value in {"read", "write", "exec"}:
        return ResolvedApproval(tier=value)
    if isinstance(value, Mapping):
        approval = cast(Mapping[str, Any], value)
    else:
        approval = None
    if approval is not None and approval.get("tier") in {"read", "write", "exec"}:
        return ResolvedApproval(
            tier=cast(str, approval["tier"]),
            override=approval.get("override") is True,
            reason=approval.get("reason") if isinstance(approval.get("reason"), str) else None,
        )
    return ResolvedApproval(tier="exec", reason="Missing or invalid approval declaration")


async def _authorize(auth: Any, request: AuthorizationRequest) -> tuple[str, str]:
    method = getattr(auth, "authorize", None)
    if not callable(method):
        return "deny", "Authorization policy failed"
    try:
        decision = method(request)
        if inspect.isawaitable(decision):
            decision = await decision
    except Exception:  # noqa: BLE001 - policy failures fail closed
        return "deny", "Authorization policy failed"
    outcome = _field(decision, "outcome")
    reason = _field(decision, "reason")
    if isinstance(outcome, str) and outcome in {"allow", "deny"} and isinstance(reason, str):
        return outcome, reason
    return "deny", "Authorization policy returned an invalid decision"


async def _approval(provider: Any, request: ApprovalRequest) -> dict[str, Any]:
    if provider is None:
        return {"outcome": "denied", "reason": "Approval provider not configured"}
    try:
        decision = await _call_provider(provider, "decide", request)
    except Exception:  # noqa: BLE001 - provider failures fail closed
        return {"outcome": "denied", "reason": "Approval provider failed"}
    outcome = _field(decision, "outcome")
    reason = _field(decision, "reason")
    approval_request_id = _field(decision, "approvalRequestId")

    def present(name: str) -> bool:
        if isinstance(decision, Mapping):
            return name in decision
        return hasattr(decision, name)

    def optional_string(name: str) -> bool:
        if not present(name):
            return True
        return isinstance(_field(decision, name), str)

    if outcome == "approved":
        if not optional_string("reason") or not optional_string("approvalRequestId"):
            return {"outcome": "denied", "reason": "Approval provider returned an invalid decision"}
        grant_scope = _field(decision, "grantScope")
        if present("grantScope") and (
            not isinstance(grant_scope, str)
            or grant_scope not in {"persistent", "session"}
        ):
            return {"outcome": "denied", "reason": "Approval provider returned an invalid decision"}
        if not optional_string("grantId"):
            return {"outcome": "denied", "reason": "Approval provider returned an invalid decision"}
        return {"outcome": "approved"}
    if outcome == "required":
        if not isinstance(reason, str) or not isinstance(approval_request_id, str):
            return {"outcome": "denied", "reason": "Approval provider returned an invalid decision"}
        if not optional_string("expiresAt"):
            return {"outcome": "denied", "reason": "Approval provider returned an invalid decision"}
        return {
            "outcome": "required",
            "reason": reason,
            "approvalRequestId": approval_request_id,
            "expiresAt": _field(decision, "expiresAt"),
        }
    if outcome == "denied" and isinstance(reason, str) and optional_string("approvalRequestId"):
        return {
            "outcome": "denied",
            "reason": reason,
            "approvalRequestId": approval_request_id,
        }
    return {"outcome": "denied", "reason": "Approval provider returned an invalid decision"}


async def _call_provider(provider: Any, method_name: str, value: Any) -> Any:
    method = getattr(provider, method_name, None)
    if not callable(method):
        if callable(provider):
            result: Any = provider(value)
        else:
            raise TypeError(f"Provider has no {method_name} method")
    else:
        result = method(value)
    if inspect.isawaitable(result):
        return await result
    return result


def _context_from_options(
    options: InvokeOptions | Mapping[str, Any] | ToolContext | None,
    *,
    auth: Any | None,
) -> ToolContext:
    if isinstance(options, ToolContext):
        return ToolContext(
            signal=options.signal,
            log=options.log,
            cwd=options.cwd,
            env=options.env,
            auth=auth if auth is not None else options.auth,
            callStack=list(options.callStack),
        )
    values: Mapping[str, Any]
    if options is None:
        values = {}
    elif isinstance(options, InvokeOptions):
        values = {
            "signal": options.signal,
            "log": options.log,
            "cwd": options.cwd,
            "env": options.env,
            "callStack": options.callStack,
        }
    else:
        values = options
    context = values.get("context")
    if isinstance(context, ToolContext):
        return ToolContext(
            signal=values.get("signal", context.signal),
            log=values.get("log", context.log),
            cwd=values.get("cwd", context.cwd),
            env=values.get("env", context.env),
            auth=auth if auth is not None else context.auth,
            callStack=list(values.get("callStack", context.callStack)),
        )
    base = default_context(auth if auth is not None else values.get("auth"))
    env_value = values.get("env")
    env: Mapping[str, str | None] = (
        base.env if env_value is None else cast(Mapping[str, str | None], env_value)
    )
    return ToolContext(
        signal=values.get("signal") or base.signal,
        log=values.get("log") or base.log,
        cwd=values.get("cwd") or base.cwd,
        env=env,
        auth=auth if auth is not None else values.get("auth"),
        callStack=list(values.get("callStack", ())),
    )


def _call_stack_from_options(options: Any) -> tuple[str, ...]:
    if isinstance(options, ToolContext):
        return tuple(options.callStack)
    if isinstance(options, InvokeOptions):
        return options.callStack
    if isinstance(options, Mapping):
        values = cast(Mapping[str, Any], options)
        return tuple(values.get("callStack", values.get("call_stack", ())))
    return ()


def _field(value: Any, name: str, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, Mapping):
        return cast(Mapping[str, Any], value).get(name, default)
    return getattr(value, name, default)


def _request_id(security: Any) -> str:
    callback = _field(security, "requestId")
    if callback is not None:
        try:
            value = callback()
            if value is not None:
                return str(value)
        except Exception:  # noqa: BLE001 - use the deterministic fallback id
            return f"auth-{next(ToolRegistry.request_sequence)}"
    return f"auth-{next(ToolRegistry.request_sequence)}"


def _is_async_iterable(value: Any) -> bool:
    return value is not None and callable(getattr(value, "__aiter__", None))
