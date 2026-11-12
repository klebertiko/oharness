"""Safe provider failure evidence; task/CLI free text is never authentication proof."""
import httpx

from providers.cli_run_failure import cli_run_failure_details


def failure_details(exc: Exception) -> dict:
    if isinstance(exc, httpx.HTTPStatusError):
        if exc.response.status_code in (401, 403):
            return {"provider_failure": "authentication", "error": "Provider rejected authentication. Check its credentials in Providers."}
        return {"error": f"Provider request failed (HTTP {exc.response.status_code})."}
    if isinstance(exc, (httpx.TransportError, TimeoutError, ConnectionError)):
        return {"provider_failure": "transport", "error": "Could not reach the provider. Check its endpoint and connection."}
    if isinstance(exc, RuntimeError):
        return cli_run_failure_details(exc)
    # Arbitrary SDK/CLI messages can contain URLs, prompts or credentials.
    return {"error": "Provider execution failed. Check the provider configuration and retry."}
