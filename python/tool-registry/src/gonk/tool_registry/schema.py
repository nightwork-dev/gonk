"""The injected validation boundary used by the Python registry.

The registry deliberately does not implement JSON Schema. A host can inject a
validator that follows this protocol, or use ``json_schema_validator`` with
the optional ``jsonschema`` dependency.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from typing import Any, Protocol, cast


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    message: str
    path: tuple[str | int, ...] = ()

    def as_dict(self) -> dict[str, Any]:
        result: dict[str, Any] = {"message": self.message}
        if self.path:
            result["path"] = list(self.path)
        return result


@dataclass(frozen=True, slots=True)
class ValidationResult:
    """Normalized result returned by a ``Validator``."""

    value: Any = None
    issues: tuple[ValidationIssue | Mapping[str, Any] | str, ...] | None = None

    @classmethod
    def ok(cls, value: Any) -> ValidationResult:
        return cls(value=value)

    @classmethod
    def invalid(cls, *issues: ValidationIssue | Mapping[str, Any] | str) -> ValidationResult:
        return cls(issues=tuple(issues))


type ValidationReturn = ValidationResult | Mapping[str, Any]


class Validator(Protocol):
    def validate(self, value: Any) -> ValidationReturn | Awaitable[ValidationReturn]: ...


type ValidatorLike = Validator | Callable[[Any], ValidationReturn | Awaitable[ValidationReturn]]


def passthrough() -> Validator:
    """Return a validator that accepts and returns every value."""

    class _Passthrough:
        def validate(self, value: Any) -> ValidationResult:
            return ValidationResult.ok(value)

    return _Passthrough()


class _JsonSchemaValidator:
    def __init__(self, declaration: Mapping[str, Any]) -> None:
        self.declaration = declaration

    def validate(self, value: Any) -> ValidationResult:
        try:
            from jsonschema import Draft202012Validator  # type: ignore[reportMissingImports]
        except ImportError as error:  # pragma: no cover - depends on optional extra
            raise RuntimeError(
                "JSON Schema validation requires the optional 'jsonschema' extra"
            ) from error
        validator: Any = Draft202012Validator(self.declaration)
        errors = sorted(
            validator.iter_errors(value),
            key=lambda item: list(item.path),
        )
        if errors:
            return ValidationResult(
                issues=tuple(
                    ValidationIssue(message=error.message, path=tuple(error.path))
                    for error in errors
                )
            )
        return ValidationResult.ok(value)


def json_schema_validator(declaration: Mapping[str, Any]) -> Validator:
    """Adapt a JSON Schema declaration through the optional ``jsonschema`` package."""

    return _JsonSchemaValidator(declaration)


def with_json_schema(validator: ValidatorLike, declaration: Mapping[str, Any]) -> ValidatorLike:
    """Attach an advertised JSON Schema declaration to an injected validator."""

    class _Annotated:
        inputJsonSchema = declaration

        def validate(self, value: Any) -> ValidationReturn | Awaitable[ValidationReturn]:
            method = getattr(validator, "validate", None)
            return method(value) if callable(method) else validator(value)  # type: ignore[misc]

    return _Annotated()


def normalize_validation_result(result: Any, original: Any) -> ValidationResult:
    """Normalize Standard Schema-shaped and Python-native validator results."""

    if isinstance(result, ValidationResult):
        return result
    if result is None:
        return ValidationResult.ok(original)
    if isinstance(result, Mapping):
        result_mapping = cast(Mapping[str, Any], result)
        if result_mapping.get("issues"):
            raw: Any = result_mapping["issues"]
            if isinstance(raw, (str, bytes)) or not hasattr(raw, "__iter__"):
                raw = [raw]
            return ValidationResult(issues=tuple(raw))
        if "value" in result_mapping:
            return ValidationResult.ok(result_mapping["value"])
    return ValidationResult.ok(result)


def format_issues(issues: tuple[ValidationIssue | Mapping[str, Any] | str, ...] | None) -> list[Any]:
    if not issues:
        return []
    return [issue.as_dict() if isinstance(issue, ValidationIssue) else issue for issue in issues]
