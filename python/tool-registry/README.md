# gonk-tool-registry

`gonk-tool-registry` implements Gonk's native Python tool dispatch contract. It
uses the host-provided `gonk-auth.AuthContext` and does not create an ambient
owner principal.

```python
import asyncio

from gonk.auth import ownerPrincipal
from gonk.tool_registry import ToolDefinition, ToolRegistry, passthrough


async def main() -> None:
    registry = ToolRegistry()
    registry.register(
        ToolDefinition(
            name="echo",
            description="Return the supplied value.",
            input=passthrough(),
            handler=lambda value, _ctx: {"data": value},
            approval="read",
        )
    )

    auth_context = ownerPrincipal({"USER": "owner", "HOSTNAME": "example"})
    bound = registry.withPrincipal(auth_context)
    events = [event async for event in bound.invoke("echo", {"ok": True})]


asyncio.run(main())
```

Handlers may be synchronous functions, awaitable functions, or async
generators. A handler receives a `ToolContext` with `auth`, `signal`,
`callStack`, and `invoke`. Nested calls use the same authorization path and
reject cycles. Input validation runs before the handler, and output validation
can be `"lax"` or `"strict"`.

Cancellation interrupts awaitable or async-generator work. A synchronous
handler runs inline and is not interruptible.

Validation is injected through the small `Validator` protocol. A validator may
return `ValidationResult`, a Standard Schema-shaped mapping (`{"value": ...}`
or `{"issues": [...]}`), or an awaitable of either. `inputJsonSchema` is a
declaration for adapters; it is intentionally not interpreted by the core.
Use `json_schema_validator()` with the optional `jsonschema` extra when raw
JSON Schema validation is required.

The package covers native registration, host authorization and approval
callbacks, input and output validation, nested calls, streamed events, and
cancellation with async-generator cleanup. It does not include TypeScript host
projections, duplex input streams, metrics, receipts, source-catalog
replacement, or transport framing.
