"""
The global USD budget gates real spend before it starts (POST /execute/ and
POST /execute/direct), and a completed real run writes its usage into the
ledger (GET /usage/summary) -- the two halves of the feature wired together
end to end, the same way test_execution_provider_resolution.py already
proves the router <-> engine <-> resolver wiring for provider resolution.
"""
from __future__ import annotations

import json

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
from database import SessionLocal
from main import app
from models import BudgetConfig, UsageRecord
from secret_store.memory import MemorySecrets


class _FixedTokenAdapter(AgentAdapter):
    def __init__(self, tokens: int = 100_000) -> None:
        self.tokens = tokens

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        if "reply with these exact characters and nothing else" in prompt:
            return AdapterResult(content="<<ENGAGE_HARNESS>>")
        return AdapterResult(content="real output", tokens_used=self.tokens)

    async def stream(self, prompt: str, config: AdapterConfig):
        yield "real output"

    async def stream_events(self, prompt: str, config: AdapterConfig):
        yield {"kind": "text", "text": "real output"}
        yield {"kind": "usage", "tokens": self.tokens}


async def _reset() -> None:
    async with SessionLocal() as db:
        await db.execute(delete(UsageRecord))
        await db.execute(delete(BudgetConfig))
        await db.commit()


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    store = MemorySecrets()
    store.put("oharness/anthropic", "sk-ant-REAL")
    connections = {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "oharness/anthropic",  # gitleaks:allow
        },
        # residence: "local" -- used by the P2-4 unpriced-model tests below to
        # confirm a genuinely-free local connection is never refused just
        # because its model has no catalog price.
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
    # Two different call sites pick an adapter for these two endpoints:
    # POST /execute/ goes through resolve_node_provider (providers.resolution.
    # get_adapter); POST /execute/direct calls adapters.get_adapter directly
    # (imported into routers.execution's own namespace) and never touches
    # provider resolution at all. Both must be stubbed or one endpoint's
    # test would silently hit whatever real CLI adapter happens to be
    # installed on this machine.
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _FixedTokenAdapter(100_000))
    monkeypatch.setattr("routers.execution.get_adapter", lambda name: _FixedTokenAdapter(100_000))
    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as c:
        app.state.secrets_store = store
        app.state.provider_connections = connections
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


def _sse_events(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        lines = block.splitlines()
        name = next((l.removeprefix("event: ") for l in lines if l.startswith("event: ")), None)
        data_line = next((l.removeprefix("data: ") for l in lines if l.startswith("data: ")), None)
        if name and data_line:
            events.append((name, json.loads(data_line)))
    return events


def _graph() -> dict:
    return {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {
                "id": "draft",
                "type": "llm",
                "data": {"label": "Draft", "providerIds": ["anthropic"], "model": "claude-sonnet-5"},
            },
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }


# ── /execute/direct ──────────────────────────────────────────────────────────


def test_direct_run_records_real_usage(client: TestClient) -> None:
    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "anthropic", "model": "claude-sonnet-5"},
    )
    assert resp.status_code == 200

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 100_000
    assert summary["totalCostUsd"] == pytest.approx(0.9)
    by_source = {row["source"]: row for row in summary["bySource"]}
    assert by_source["direct"]["tokensTotal"] == 100_000


def test_direct_run_refused_when_budget_already_exceeded(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 0.5})
    # Spend past it first.
    client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "anthropic", "model": "claude-sonnet-5"},
    )
    before = client.get("/usage/summary").json()["totalTokens"]

    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi again", "mode": "live", "connection_id": "anthropic", "model": "claude-sonnet-5"},
    )
    assert resp.status_code == 402
    assert "budget" in resp.json()["detail"].lower()

    after = client.get("/usage/summary").json()["totalTokens"]
    assert after == before  # the refused call spent nothing


def test_direct_mock_mode_ignores_budget(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 0})  # blocks everything real
    resp = client.post("/execute/direct", json={"instruction": "hi", "mode": "mock"})
    assert resp.status_code == 200


# ── /execute/ (harness) ──────────────────────────────────────────────────────


def test_harness_run_records_real_usage_per_node(client: TestClient) -> None:
    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "live"})
    assert resp.status_code == 200

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 100_000
    by_conn = {row["connectionId"]: row for row in summary["byConnection"]}
    assert by_conn["anthropic"]["tokensTotal"] == 100_000
    assert by_conn["anthropic"]["costUsd"] == pytest.approx(0.9)


