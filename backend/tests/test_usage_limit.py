"""A subscription limit is its own failure class and keeps only the reset instant.

Phrases count at the start of a line. HTTP 429 uses the same class. Task text,
addresses, and anything else the CLI printed stay out of the result.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone

import httpx
import pytest

from adapters.base import AdapterConfig
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_shared import CLI_FAILURE_MESSAGES, CLI_USAGE_LIMIT, CliFailure, CliRunResult, classify_cli_outcome
from providers.outcomes import failure_details

CANARY = "CANARY-TASK-7f3c"
EMAIL = "person@example.com"
NOW = datetime(2026, 11, 21, 3, 0, tzinfo=timezone(timedelta(hours=-3)))

# Six real shapes: a clock with a bullet, a clock with a middle dot, "try again at",
# a 24-hour clock, an evening clock, and an absolute instant. The 429 cases sit beside them.
SAMPLES = [
    ("Limit reached ∙ resets 6:20am", 6, 20),
    ("You've hit your limit · resets 6:20am", 6, 20),
    ("Error: usage limit reached — try again at 6:20 AM", 6, 20),
    ("usage limit. try again at 18:20", 18, 20),
    ("Limit reached ∙ resets 11:05pm", 23, 5),
    ("Error: You've reached your usage limit. Try again at 2026-11-21T09:20:00Z", 6, 20),
]

NEGATIVES = [
    f"the task said: limit reached ∙ resets 6:20am {CANARY}",
    f"please finish the usage limit section and try again at 6:20am {CANARY}",
    f"echoed: you've hit your limit · resets 6:20am {CANARY}",
    f"Resets 6:20am after writing limit reached {CANARY} {EMAIL}",
]


def _local(reset_at: str) -> datetime:
    return datetime.fromisoformat(reset_at).astimezone(NOW.tzinfo)


@pytest.mark.parametrize(("stderr", "hour", "minute"), SAMPLES)
def test_limit_phrase_at_line_start_keeps_only_the_reset_instant(stderr: str, hour: int, minute: int) -> None:
    text = f"{stderr} {CANARY} {EMAIL}\nsecond line {CANARY}"
    outcome = classify_cli_outcome(returncode=1, text=text, now=NOW)
    assert outcome.failure == CLI_USAGE_LIMIT
    assert outcome.reset_at
    assert ( _local(outcome.reset_at).hour, _local(outcome.reset_at).minute ) == (hour, minute)
    details = failure_details(CliFailure(outcome.failure, reset_at=outcome.reset_at))
    blob = json.dumps(details)
    assert CANARY not in blob and EMAIL not in blob and "@" not in blob
    assert set(details) == {"provider_failure", "error", "reset_at"}
    assert details["reset_at"] == outcome.reset_at
    assert "6:20am" not in details["error"]
    assert CANARY not in str(CliFailure(outcome.failure, reset_at=outcome.reset_at))


@pytest.mark.parametrize("text", NEGATIVES)
def test_limit_words_inside_task_text_are_not_a_usage_limit(text: str) -> None:
    outcome = classify_cli_outcome(returncode=1, text=text, now=NOW)
    assert outcome.failure == "cli-error"
    assert outcome.reset_at is None
    blob = json.dumps(failure_details(CliFailure(outcome.failure)))
    assert CANARY not in blob and EMAIL not in blob
    assert "reset_at" not in blob


def test_a_zero_exit_and_a_timeout_are_not_a_usage_limit() -> None:
    phrase = "Limit reached ∙ resets 6:20am"
    assert classify_cli_outcome(returncode=0, text=phrase, now=NOW).failure == "cli-error"
    assert classify_cli_outcome(returncode=1, text=phrase, timed_out=True, now=NOW).failure == "cli-timeout"


def test_a_limit_without_a_clock_still_classifies_and_stores_no_time() -> None:
    outcome = classify_cli_outcome(returncode=1, text=f"usage limit reached {CANARY}", now=NOW)
    assert outcome.failure == CLI_USAGE_LIMIT
    assert outcome.reset_at is None
    details = failure_details(CliFailure(outcome.failure, reset_at=CANARY))
    assert details["provider_failure"] == CLI_USAGE_LIMIT
    assert "reset_at" not in details
    assert CANARY not in json.dumps(details)


def test_sign_in_still_wins_when_the_line_is_not_a_limit() -> None:
    assert classify_cli_outcome(returncode=1, text="Not logged in. Run the login command.", now=NOW).failure == "cli-signin"


def _status(status: int, headers: dict[str, str] | None = None, body: bytes = b"") -> httpx.HTTPStatusError:
    request = httpx.Request("POST", "https://api.example.test/v1")
    response = httpx.Response(status, headers=headers or {}, content=body, request=request)
    return httpx.HTTPStatusError("x", request=request, response=response)


def test_http_429_with_retry_after_seconds_is_a_usage_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("providers.outcomes._now", lambda: NOW)
    details = failure_details(_status(429, {"Retry-After": "120"}, body=f"slow down {CANARY} {EMAIL}".encode()))
    assert details["provider_failure"] == CLI_USAGE_LIMIT
    assert datetime.fromisoformat(details["reset_at"]) == NOW + timedelta(seconds=120)
    blob = json.dumps(details)
    assert CANARY not in blob and EMAIL not in blob and "@" not in blob


def test_http_429_with_an_http_date_keeps_that_instant(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("providers.outcomes._now", lambda: NOW)
    details = failure_details(_status(429, {"Retry-After": "Sat, 21 Nov 2026 12:20:00 GMT"}))
    assert details["provider_failure"] == CLI_USAGE_LIMIT
    assert datetime.fromisoformat(details["reset_at"]) == datetime(2026, 11, 21, 12, 20, tzinfo=timezone.utc)


def test_http_429_without_a_usable_retry_after_stores_no_time() -> None:
    for header in (None, {"Retry-After": "soon"}, {"Retry-After": EMAIL}):
        details = failure_details(_status(429, header))
        assert details["provider_failure"] == CLI_USAGE_LIMIT
        assert "reset_at" not in details
        assert "@" not in json.dumps(details)


def test_adapter_threads_the_class_and_drops_the_cli_text() -> None:
    stderr = f"Limit reached ∙ resets 6:20am {CANARY} {EMAIL}"

    async def run(argv, *, cwd, env, timeout, stdin=None):
        return CliRunResult(returncode=1, stdout="", stderr=stderr)

    adapter = ClaudeCliAdapter(runner=run)
    result = asyncio.run(adapter.invoke("hi", AdapterConfig(adapter="", model="", extra={})))
    assert result.failure == CLI_USAGE_LIMIT
    assert result.reset_at
    assert CANARY not in result.error and EMAIL not in result.error
    assert result.error == CLI_FAILURE_MESSAGES[CLI_USAGE_LIMIT]

    async def drain():
        return [chunk async for chunk in adapter.stream("hi", AdapterConfig(adapter="", model="", extra={}))]

    with pytest.raises(CliFailure) as caught:
        asyncio.run(drain())
    assert caught.value.failure == CLI_USAGE_LIMIT
    assert caught.value.reset_at == result.reset_at
    assert CANARY not in str(caught.value) and EMAIL not in str(caught.value)


def test_a_reset_instant_past_the_retry_after_cap_is_dropped() -> None:
    from adapters.cli_shared import clean_reset_at

    now = datetime(2026, 11, 21, 9, 0, tzinfo=timezone.utc)
    assert clean_reset_at("2026-12-05T09:00:00+00:00", now=now) == "2026-12-05T09:00:00+00:00"
    assert clean_reset_at("2026-12-05T09:00:01+00:00", now=now) is None
    assert clean_reset_at("2099-01-01T00:00:00Z", now=now) is None
    assert CliFailure(CLI_USAGE_LIMIT, reset_at="2099-01-01T00:00:00Z").reset_at is None


def test_a_run_level_error_carries_the_usage_limit_class_and_the_reset_instant(monkeypatch: pytest.MonkeyPatch) -> None:
    """A failure outside any node still names the class, so the chat can show the limit banner."""
    from fastapi.testclient import TestClient

    from main import app

    reset = (datetime.now(timezone.utc) + timedelta(minutes=20)).replace(microsecond=0).isoformat()

    async def stream(*args, **kwargs):
        raise CliFailure(CLI_USAGE_LIMIT, reset_at=reset)
        yield ""  # an async generator, like the engine's

    monkeypatch.setattr("routers.execution.execute_harness", stream)
    with TestClient(app) as client:
        response = client.post("/execute/", json={"graph_json": {"nodes": [], "edges": []}})
    frames = [f for f in response.text.split("\n\n") if f.startswith("event: error")]
    assert len(frames) == 1
    data = json.loads(frames[0].split("data: ", 1)[1])
    assert data == {"provider_failure": CLI_USAGE_LIMIT, "error": CLI_FAILURE_MESSAGES[CLI_USAGE_LIMIT], "reset_at": reset}
