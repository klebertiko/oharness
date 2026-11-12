"""Safe provider failure evidence; task/CLI free text is never authentication proof."""
import httpx

from adapters.cli_shared import CLI_FAILURE_MESSAGES, CliFailure


def failure_details(exc: Exception) -> dict:
    if isinstance(exc, CliFailure):
        # Closed class + fixed text: nothing the CLI printed travels with it (I10).
        return {"provider_failure": exc.failure, "error": CLI_FAILURE_MESSAGES[exc.failure]}
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code in (401, 403):
            return {"provider_failure": "authentication", "error": "Provider rejected authentication. Check its credentials in Providers."}
        return {"error": f"Provider request failed (HTTP {exc.response.status_code})."}
    if isinstance(exc, (httpx.TransportError, TimeoutError, ConnectionError)):
        return {"provider_failure": "transport", "error": "Could not reach the provider. Check its endpoint and connection."}
    # Arbitrary SDK/CLI messages can contain URLs, prompts or credentials.
    return {"error": "Provider execution failed. Check the provider configuration and retry."}
