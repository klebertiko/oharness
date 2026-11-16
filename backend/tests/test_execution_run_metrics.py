"""
Run metrics on the wire must be honest: a duration is only ever a duration the
sidecar actually timed (never a hard-coded 0 the UI would render as "0ms"), and
token provenance is stated explicitly (`tokens_estimated`) so the UI can label
a count "estimated" only when it really was estimated.
"""
from __future__ import annotations

import asyncio

from fastapi.testclient import TestClient

from adapters.base import AdapterConfig, AdapterResult
from test_execution_budget_enforcement import (  # noqa: F401 -- `client` is a pytest fixture
    _FixedTokenAdapter,
    _graph,
    _sse_events,
    client,
)

_INTAKE = "reply with these exact characters and nothing else"


class _TimedChat(_FixedTokenAdapter):
    """Answers the intake call directly (a routed-direct reply) after a real delay."""

    def __init__(self, tokens_used: int) -> None:
        super().__init__(tokens_used)
        self.reported = tokens_used

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        if _INTAKE in prompt:
            await asyncio.sleep(0.03)
            return AdapterResult(content="Sim, 1 + 1 = 2.", tokens_used=self.reported)
        raise AssertionError("a routed-direct reply must not make a second call")


class _NoUsageStream(_FixedTokenAdapter):
    """A streaming adapter that never reports usage (the count must then be estimated)."""

    async def stream_events(self, prompt: str, config: AdapterConfig):
        yield {"kind": "text", "text": "real output"}


def _execute(client: TestClient, monkeypatch, adapter) -> dict[str, dict]:
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: adapter)
    monkeypatch.setattr("routers.execution.get_adapter", lambda name: adapter)
    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "live", "instruction": "quanto e 1+1"})
    assert resp.status_code == 200
    return {name: data for name, data in _sse_events(resp.text)}


def _direct(client: TestClient, monkeypatch, adapter) -> dict[str, dict]:
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: adapter)
    monkeypatch.setattr("routers.execution.get_adapter", lambda name: adapter)
    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "metered", "model": "claude-sonnet-5"},
    )
    assert resp.status_code == 200
    return {name: data for name, data in _sse_events(resp.text)}


# ── routed-direct reply (a plain chat answer — the "Sim, 1 + 1 = 2." case) ───


def test_reply_only_run_reports_a_measured_duration_not_a_hardcoded_zero(client, monkeypatch) -> None:
    events = _execute(client, monkeypatch, _TimedChat(19))

    assert events["node_done"]["output"] == "Sim, 1 + 1 = 2."
    assert events["node_done"]["latency_ms"] >= 25  # the adapter really took ~30ms
    assert events["harness_done"]["elapsed_ms"] >= events["node_done"]["latency_ms"]


def test_reply_only_run_with_provider_reported_tokens_is_not_flagged_estimated(client, monkeypatch) -> None:
    events = _execute(client, monkeypatch, _TimedChat(19))

    assert events["node_done"]["tokens"] == 19
    assert events["node_done"]["tokens_estimated"] is False
    assert events["harness_done"]["total_tokens"] == 19
    assert events["harness_done"]["tokens_estimated"] is False


def test_reply_only_run_without_provider_usage_is_flagged_estimated(client, monkeypatch) -> None:
    events = _execute(client, monkeypatch, _TimedChat(0))

    assert events["node_done"]["tokens"] == max(1, len("Sim, 1 + 1 = 2.") // 4)
    assert events["node_done"]["tokens_estimated"] is True
    assert events["harness_done"]["tokens_estimated"] is True


# ── harness graph run ────────────────────────────────────────────────────────


def test_harness_run_with_reported_usage_is_not_flagged_estimated(client, monkeypatch) -> None:
    events = _execute(client, monkeypatch, _FixedTokenAdapter(1234))

    assert events["node_done"]["tokens"] == 1234
    assert events["node_done"]["tokens_estimated"] is False
    assert events["harness_done"]["tokens_estimated"] is False
    assert events["node_done"]["latency_ms"] >= 0 and events["harness_done"]["elapsed_ms"] >= 0


def test_harness_run_where_the_adapter_reports_no_usage_is_flagged_estimated(client, monkeypatch) -> None:
    events = _execute(client, monkeypatch, _NoUsageStream(0))

    assert events["node_done"]["tokens"] >= 1
    assert events["node_done"]["tokens_estimated"] is True
    assert events["harness_done"]["tokens_estimated"] is True


# ── direct (no-graph) run ────────────────────────────────────────────────────


def test_direct_run_with_reported_usage_is_not_flagged_estimated(client, monkeypatch) -> None:
    events = _direct(client, monkeypatch, _FixedTokenAdapter(321))

    assert events["node_done"]["tokens"] == 321
    assert events["node_done"]["tokens_estimated"] is False
    assert events["harness_done"]["tokens_estimated"] is False


def test_direct_run_where_the_adapter_reports_no_usage_is_flagged_estimated(client, monkeypatch) -> None:
    events = _direct(client, monkeypatch, _NoUsageStream(0))

    assert events["node_done"]["tokens"] >= 1
    assert events["node_done"]["tokens_estimated"] is True
    assert events["harness_done"]["tokens_estimated"] is True