def test_harness_run_refused_when_budget_already_exceeded(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 0.5})
    client.post("/execute/", json={"graph_json": _graph(), "mode": "live"})

    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "live"})
    assert resp.status_code == 402
    body = resp.json()
    assert "0.50" in body["detail"] or "$0.50" in body["detail"]


def test_harness_mock_mode_ignores_budget(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 0})
    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "mock"})
    assert resp.status_code == 200


def test_harness_run_emits_warning_event_at_80_percent(client: TestClient) -> None:
    # First run spends $0.90 against a $1 budget (90% -> already past warn).
    client.put("/usage/budget", json={"limitUsd": 1.0})
    first = client.post("/execute/", json={"graph_json": _graph(), "mode": "live"})
    assert first.status_code == 200
    # Confirm we are now in "warning" territory but not yet exceeded, else
    # the next call would 402 rather than warn.
    status = client.get("/usage/budget").json()
    assert status["state"] == "warning"

    # A second harness node's worth of spend would push it over -- since
    # each node here spends $0.90 and the ceiling is $1, this next run must
    # still be *allowed* (only already-committed spend is checked at start)
    # but should announce the warning up front.
    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    warning = next((d for n, d in events if n == "budget_warning"), None)
    assert warning is not None
    assert warning["limitUsd"] == 1.0


# ── P2-4: unpriced-model budget bypass ───────────────────────────────────────
# SEC found that a model outside the price catalog always costs $0.00 to the
# ledger, so a configured budget never saw it and never refused -- an
# unattended run could spend real, unbounded money on a model the catalog
# simply hadn't been updated for yet. These confirm the fix end to end
# through both real-spend endpoints, not just usage_tracking's own unit tests.


def test_direct_run_refused_for_unpriced_model_when_budget_configured(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 5.0})
    resp = client.post(
        "/execute/direct",
        json={
            "instruction": "hi",
            "mode": "live",
            "connection_id": "anthropic",
            "model": "some-model-not-in-any-catalog",
        },
    )
    assert resp.status_code == 402
    assert "budget" in resp.json()["detail"].lower()

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 0  # refused before the adapter was ever called


def test_direct_run_allows_unpriced_model_when_no_budget_configured(client: TestClient) -> None:
    resp = client.post(
        "/execute/direct",
        json={
            "instruction": "hi",
            "mode": "live",
            "connection_id": "anthropic",
            "model": "some-model-not-in-any-catalog",
        },
    )
    assert resp.status_code == 200

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 100_000
    assert summary["totalCostUsd"] == 0.0
    assert summary["unpricedTokens"] == 100_000


def test_direct_run_allows_unpriced_model_on_local_residence_even_with_budget(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 5.0})
    resp = client.post(
        "/execute/direct",
        json={
            "instruction": "hi",
            "mode": "live",
            "connection_id": "ollama-local",
            "model": "some-local-model-not-in-catalog",
        },
    )
    assert resp.status_code == 200

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 100_000
    assert summary["totalCostUsd"] == 0.0


def test_harness_run_refused_for_unpriced_model_when_budget_configured(client: TestClient) -> None:
    """Mechanism changed by the SEC re-review fix (2026-09-15): refusal for
    a harness graph now happens inside the node loop, once per real node,
    using that node's own resolved connection -- not a pre-run guess at
    "the" model for the whole graph (the old guess sampled only the first
    node with a `providerIds` field, which a multi-node or decoy graph
    could defeat -- see the tests below). For this single-node graph the
    *intent* is unchanged (refused, zero spend) but the *shape* differs:
    the stream starts (200) and the one real node reports its own honest
    node_error, instead of the request never streaming at all (402)."""
    client.put("/usage/budget", json={"limitUsd": 5.0})
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {
                "id": "draft",
                "type": "llm",
                "data": {
                    "label": "Draft",
                    "providerIds": ["anthropic"],
                    "model": "some-model-not-in-any-catalog",
                },
            },
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert "budget" in node_error["error"].lower()
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 0


# ── SEC re-review, 2026-09-15: the first P2-4 fix sampled only the *first*
# node with a `providerIds` field to preview the whole run's model/residence
# -- graph-author-supplied data, not necessarily a node that ever spends.
# These four are SEC's own exact reproduction shapes, now proven refused end
# to end (router -> engine -> per-node resolver), not just at the engine
# level (test_engine_budget_enforcement.py covers the mechanism itself
# without a real HTTP round trip or a database).


