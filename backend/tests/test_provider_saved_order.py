"""The account order a person saves on the Providers screen is the order failover walks.

Saved through `PUT /providers/preference`, kept on the connection rows (so it
survives a restart), and read by the engine and the direct chat whenever a
request does not pin its own `preference`. The failover signal sent to the
chat carries only a connection id and a closed reason class.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import pytest
from fastapi.testclient import TestClient

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter, ProbeResult
from adapters.cli_shared import CLI_USAGE_LIMIT, CliFailure
from database import SessionLocal
from engine import RunControl, execute_harness
from main import app
from providers.preference import failover_reason_class
from providers.resolution import resolve_node_provider_with_failover
from providers.store import load_all
from secret_store.memory import MemorySecrets


def _rows() -> dict[str, dict]:
    return {
        "anthropic": {
            "id": "anthropic", "provider": "anthropic", "label": "Pessoal",
            "residence": "cloud", "endpoint": "https://api.anthropic.com", "enabled": True,
            "secretRef": None, "defaultModel": "",
        },
        "openrouter": {
            "id": "openrouter", "provider": "openrouter", "label": "Empresa",
            "residence": "cloud", "endpoint": "https://openrouter.ai/api/v1", "enabled": True,
            "secretRef": "oharness/openrouter", "defaultModel": "anthropic/claude-opus-5",
        },
    }


def _secrets() -> MemorySecrets:
    store = MemorySecrets()
    store.put("oharness/openrouter", "sk-or-test-value")
    return store


@pytest.fixture()
def client():
    store = _secrets()
    connections = _rows()
    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as c:
        app.state.secrets_store = store
        app.state.provider_connections = connections
        yield c


async def _reload() -> dict:
    async with SessionLocal() as session:
        return await load_all(session)


# ── API + resolution ───────────────────────────────────────────────────────


def test_saved_order_through_the_api_is_followed_by_failover(client: TestClient) -> None:
    saved = client.put("/providers/preference", json={"order": ["openrouter", "anthropic"]})
    assert saved.status_code == 200
    assert saved.json() == {"order": ["openrouter", "anthropic"]}

    listed = {row["id"]: row for row in client.get("/providers/connections").json()["connections"]}
    assert listed["openrouter"]["rank"] == 0
    assert listed["anthropic"]["rank"] == 1

    connections = app.state.provider_connections
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": ["anthropic", "openrouter"]},
        "llm", "draft", connections=connections, secrets_store=app.state.secrets_store,
    )
    assert resolved.connection_id == "openrouter"
    assert attempts == []

    connections["openrouter"]["enabled"] = False
    resolved, attempts = resolve_node_provider_with_failover(
        {"providerIds": ["anthropic", "openrouter"]},
        "llm", "draft", connections=connections, secrets_store=app.state.secrets_store,
    )
    assert resolved.connection_id == "anthropic"
    assert [(a.connection_id, a.reason_class) for a in attempts] == [("openrouter", "unavailable")]


def test_a_pinned_preference_still_wins_over_the_saved_order(client: TestClient) -> None:
    assert client.put("/providers/preference", json={"order": ["openrouter", "anthropic"]}).status_code == 200
    resolved, _ = resolve_node_provider_with_failover(
        {"providerIds": ["anthropic", "openrouter"], "preference": ["anthropic", "openrouter"]},
        "llm", "draft", connections=app.state.provider_connections, secrets_store=app.state.secrets_store,
    )
    assert resolved.connection_id == "anthropic"


def test_saved_order_survives_a_restart(client: TestClient) -> None:
    assert client.put("/providers/preference", json={"order": ["openrouter", "anthropic"]}).status_code == 200
    reloaded = asyncio.run(_reload())
    assert reloaded["openrouter"]["rank"] == 0
    assert reloaded["anthropic"]["rank"] == 1

    # Dropping an account from the order clears its rank.
    assert client.put("/providers/preference", json={"order": ["anthropic"]}).status_code == 200
    reloaded = asyncio.run(_reload())
    assert reloaded["anthropic"]["rank"] == 0
    assert reloaded["openrouter"]["rank"] is None


def test_preference_refuses_unknown_and_repeated_ids(client: TestClient) -> None:
    assert client.put("/providers/preference", json={"order": ["anthropic", "ghost"]}).status_code == 404
    assert client.put("/providers/preference", json={"order": ["anthropic", "anthropic"]}).status_code == 400
    assert app.state.provider_connections["anthropic"].get("rank") is None


def test_reason_class_is_closed() -> None:
    assert failover_reason_class("usage_limit") == "usage_limit"
    assert failover_reason_class("cli-signin") == "signin"
    assert failover_reason_class("authentication") == "signin"
    assert failover_reason_class("cli-missing") == "unavailable"
    assert failover_reason_class("anything a CLI printed") == "failed"
    assert failover_reason_class(None) == "failed"


# ── Engine: the saved order decides who goes first AND who is left to try ──


class _FailsFirst(AgentAdapter):
    def __init__(self, exc: Exception) -> None:
        self.exc = exc
        self.calls = 0

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        return ProbeResult(ok=True, health="live")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        raise AssertionError("not used")

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls += 1
        raise self.exc
        yield  # pragma: no cover


class _Works(AgentAdapter):
    def __init__(self) -> None:
        self.calls = 0

    async def probe(self, config: AdapterConfig) -> ProbeResult:
        return ProbeResult(ok=True, health="live")

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        return AdapterResult(content="ok", tokens_used=2)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls += 1
        yield "answered"


def _events_from_chunks(chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for c in chunks:
        if not c.startswith("event: "):
            continue
        name, _, rest = c.partition("\n")
        out.append((name.removeprefix("event: ").strip(), json.loads(rest.strip().removeprefix("data: "))))
    return out


def test_engine_walks_the_saved_order_and_still_tries_the_rest(monkeypatch) -> None:
    connections = _rows()
    connections["openrouter"]["rank"] = 0
    connections["anthropic"]["rank"] = 1
    first, second = _FailsFirst(RuntimeError("boom")), _Works()
    monkeypatch.setattr(
        "providers.resolution.get_adapter",
        lambda name: {"openrouter": first, "claude": second}[name],
    )
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic", "openrouter"]}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }

    async def collect() -> list[str]:
        return [
            chunk async for chunk in execute_harness(
                graph, execution_mode="live", control=RunControl("t"),
                connections=connections, secrets_store=_secrets(),
            )
        ]

    events = _events_from_chunks(asyncio.run(collect()))
    assert first.calls == 1
    assert second.calls == 1
    done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert done["connection_id"] == "anthropic"
    assert [(a["connection_id"], a["reason_class"]) for a in done["failover"]["attempts"]] == [("openrouter", "failed")]


# ── Direct chat: the chosen account first, then the saved order ────────────


def _sse(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.split("\n\n"):
        lines = block.splitlines()
        name = next((line.removeprefix("event: ") for line in lines if line.startswith("event: ")), None)
        data = next((line.removeprefix("data: ") for line in lines if line.startswith("data: ")), None)
        if name and data:
            events.append((name, json.loads(data)))
    return events


def _direct(client: TestClient, monkeypatch, adapters: dict) -> list[tuple[str, dict]]:
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: adapters[name])
    resp = client.post("/execute/direct", json={"instruction": "hi", "mode": "live", "step": False, "connection_id": "anthropic"})
    assert resp.status_code == 200
    return _sse(resp.text)


def test_direct_chat_falls_back_along_the_saved_order(client: TestClient, monkeypatch) -> None:
    # The saved order puts Empresa first, but the chat chose Pessoal: Pessoal is tried first.
    assert client.put("/providers/preference", json={"order": ["openrouter", "anthropic"]}).status_code == 200
    limited, works = _FailsFirst(CliFailure(CLI_USAGE_LIMIT)), _Works()
    events = _direct(client, monkeypatch, {"claude": limited, "openrouter": works})

    assert limited.calls == 1
    assert works.calls == 1
    starts = [d for n, d in events if n == "node_start"]
    assert len(starts) == 1
    assert starts[0]["connection_id"] == "openrouter"
    assert starts[0]["failover"] == {"attempts": [{"connection_id": "anthropic", "reason_class": "usage_limit"}]}
    done = next(d for n, d in events if n == "node_done")
    assert done["connection_id"] == "openrouter"
    assert done["output"] == "answered"
    assert not any(n == "node_error" for n, _ in events)
    # Nothing the provider said travels in the signal.
    assert "usage limit was reached" not in json.dumps(starts[0]["failover"])


def test_direct_chat_without_a_saved_order_does_not_fall_back(client: TestClient, monkeypatch) -> None:
    limited, works = _FailsFirst(CliFailure(CLI_USAGE_LIMIT)), _Works()
    events = _direct(client, monkeypatch, {"claude": limited, "openrouter": works})

    assert works.calls == 0
    start = next(d for n, d in events if n == "node_start")
    assert start["connection_id"] == "anthropic"
    assert "failover" not in start
    error = next(d for n, d in events if n == "node_error")
    assert error["connection_id"] == "anthropic"
    assert error["provider_failure"] == CLI_USAGE_LIMIT


def test_direct_chat_resolution_failure_falls_back_too(client: TestClient, monkeypatch) -> None:
    assert client.put("/providers/preference", json={"order": ["anthropic", "openrouter"]}).status_code == 200
    app.state.provider_connections["anthropic"]["enabled"] = False
    works = _Works()
    events = _direct(client, monkeypatch, {"claude": _Works(), "openrouter": works})

    start = next(d for n, d in events if n == "node_start")
    assert start["connection_id"] == "openrouter"
    assert start["failover"] == {"attempts": [{"connection_id": "anthropic", "reason_class": "unavailable"}]}
    assert works.calls == 1
