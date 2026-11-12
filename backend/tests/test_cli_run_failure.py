"""R-PRV-03: closed CLI run failure classes; stderr-shaped text must not reach clients."""
from __future__ import annotations

import json

import pytest

from providers.cli_run_failure import SAFE_MESSAGES, classify_cli_run_failure
from providers.outcomes import failure_details
from test_execution_provider_resolution import client, _sse_events  # noqa: F401


@pytest.mark.parametrize(
    ("adapter_message", "expected"),
    [
        ("claude CLI timed out after 120s", "cli-timeout"),
        ("codex CLI timed out after 30s", "cli-timeout"),
        ("line1\nnot logged in", "cli-signin"),
        ("auth expired", "cli-signin"),
        ("claude CLI not found on PATH.", "cli-missing"),
        ("something wholly unknown", "cli-error"),
    ],
)
def test_classify_cli_run_failure(adapter_message: str, expected: str) -> None:
    assert classify_cli_run_failure(adapter_message) == expected


CANARY = "oharness-canary-secret-7d3e9f1a"


def test_failure_details_never_echoes_adapter_text() -> None:
    detail = failure_details(RuntimeError(f"boom {CANARY} leaked from stderr"))
    assert CANARY not in json.dumps(detail)
    assert detail["provider_failure"] == "cli-error"
    assert detail["error"] == SAFE_MESSAGES["cli-error"]


def test_failure_details_signin_class_and_safe_copy() -> None:
    detail = failure_details(RuntimeError("cursor-agent: not logged in"))
    assert detail == {"provider_failure": "cli-signin", "error": SAFE_MESSAGES["cli-signin"]}


def test_direct_run_emits_cli_failure_without_stderr(client, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    from adapters.cli_claude import ClaudeCliAdapter
    from adapters.cli_shared import CliRunResult
    from test_subscription_contract import _recording  # noqa: PLC2701

    captured: list[dict] = []
    failing = ClaudeCliAdapter(
        runner=_recording(captured, CliRunResult(returncode=1, stdout="", stderr=f"boom {CANARY}")),
    )
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: failing)
    response = client.post("/execute/direct", json={"instruction": "hello", "mode": "live", "connection_id": "anthropic"})
    assert CANARY not in response.text
    error = next((d for n, d in _sse_events(response.text) if n == "node_error"), None)
    assert error is not None
    assert error["provider_failure"] == "cli-error"
    assert CANARY not in json.dumps(error)
