"""Map CLI run failures to closed provider_failure classes without leaking CLI text."""
from __future__ import annotations

SAFE_MESSAGES: dict[str, str] = {
    "cli-signin": "Sign in to the CLI, then test the connection again in Providers.",
    "cli-missing": "Install the CLI, sign in, then test the connection in Providers.",
    "cli-timeout": "The CLI did not finish in time. Try again or test the connection in Providers.",
    "cli-error": "The CLI run failed. Sign in or test the connection in Providers.",
}


def classify_cli_run_failure(message: str) -> str:
    """Return a closed class from adapter-internal error text. Never echoed to the client."""
    text = message.strip().lower()
    if not text:
        return "cli-error"
    if "timed out" in text:
        return "cli-timeout"
    if "not found on path" in text or ("not found" in text and "cli" in text):
        return "cli-missing"
    if (
        "not logged in" in text
        or "auth expired" in text
        or "login required" in text
        or "sign in" in text
        or "session expired" in text
    ):
        return "cli-signin"
    return "cli-error"


def cli_run_failure_details(exc: RuntimeError) -> dict:
    failure = classify_cli_run_failure(str(exc))
    return {"provider_failure": failure, "error": SAFE_MESSAGES[failure]}
