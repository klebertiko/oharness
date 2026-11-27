"""Safe provider failure evidence; task/CLI free text is never authentication proof."""
from datetime import datetime

import httpx

from adapters.cli_shared import CLI_FAILURE_MESSAGES, CLI_USAGE_LIMIT, CliFailure, reset_from_retry_after
from providers.errors import fixed_message


def _now() -> datetime:
    return datetime.now().astimezone()


def _with_reset(details: dict, reset_at: str | None) -> dict:
    if reset_at:
        details["reset_at"] = reset_at
    return details


def failure_details(exc: Exception) -> dict:
    if isinstance(exc, CliFailure):
        # Closed class + fixed text: nothing the CLI printed travels with it (I10).
        details = {"provider_failure": exc.failure, "error": CLI_FAILURE_MESSAGES[exc.failure]}
        if exc.failure == CLI_USAGE_LIMIT:
            return _with_reset(details, exc.reset_at)
        return details
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in (401, 403):
            return {"provider_failure": "authentication", "error": "Provider rejected authentication. Check its credentials in Providers."}
        if status == 429:
            # Same class as a subscription window. The body is never read.
            header = exc.response.headers.get("Retry-After")
            return _with_reset(
                {"provider_failure": CLI_USAGE_LIMIT, "error": CLI_FAILURE_MESSAGES[CLI_USAGE_LIMIT]},
                reset_from_retry_after(header, now=_now()),
            )
        if status in (503, 529):
            return {"provider_failure": "overload", "error": fixed_message("overload")}
        return {"error": f"Provider request failed (HTTP {status})."}
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)):
        return {"provider_failure": "timeout", "error": fixed_message("timeout")}
    if isinstance(exc, (httpx.TransportError, ConnectionError)):
        return {"provider_failure": "transport", "error": "Could not reach the provider. Check its endpoint and connection."}
    # Arbitrary SDK/CLI messages can contain URLs, prompts or credentials.
    return {"error": "Provider execution failed. Check the provider configuration and retry."}
