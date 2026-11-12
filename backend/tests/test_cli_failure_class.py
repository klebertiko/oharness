"""A failing subscription CLI in a run becomes one of four closed classes (R-PRV-03).

cli-signin | cli-missing | cli-timeout | cli-error — decided from the exit code and
phrases anchored at the start of a line, never from free text in the middle. The run
emits ``provider_failure`` with the class and a fixed message; raw stderr (I10) and
stdout never reach the reply.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from adapters.base import AdapterConfig
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_codex import CodexCliAdapter
from adapters.cli_cursor import CursorCliAdapter
from adapters.cli_shared import CliFailure, CliRunResult, classify_cli_failure
from providers.outcomes import failure_details
from test_execution_provider_resolution import client, _sse_events  # noqa: F401

CANARY = "CANARY-STDERR-5f1c9a"
ADAPTERS = [
    ("claude", ClaudeCliAdapter, "adapters.cli_claude"),
    ("codex", CodexCliAdapter, "adapters.cli_codex"),
    ("cursor", CursorCliAdapter, "adapters.cli_cursor"),
]


@pytest.fixture(autouse=True)
def _host(monkeypatch: pytest.MonkeyPatch) -> None:
    for _n, _c, module in ADAPTERS:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: f"/usr/local/bin/{name}")
    monkeypatch.setattr("adapters.cli_shared.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: True)


def _runner(result: CliRunResult):
    async def run(argv, *, cwd, env, timeout, stdin=None):
        return result

    return run


def _config() -> AdapterConfig:
    return AdapterConfig(adapter="", model="", extra={})


@pytest.mark.parametrize(
    ("returncode", "stderr", "timed_out", "expected"),
    [
        (-1, "timed out after 5s", True, "cli-timeout"),
        (1, "Not logged in. Run `claude login`.", False, "cli-signin"),
        (1, "Error: Not logged in", False, "cli-signin"),
        (1, "Invalid API key · Please run /login", False, "cli-signin"),
        (1, "Authentication required. Please run 'agent login'.", False, "cli-signin"),
        (1, "session expired, please sign in again", False, "cli-signin"),
        (1, f"boom {CANARY}", False, "cli-error"),
        (1, "", False, "cli-error"),
        # Phrases count only at the start of a line: the same words mid-sentence are noise.
        (1, "the task said: not logged in to the staging site", False, "cli-error"),
        (1, "retrying after unauthorized proxy reply", False, "cli-error"),
        # A signed-in-looking text with a zero exit code is not a failure class of its own.
        (0, "Not logged in", False, "cli-error"),
    ],
)
def test_classify_cli_failure(returncode: int, stderr: str, timed_out: bool, expected: str) -> None:
    assert classify_cli_failure(returncode=returncode, text=stderr, timed_out=timed_out) == expected


@pytest.mark.parametrize(("_name", "cls", "_module"), ADAPTERS)
def test_adapter_returns_the_class_for_a_nonzero_exit(_name, cls, _module) -> None:
    adapter = cls(runner=_runner(CliRunResult(returncode=1, stdout="", stderr="Not logged in\nmore")))
    result = asyncio.run(adapter.invoke("hi", _config()))
    assert result.failure == "cli-signin"
    adapter = cls(runner=_runner(CliRunResult(returncode=1, stdout="", stderr=f"boom {CANARY}")))
    assert asyncio.run(adapter.invoke("hi", _config())).failure == "cli-error"
    adapter = cls(runner=_runner(CliRunResult(returncode=-1, stdout="", stderr="timed out", timed_out=True)))
    assert asyncio.run(adapter.invoke("hi", _config())).failure == "cli-timeout"


@pytest.mark.parametrize(("_name", "cls", "_module"), ADAPTERS)
def test_stream_raises_a_failure_without_the_cli_text(_name, cls, _module) -> None:
    adapter = cls(runner=_runner(CliRunResult(returncode=1, stdout="", stderr=f"boom {CANARY}")))

    async def drain():
        return [c async for c in adapter.stream("hi", _config())]

    with pytest.raises(CliFailure) as caught:
        asyncio.run(drain())
    assert caught.value.failure == "cli-error"
    assert CANARY not in str(caught.value) and CANARY not in repr(caught.value)


@pytest.mark.parametrize(("_name", "cls", "module"), ADAPTERS)
def test_missing_binary_is_cli_missing_and_still_a_file_not_found(_name, cls, module, monkeypatch) -> None:
    monkeypatch.setattr(f"{module}.find_cli", lambda name: None)
    monkeypatch.setattr("adapters.cli_cursor._invocation_prefix", lambda: None)
    adapter = cls(runner=_runner(CliRunResult(returncode=0, stdout="{}", stderr="")))
    with pytest.raises(FileNotFoundError) as caught:
        asyncio.run(adapter.invoke("hi", _config()))
    assert isinstance(caught.value, CliFailure) and caught.value.failure == "cli-missing"


def test_failure_details_for_each_class_is_fixed_text() -> None:
    for failure in ("cli-signin", "cli-missing", "cli-timeout", "cli-error"):
        details = failure_details(CliFailure(failure))
        assert details["provider_failure"] == failure
        assert details["error"] and "Traceback" not in details["error"]


def test_run_emits_provider_failure_and_no_stderr(client, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    failing = ClaudeCliAdapter(runner=_runner(CliRunResult(returncode=1, stdout="", stderr=f"Not logged in {CANARY}")))
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: failing)
    response = client.post("/execute/direct", json={"instruction": "hello", "mode": "live", "connection_id": "anthropic"})
    assert CANARY not in response.text
    error = next(d for n, d in _sse_events(response.text) if n == "node_error")
    assert error["provider_failure"] == "cli-signin"
    assert CANARY not in json.dumps(error)


def test_non_cli_adapter_errors_never_get_a_cli_class() -> None:
    import httpx

    request = httpx.Request("POST", "https://api.example.test/v1")
    errors = [
        RuntimeError(f"upstream said {CANARY}"),
        ValueError("bad"),
        httpx.HTTPStatusError("x", request=request, response=httpx.Response(500, request=request)),
        httpx.ConnectError("down", request=request),
    ]
    for exc in errors:
        details = failure_details(exc)
        assert not str(details.get("provider_failure", "")).startswith("cli-")
        assert CANARY not in json.dumps(details)
