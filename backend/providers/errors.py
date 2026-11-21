"""Closed catalog of provider failures: a stable code, i18n keys, and one primary action.

The sentences live in the `providers.error.*` catalogs. This module never carries
free text from a CLI, an HTTP body, or an address.
"""
from __future__ import annotations

PROVIDER_ERROR_CODES = (
    "authentication",
    "cli_missing",
    "cli_signed_out",
    "usage_limit",
    "http_429",
    "overload",
    "timeout",
    "model_not_found",
    "model_not_pulled",
    "endpoint_unreachable",
    "content_policy",
    "budget_exceeded",
)

# What `failure_details` puts in `provider_failure` for the classes it emits.
# `http_429` is the catalog row for HTTP 429; the wire class is `usage_limit`.
_WIRE = {
    "authentication": "authentication",
    "cli_missing": "cli-missing",
    "cli_signed_out": "cli-signin",
    "usage_limit": "usage_limit",
    "http_429": "usage_limit",
    "overload": "overload",
    "timeout": "timeout",
    "model_not_found": "model_not_found",
    "model_not_pulled": "model_not_pulled",
    "endpoint_unreachable": "transport",
    "content_policy": "content_policy",
    "budget_exceeded": "budget_exceeded",
}

_ACTION = {
    "authentication": "sign-in-or-replace-key",
    "cli_missing": "install-cli",
    "cli_signed_out": "sign-in",
    "usage_limit": "wait-or-switch",
    "http_429": "wait-or-switch",
    "overload": "retry-later",
    "timeout": "retry",
    "model_not_found": "choose-model",
    "model_not_pulled": "pull-model",
    "endpoint_unreachable": "check-endpoint",
    "content_policy": "rewrite",
    "budget_exceeded": "raise-ceiling",
}

_FIXED = {
    "overload": "The provider is overloaded. Retry in a few minutes.",
    "timeout": "The provider did not answer in time. Retry.",
}


def fixed_message(code: str) -> str:
    return _FIXED[code]


def provider_error_catalog() -> dict[str, dict[str, str]]:
    return {
        code: {
            "code": code,
            "what_key": f"providers.error.{code}.what",
            "why_key": f"providers.error.{code}.why",
            "action_key": f"providers.error.{code}.action",
            "action": _ACTION[code],
            "wire": _WIRE[code],
        }
        for code in PROVIDER_ERROR_CODES
    }


def classify_provider_error(
    *,
    status: int | None = None,
    cli: str | None = None,
    signal: str | None = None,
    wire: str | None = None,
) -> str | None:
    """Map a status, a CLI class, a wire class, or a named signal onto one catalog code."""
    if status in (401, 403):
        return "authentication"
    if status == 429:
        return "http_429"
    if status in (503, 529):
        return "overload"
    if cli == "cli-missing":
        return "cli_missing"
    if cli == "cli-signin":
        return "cli_signed_out"
    if cli == "usage_limit":
        return "usage_limit"
    if cli == "cli-timeout":
        return "timeout"
    if wire == "transport":
        return "endpoint_unreachable"
    if signal in ("model_not_found", "model_not_pulled", "content_policy", "budget_exceeded"):
        return signal
    return None
