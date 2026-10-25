"""
SEC P2-4 re-review (2026-09-15) -- the first fix for "unpriced tokens cost
$0.00 so a configured budget never sees them" sampled only the *first* node
in the graph with a `providerIds` field to decide whether the whole run's
spend was priced. A harness graph is a walk, not one node: SEC demonstrated
that a priced first node -- or an intrinsic decoy node that never spends at
all, claiming a priced model or a local connection -- let every *other*
node in the graph run completely un-budgeted.

The fix moves the check into the node loop itself (`engine.py`), so every
real (non-mock) node is checked against its own `resolve_node_provider()`
result -- never a graph-author-supplied claim from a different node --
right before that node's adapter is called. These tests exercise the
engine's own per-node wiring directly, using a lightweight stand-in for
`usage_tracking.enforce_budget_or_raise` (reusing the real
`blended_price_per_mtok` pricing lookup, not a second fake price table) so
they need no database. The real, database-backed closure that
`routers/execution.py` wires into `execute_harness`'s new `enforce_budget`
parameter is covered end to end by `test_execution_budget_enforcement.py`.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import pytest

from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
from engine import RunControl, execute_harness
from secret_store.memory import MemorySecrets
from usage_tracking import BudgetExceededError, blended_price_per_mtok


class _RecordingAdapter(AgentAdapter):
    """Records every config it was actually invoked with -- lets a test
    prove a refused node's adapter was never reached at all, not just that
    a node_error appeared somewhere later in the stream."""

    def __init__(self, tokens: int = 100_000) -> None:
        self.tokens = tokens
        self.calls: list[AdapterConfig] = []

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        self.calls.append(config)
        return AdapterResult(content="real output", tokens_used=self.tokens)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        yield "real output"

    async def stream_events(self, prompt: str, config: AdapterConfig):
        self.calls.append(config)
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
        },
        "ollama-local": {
            "id": "ollama-local",
            "provider": "ollama",
            "label": "Ollama (local)",
            "residence": "local",
            "endpoint": "http://127.0.0.1:11434/v1",
            "enabled": True,
            "secretRef": None,
        },
    }


def _budget_gate(limit_usd: float | None):
    """Stand-in for `usage_tracking.enforce_budget_or_raise`'s per-node
    contract: same (model, residence) -> raise-or-pass shape, same real
    pricing lookup, but no database -- spend-so-far is fixed at "under the
    limit" here since these tests are only about the engine's own wiring
    (which node gets checked, with which resolved values, whether refusal
    happens before any adapter call), not the ledger arithmetic that
    test_usage_tracking.py and test_execution_budget_enforcement.py's
    HTTP-level tests already cover."""

    async def _check(model: str | None, residence: str | None) -> None:
        if limit_usd is None:
            return
        if model and residence != "local" and blended_price_per_mtok(model) is None:
            raise BudgetExceededError(
                f"A budget of ${limit_usd:,.2f} is configured, but the price for "
                f"model '{model}' is not in the catalog."
            )

    return _check


def _run(
    graph: dict,
    monkeypatch: pytest.MonkeyPatch,
    *,
    enforce_budget=None,
    tokens: int = 100_000,
) -> tuple[list[tuple[str, dict]], _RecordingAdapter]:
    stub = _RecordingAdapter(tokens)
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
            enforce_budget=enforce_budget,
        ):
            chunks.append(chunk)
        return chunks

    return _events(asyncio.run(collect())), stub


def _llm_node(node_id: str, connection_id: str, model: str, label: str | None = None) -> dict:
    return {
        "id": node_id,
        "type": "llm",
        "data": {"label": label or node_id, "providerIds": [connection_id], "model": model},
    }


# ── Scenario 1 -- priced node, then an unpriced node ─────────────────────────


def test_priced_then_unpriced_two_node_graph_is_refused_at_the_unpriced_node(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            _llm_node("draft", "anthropic", "claude-opus-5", "Draft"),
            _llm_node("review", "anthropic", "z-ai/glm-4.6", "Review"),
        ],
        "edges": [
            {"source": "in", "target": "draft"},
            {"source": "draft", "target": "review"},
        ],
    }
    events, stub = _run(graph, monkeypatch, enforce_budget=_budget_gate(5.0))

    draft_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert draft_done["output"] == "real output"

    review_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "review")
    assert "budget" in review_error["error"].lower()
    assert not any(n == "node_done" and d["node_id"] == "review" for n, d in events)

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"
    assert harness_done["total_tokens"] == 100_000  # only "draft" actually spent

    # The unpriced node's adapter was never reached -- only "draft" spent.
    assert len(stub.calls) == 1


# ── Scenario 2 -- majority-unpriced chain (SEC's literal repro shape) ───────


def test_majority_unpriced_chain_stops_at_the_first_unpriced_node(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    nodes = [
        {"id": "in", "type": "input", "data": {"prompt": "hi"}},
        _llm_node("priced", "anthropic", "claude-opus-5"),
    ]
    edges = [{"source": "in", "target": "priced"}]
    prev = "priced"
    for i in range(8):
        node_id = f"unpriced-{i}"
        nodes.append(_llm_node(node_id, "anthropic", "z-ai/glm-4.6"))
        edges.append({"source": prev, "target": node_id})
        prev = node_id
    graph = {"nodes": nodes, "edges": edges}

    events, stub = _run(graph, monkeypatch, enforce_budget=_budget_gate(5.0))

    assert any(n == "node_done" and d["node_id"] == "priced" for n, d in events)
    first_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "unpriced-0")
    assert "budget" in first_error["error"].lower()

    # None of the other seven unpriced nodes were ever even started, let
    # alone charged real tokens -- the old bug let all nine run.
    for i in range(1, 8):
        assert not any(d.get("node_id") == f"unpriced-{i}" for _, d in events)
    assert len(stub.calls) == 1

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"
    assert harness_done["total_tokens"] == 100_000  # only "priced" actually spent


# ── Scenario 3 -- decoy intrinsic node claiming a priced model ──────────────


def test_decoy_intrinsic_node_does_not_hide_real_unpriced_llm_nodes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = {
        "nodes": [
            {
                "id": "in",
                "type": "input",
                "data": {"prompt": "hi", "providerIds": ["anthropic"], "model": "claude-opus-5"},
            },
            _llm_node("n1", "anthropic", "z-ai/glm-4.6"),
            _llm_node("n2", "anthropic", "z-ai/glm-4.6"),
        ],
        "edges": [
            {"source": "in", "target": "n1"},
            {"source": "n1", "target": "n2"},
        ],
    }
    events, stub = _run(graph, monkeypatch, enforce_budget=_budget_gate(5.0))

    # The decoy "in" node never resolves a provider at all -- it is
    # intrinsic -- so its claimed providerIds/model are inert.
    n1_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "n1")
    assert "budget" in n1_error["error"].lower()
    assert not any(d.get("node_id") == "n2" for _, d in events)
    assert stub.calls == []  # neither real llm node's adapter was ever reached

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"
    assert harness_done["total_tokens"] == 0


# ── Scenario 4 -- decoy local-residence node hiding real cloud spend ────────


def test_decoy_local_residence_node_does_not_exempt_real_cloud_spend(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    graph = {
        "nodes": [
            {
                "id": "in",
                "type": "input",
                "data": {"prompt": "hi", "providerIds": ["ollama-local"], "model": "qwen3.5:9b"},
            },
            _llm_node("n1", "anthropic", "z-ai/glm-4.6"),
        ],
        "edges": [{"source": "in", "target": "n1"}],
    }
    events, stub = _run(graph, monkeypatch, enforce_budget=_budget_gate(5.0))

    n1_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "n1")
    assert "budget" in n1_error["error"].lower()
    assert stub.calls == []

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"
    assert harness_done["total_tokens"] == 0


# ── Regression guard -- opt-in only ──────────────────────────────────────────


def test_no_enforce_budget_callback_behaves_exactly_as_before(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Every pre-existing caller of `execute_harness` (five other engine
    test files, plus routers/execution.py in mock mode) does not pass
    `enforce_budget` at all -- the parameter must default to a no-op so
    none of them need to change."""
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            _llm_node("draft", "anthropic", "z-ai/glm-4.6"),
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }
    events, stub = _run(graph, monkeypatch, enforce_budget=None)

    assert not any(n == "node_error" for n, _ in events)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["output"] == "real output"
    assert len(stub.calls) == 1
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"