def test_harness_run_refuses_a_later_unpriced_node_not_just_the_first(client: TestClient) -> None:
    client.put("/usage/budget", json={"limitUsd": 5.0})
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {
                "id": "draft",
                "type": "llm",
                "data": {"label": "Draft", "providerIds": ["anthropic"], "model": "claude-opus-5"},
            },
            {
                "id": "review",
                "type": "llm",
                "data": {"label": "Review", "providerIds": ["anthropic"], "model": "z-ai/glm-4.6"},
            },
        ],
        "edges": [
            {"source": "in", "target": "draft"},
            {"source": "draft", "target": "review"},
        ],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    assert any(n == "node_done" and d["node_id"] == "draft" for n, d in events)
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "review")
    assert "budget" in node_error["error"].lower()

    # Only "draft" (the priced node) actually spent -- "review" never
    # reached its adapter. Before the fix this graph read $4.50/"ok" while
    # "review" quietly burned 100,000 more real, unpriced tokens.
    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 100_000
    assert summary["totalCostUsd"] == pytest.approx(4.5)


def test_harness_run_refuses_majority_unpriced_graph_not_just_flags_it(client: TestClient) -> None:
    """SEC's literal repro shape: 1 priced node followed by several unpriced
    ones. Before the fix, all of them ran -- the ledger showed a fraction
    of the real spend and the budget stayed at 'warning'/'ok'."""
    client.put("/usage/budget", json={"limitUsd": 5.0})
    nodes = [
        {"id": "in", "type": "input", "data": {"prompt": "hi"}},
        {"id": "priced", "type": "llm", "data": {"providerIds": ["anthropic"], "model": "claude-opus-5"}},
    ]
    edges = [{"source": "in", "target": "priced"}]
    prev = "priced"
    for i in range(8):
        node_id = f"unpriced-{i}"
        nodes.append(
            {"id": node_id, "type": "llm", "data": {"providerIds": ["anthropic"], "model": "z-ai/glm-4.6"}}
        )
        edges.append({"source": prev, "target": node_id})
        prev = node_id
    graph = {"nodes": nodes, "edges": edges}

    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "unpriced-0")
    assert "budget" in node_error["error"].lower()
    for i in range(1, 8):
        assert not any(d.get("node_id") == f"unpriced-{i}" for _, d in events)

    summary = client.get("/usage/summary").json()
    # Only the one priced node spent -- not all nine.
    assert summary["totalTokens"] == 100_000


def test_harness_run_refuses_decoy_intrinsic_node_hiding_real_unpriced_llm_nodes(
    client: TestClient,
) -> None:
    """SEC's decoy reproduction: an `input` node (intrinsic -- never
    resolves a provider, never spends) carries a *priced* model. The old
    pre-run gate read that node's claim and waved the whole run through;
    the real, unpriced `llm` nodes behind it then ran un-budgeted."""
    client.put("/usage/budget", json={"limitUsd": 5.0})
    graph = {
        "nodes": [
            {
                "id": "in",
                "type": "input",
                "data": {"prompt": "hi", "providerIds": ["anthropic"], "model": "claude-opus-5"},
            },
            {"id": "n1", "type": "llm", "data": {"providerIds": ["anthropic"], "model": "z-ai/glm-4.6"}},
            {"id": "n2", "type": "llm", "data": {"providerIds": ["anthropic"], "model": "z-ai/glm-4.6"}},
        ],
        "edges": [{"source": "in", "target": "n1"}, {"source": "n1", "target": "n2"}],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "n1")
    assert "budget" in node_error["error"].lower()
    assert not any(d.get("node_id") == "n2" for _, d in events)

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 0


def test_harness_run_refuses_decoy_local_residence_node_hiding_real_cloud_spend(
    client: TestClient,
) -> None:
    """SEC's residence-spoofing reproduction: an intrinsic decoy node
    claims the *local* connection, which the old gate read as exempting
    the entire run -- including a real `llm` node behind it pinned to the
    cloud connection with an unpriced model."""
    client.put("/usage/budget", json={"limitUsd": 5.0})
    graph = {
        "nodes": [
            {
                "id": "in",
                "type": "input",
                "data": {"prompt": "hi", "providerIds": ["ollama-local"], "model": "qwen3.5:9b"},
            },
            {"id": "n1", "type": "llm", "data": {"providerIds": ["anthropic"], "model": "z-ai/glm-4.6"}},
        ],
        "edges": [{"source": "in", "target": "n1"}],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "n1")
    assert "budget" in node_error["error"].lower()

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 0


