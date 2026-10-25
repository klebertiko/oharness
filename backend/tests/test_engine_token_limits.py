"""
Per-agent (per-node) token limit under a harness run.

An optional `tokenLimit` on a node's `data` (set from the Inspector, same
place as `maxTokens`/`temperature`) caps how many tokens *that node's own
turn* may spend. Unlike `maxTokens` (a generation-length request parameter
sent to the provider), this is a post-hoc spend check: the adapter call has
already completed and its tokens are already real/billed by the time the
engine can know how many it used (every adapter reports usage once, at or
near the end of its stream — see adapters/base.py's `usage` event and every
concrete adapter behind it), so "enforcing" a limit here means marking that
node's output as failed (honest `node_error`, not a silent truncation) and
letting the run continue past it, exactly like any other node_error today —
never pretending the tokens were not spent.

Thresholds mirror the global budget's (`usage_tracking.WARN_THRESHOLD`):
warn, non-blocking, at 80%; hard-stop at/over 100%.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import pytest

from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
from engine import RunControl, execute_harness
from secret_store.memory import MemorySecrets


class _FixedTokenAdapter(AgentAdapter):
    """Reports exactly `tokens` usage, regardless of the (short) text it
    streams — lets a test pick an exact figure to sit above/below a limit
    without depending on `len(output) // 4` estimation."""

    def __init__(self, tokens: int) -> None:
        self.tokens = tokens

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        return AdapterResult(content="real output", tokens_used=self.tokens)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        yield "real output"

    async def stream_events(self, prompt: str, config: AdapterConfig):
        yield {"kind": "text", "text": "real output"}
        yield {"kind": "usage", "tokens": self.tokens}


def _events(chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for c in chunks:
        if not c.startswith("event: "):
            continue
        name, _, rest = c.partition("\n")
        name = name.removeprefix("event: ").strip()
        data_line = rest.strip().removeprefix("data: ")
        out.append((name, json.loads(data_line)))
    return out


def _connections() -> dict[str, dict]:
    return {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "oharness/anthropic",  # gitleaks:allow
        }
    }


def _graph(node_data: dict) -> dict:
    return {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic"], **node_data}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }


def _run(graph: dict, tokens: int, monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, dict]]:
    stub = _FixedTokenAdapter(tokens)
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: stub)
    store = MemorySecrets()
    store.put("oharness/anthropic", "sk-ant-REAL")

    async def collect() -> list[str]:
        control = RunControl("t")
        chunks = []
        async for chunk in execute_harness(
            graph,
            execution_mode="live",
            control=control,
            connections=_connections(),
            secrets_store=store,
        ):
            chunks.append(chunk)
        return chunks

    return _events(asyncio.run(collect()))


def test_node_start_carries_the_resolved_connection_id(monkeypatch: pytest.MonkeyPatch) -> None:
    """The ledger (routers/execution.py) needs to know *which connection* a
    node used to price and attribute its spend -- node_start is the only
    event that ever carries adapter/model, so it must carry this too."""
    events = _run(_graph({}), tokens=10, monkeypatch=monkeypatch)
    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert node_start["connection_id"] == "anthropic"


def test_no_limit_set_behaves_exactly_as_before(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _run(_graph({}), tokens=999_999, monkeypatch=monkeypatch)
    assert not any(n == "node_error" for n, _ in events)
    assert not any(n == "node_token_warning" for n, _ in events)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["tokens"] == 999_999
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


def test_usage_well_under_limit_is_unremarkable(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _run(_graph({"tokenLimit": 1000}), tokens=100, monkeypatch=monkeypatch)
    assert not any(n == "node_error" for n, _ in events)
    assert not any(n == "node_token_warning" for n, _ in events)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["tokens"] == 100


def test_usage_at_80_percent_warns_but_does_not_block(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _run(_graph({"tokenLimit": 1000}), tokens=800, monkeypatch=monkeypatch)
    assert not any(n == "node_error" for n, _ in events)
    warning = next(d for n, d in events if n == "node_token_warning")
    assert warning["node_id"] == "draft"
    assert warning["tokens"] == 800
    assert warning["limit"] == 1000
    assert warning["pct"] == pytest.approx(0.8)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["tokens"] == 800
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"
    assert harness_done["total_tokens"] == 800


def test_usage_at_limit_stops_the_node_honestly_not_the_run(monkeypatch: pytest.MonkeyPatch) -> None:
    events = _run(_graph({"tokenLimit": 1000}), tokens=1000, monkeypatch=monkeypatch)
    assert not any(n == "node_done" and d["node_id"] == "draft" for n, d in events)
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert node_error["tokens"] == 1000
    assert "1000" in node_error["error"]

    # The run reaches a real terminal state -- it is not silently swallowed
    # into a fake "complete".
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"
    # But the tokens genuinely spent on the over-limit node still count
    # toward the run's real total -- they were actually billed.
    assert harness_done["total_tokens"] == 1000


def test_usage_over_limit_still_lets_a_downstream_node_run(monkeypatch: pytest.MonkeyPatch) -> None:
    """An over-limit node is a node_error, not a run-stopper -- exactly the
    existing convention for any other node_error (adapter exception) today:
    the walk continues so a downstream node can still react to the gap."""
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {
                "id": "draft",
                "type": "llm",
                "data": {"label": "Draft", "providerIds": ["anthropic"], "tokenLimit": 500},
            },
            {
                "id": "review",
                "type": "llm",
                "data": {"label": "Review", "providerIds": ["anthropic"]},
            },
        ],
        "edges": [
            {"source": "in", "target": "draft"},
            {"source": "draft", "target": "review"},
        ],
    }
    events = _run(graph, tokens=500, monkeypatch=monkeypatch)
    assert any(n == "node_error" and d["node_id"] == "draft" for n, d in events)
    review_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "review")
    assert review_done["output"] == "real output"
