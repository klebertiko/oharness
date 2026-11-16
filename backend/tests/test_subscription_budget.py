"""
R-PRV-06 / #416 (PRV-06a): the USD budget and the ledger stop treating a
subscription (`credential.kind=cli`) as a metered API.

End to end through the real routers, database and budget gate, with the
adapter stubbed (no CLI is spawned). The contract:

* With a global USD budget set, a run on a `kind=cli` connection with no
  default model is not refused for lacking a model: a subscription spends no
  USD, so the USD ceiling does not apply to it (I11).
* The ledger row says `billing=subscription`, keeps the tokens, and stores the
  cost as unknown (`None`), never as an invented `0.0` or a list price.
* That row never makes the USD budget "unknown": priced API runs after it are
  still enforced normally.
"""
from __future__ import annotations

import json

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
from database import SessionLocal
from main import app
from models import BudgetConfig, UsageRecord
from secret_store.memory import MemorySecrets

TOKENS = 100_000


class _FixedTokenAdapter(AgentAdapter):
    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        return AdapterResult(content="real output", tokens_used=TOKENS)

    async def stream(self, prompt: str, config: AdapterConfig):
        yield "real output"

    async def stream_events(self, prompt: str, config: AdapterConfig):
        yield {"kind": "text", "text": "real output"}
        yield {"kind": "usage", "tokens": TOKENS}


async def _reset() -> None:
    async with SessionLocal() as db:
        await db.execute(delete(UsageRecord))
        await db.execute(delete(BudgetConfig))
        await db.commit()


async def _rows() -> list[UsageRecord]:
    async with SessionLocal() as db:
        return list((await db.execute(select(UsageRecord))).scalars())


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    store = MemorySecrets()
    store.put("oharness/openrouter", "placeholder-not-a-key")
    connections = {
        # Subscription: the Claude CLI seat. No defaultModel on purpose (F5).
        "anthropic": {
            "id": "anthropic", "provider": "anthropic", "label": "Anthropic",
            "residence": "cloud", "endpoint": "https://api.anthropic.com",
            "enabled": True, "secretRef": None,
        },
        # Metered API: the USD budget applies here.
        "openrouter": {
            "id": "openrouter", "provider": "openrouter", "label": "OpenRouter",
            "residence": "cloud", "endpoint": "https://openrouter.ai/api/v1",
            "enabled": True, "secretRef": "oharness/openrouter",  # gitleaks:allow
        },
    }
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _FixedTokenAdapter())
    monkeypatch.setattr("routers.execution.get_adapter", lambda name: _FixedTokenAdapter())
    with TestClient(app) as c:
        app.state.secrets_store = store
        app.state.provider_connections = connections
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


def _sse_events(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.split("\n\n"):
        lines = block.splitlines()
        name = next((l.removeprefix("event: ") for l in lines if l.startswith("event: ")), None)
        data = next((l.removeprefix("data: ") for l in lines if l.startswith("data: ")), None)
        if name and data:
            events.append((name, json.loads(data)))
    return events


def _graph(connection_id: str, model: str | None) -> dict:
    data = {"label": "Draft", "providerIds": [connection_id]}
    if model:
        data["model"] = model
    return {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": data},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }


def _assert_subscription_row(rows: list[UsageRecord]) -> None:
    assert len(rows) == 1
    row = rows[0]
    assert row.billing == "subscription"
    assert row.tokens_total == TOKENS
    assert row.cost_usd is None  # unknown, not an invented 0.0 or list price
    assert row.price_per_mtok is None


def test_direct_subscription_run_without_default_model_is_not_refused_under_usd_budget(client):
    client.put("/usage/budget", json={"limitUsd": 5})
    resp = client.post("/execute/direct", json={"instruction": "hi", "mode": "live", "connection_id": "anthropic"})
    assert resp.status_code == 200, resp.text
    assert "default model" not in resp.text
    _assert_subscription_row(anyio.run(_rows))


def test_harness_subscription_node_without_default_model_is_not_refused_under_usd_budget(client):
    client.put("/usage/budget", json={"limitUsd": 5})
    resp = client.post("/execute/", json={"graph_json": _graph("anthropic", None), "mode": "live"})
    assert resp.status_code == 200, resp.text
    names = [name for name, _ in _sse_events(resp.text)]
    assert "node_done" in names and "node_error" not in names, resp.text
    _assert_subscription_row(anyio.run(_rows))


def test_subscription_usage_never_makes_the_usd_budget_unknown(client):
    client.put("/usage/budget", json={"limitUsd": 5})
    client.post("/execute/direct", json={"instruction": "hi", "mode": "live", "connection_id": "anthropic"})
    budget = client.get("/usage/budget").json()
    assert budget["state"] == "ok"
    # A metered API run after it is still gated and priced normally.
    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "openrouter", "model": "anthropic/claude-opus-5"},
    )
    assert resp.status_code == 200, resp.text
    summary = client.get("/usage/summary").json()
    assert summary["totalCostUsd"] == pytest.approx(TOKENS * 45 / 1_000_000)
    assert summary["costComplete"] is True
    assert summary["subscriptionTokens"] == TOKENS
    by_conn = {row["connectionId"]: row for row in summary["byConnection"]}
    # The seat's cost reads as unknown, never as "$0.00".
    assert by_conn["anthropic"]["estimatedCostUsd"] is None
    assert by_conn["anthropic"]["costComplete"] is False
    assert by_conn["anthropic"]["subscriptionTokens"] == TOKENS
    assert by_conn["openrouter"]["costComplete"] is True


def test_usd_budget_still_refuses_unpriced_metered_api_model(client):
    client.put("/usage/budget", json={"limitUsd": 5})
    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "openrouter", "model": "z-ai/glm-4.6"},
    )
    assert resp.status_code == 402