# ── P3-2: triage intake spend never recorded on a real harness run ──────────
# `triage.route_message` makes one real adapter call before deciding whether
# to engage the harness. The routed-direct-reply path's spend was always
# counted correctly (it becomes a normal node via `_reply_only_events`). When
# routing decided to engage the harness instead, that same real spend was
# silently discarded -- `routed` was read only for its `.engage_harness`
# flag and never contributed a ledger row.


def test_triage_intake_spend_is_recorded_when_it_engages_the_harness(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    class _EngageWithRealSpend(_FixedTokenAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            if "reply with these exact characters and nothing else" in prompt:
                # The intake call itself spent 42 real tokens before deciding
                # to hand off to the harness -- distinct from the harness
                # node's own 100_000, so the two sources are unambiguous in
                # the assertions below.
                return AdapterResult(content="<<ENGAGE_HARNESS>>", tokens_used=42)
            return await super().invoke(prompt, config)

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _EngageWithRealSpend(100_000))

    resp = client.post(
        "/execute/",
        json={"graph_json": _graph(), "mode": "live", "instruction": "implemente validação de CPF"},
    )
    assert resp.status_code == 200

    summary = client.get("/usage/summary").json()
    by_source = {row["source"]: row for row in summary["bySource"]}
    assert by_source["triage"]["tokensTotal"] == 42
    assert by_source["harness"]["tokensTotal"] == 100_000
    assert summary["totalTokens"] == 100_042


def test_triage_reply_only_path_is_still_recorded_exactly_once(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Regression guard for the fix above: the routed-direct-reply path
    (engage_harness=False) must keep working exactly as before -- its spend
    already reaches the ledger via `_reply_only_events`, and the new
    triage-row logic must not double-count it."""

    class _ChatOnly(_FixedTokenAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            if "reply with these exact characters and nothing else" in prompt:
                return AdapterResult(content="Oi! Tudo bem?", tokens_used=8)
            raise AssertionError("must not make a second call for a routed-direct reply")

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _ChatOnly())

    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "live", "instruction": "oi"})
    assert resp.status_code == 200

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 8
    by_source = {row["source"]: row for row in summary["bySource"]}
    assert by_source["harness"]["tokensTotal"] == 8  # the reply IS the one harness "node"
    assert "triage" not in by_source


# ── SEC P2-5 (2026-09-15): the two paths the P2-4 fix never reached ─────────
# Both bypassed the budget silently in normal use, no adversary required: the
# composer never sends a `model` field at all (grep confirms no UI writes
# `defaultModel` either), so `/execute/direct`'s old pre-resolution guess was
# built from nothing, and `route_message`'s own real adapter call ran before
# any budget check existed for it at all.


def test_direct_run_refused_for_no_model_when_budget_configured(client: TestClient) -> None:
    """The realistic shape: no `model` field at all (the composer never sends
    one). Checked post-resolution now, not a pre-resolution guess -- an empty
    model here means the CLI adapter would fall back to its own invisible
    default, which is exactly as unpriceable as a named-but-uncatalogued one."""
    client.put("/usage/budget", json={"limitUsd": 5.0})
    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "anthropic"},
    )
    assert resp.status_code == 402
    assert "no default model" in resp.json()["detail"].lower()

    summary = client.get("/usage/summary").json()
    assert summary["totalTokens"] == 0  # refused before the adapter was ever called


# No "no model, local residence" variant here: `resolve_node_provider()`
# already requires an explicit model for ollama connections regardless of
# budget (`_HTTP_ADAPTERS_REQUIRE_MODEL` — Ollama has no sensible built-in
# default the way claude/codex do), so that combination 400s before this
# fix's check is ever reached. `test_direct_run_allows_unpriced_model_on_
# local_residence_even_with_budget` above already covers the local exemption
# with a real (named, uncatalogued) model.


def test_triage_refused_when_budget_already_exceeded(client: TestClient) -> None:
    """The intake call spends real tokens before route_message ever returns
    -- it must be gated *before* that call, not recorded honestly after the
    ceiling was already blown. Previously ungated: the plain-chat path is
    the single most common request this app serves."""
    client.put("/usage/budget", json={"limitUsd": 0.01})
    # Spend past it first, via a real (non-triage) direct call.
    client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "anthropic", "model": "claude-sonnet-5"},
    )
    before = client.get("/usage/summary").json()["totalTokens"]

    resp = client.post(
        "/execute/", json={"graph_json": _graph(), "mode": "live", "instruction": "oi"}
    )
    assert resp.status_code == 402
    assert "budget" in resp.json()["detail"].lower()

    after = client.get("/usage/summary").json()["totalTokens"]
    assert after == before  # the refused intake call spent nothing new
