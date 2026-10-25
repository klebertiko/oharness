"""
End-to-end wiring for POST /execute/: the router must hand the live process's
`app.state.provider_connections` and `app.state.secrets_store` down into the
engine, so a node's `providerIds` resolve against the *real* connections a
person configured under Providers — not nothing.

The adapter classes that actually reach the network are swapped for a stub at
the resolver seam (`providers.resolution.get_adapter`) so this test proves the
in-process wiring without needing real credentials or network access.
"""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
from main import app
from secret_store.memory import MemorySecrets
from triage import LayaRouteDecision


class _StubAdapter(AgentAdapter):
    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        # The routing call is the only caller passing this exact prompt
        # shape (see triage.py's _INTAKE_PROMPT) — answer it honestly with
        # the engage-harness sentinel so every pre-existing test here keeps
        # exercising the full graph unchanged; a dedicated routing test
        # below overrides this stub to answer directly instead.
        if "reply with these exact characters and nothing else" in prompt:
            return AdapterResult(content="<<ENGAGE_HARNESS>>")
        return AdapterResult(content="real output", tokens_used=3)

    async def stream(self, prompt: str, config: AdapterConfig):
        yield "real output"


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
        }
    }
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _StubAdapter())
    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as c:
        app.state.secrets_store = store
        app.state.provider_connections = connections
        yield c


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


def test_run_harness_resolves_pinned_connection_to_real_adapter(client: TestClient) -> None:
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {
                "id": "draft",
                "type": "llm",
                "data": {"label": "Draft", "providerIds": ["anthropic"]},
            },
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)

    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert node_start["adapter"] == "claude"

    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["output"] == "real output"

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


def test_run_harness_triages_a_greeting_to_a_single_reply_no_hitl(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    # Surfaced live, 2026-09-11: "olá" ran all 8 harness roles and then
    # blocked on an HITL approval for nothing. Routing should send a plain
    # greeting to one reply — no PO/SM/.../SEC, no HITL gate, and the
    # routing call's own direct answer IS the reply (one call, not two).
    class _ChatStub(_StubAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            if "reply with these exact characters and nothing else" in prompt:
                return AdapterResult(content="Oi! Tudo bem?", tokens_used=5)
            raise AssertionError("must not make a second call for a routed-direct reply")

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _ChatStub())

    graph = {
        "nodes": [
            {"id": "PO", "type": "agent", "data": {"label": "PO", "providerIds": ["anthropic"]}},
            {"id": "SM", "type": "agent", "data": {"label": "SM", "providerIds": ["anthropic"]}},
            {"id": "HITL", "type": "hitl", "data": {"label": "HITL", "providerIds": ["anthropic"]}},
        ],
        "edges": [
            {"source": "PO", "target": "SM"},
            {"source": "SM", "target": "HITL"},
        ],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live", "instruction": "oi"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)

    run_start = next(d for n, d in events if n == "run_start")
    assert [step["node_id"] for step in run_start["order"]] == ["reply"]
    assert not any(n == "hitl_pause" for n, _ in events)
    assert not any(d.get("node_id") in ("PO", "SM", "HITL") for _, d in events)

    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "reply")
    assert node_done["output"] == "Oi! Tudo bem?"

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"


def test_laya_routing_authorship_is_streamed_and_persisted(
    monkeypatch: pytest.MonkeyPatch, client: TestClient
) -> None:
    class _DirectReplyStub(_StubAdapter):
        async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
            assert "<<ENGAGE_HARNESS>>" not in prompt
            return AdapterResult(content="Sim, 1 + 1 = 2.", tokens_used=6)

    async def laya_decide(_instruction: str) -> LayaRouteDecision:
        return LayaRouteDecision(engage_harness=False, confidence=0.97, latency_ms=9.5)

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _DirectReplyStub())
    monkeypatch.setattr("routers.execution.decide_with_laya", laya_decide)
    graph = {
        "nodes": [
            {"id": "PO", "type": "agent", "data": {"label": "PO", "providerIds": ["anthropic"]}},
        ],
        "edges": [],
    }

    response = client.post(
        "/execute/",
        json={"graph_json": graph, "mode": "live", "instruction": "1+1 é 2?"},
    )
    assert response.status_code == 200
    events = _sse_events(response.text)
    decision = next(data for name, data in events if name == "route_decision")
    assert decision == {
        "source": "laya",
        "reason": "confident",
        "engage_harness": False,
        "confidence": 0.97,
        "latency_ms": 9.5,
    }

    run_id = next(data["run_id"] for name, data in events if name == "run_start")
    persisted = client.get(f"/execute/logs/{run_id}").json()["result"]["events"]
    assert next(event["data"] for event in persisted if event["event"] == "route_decision") == decision


def test_run_harness_persists_real_events_not_just_a_count(client: TestClient) -> None:
    # `Show run detail` in the chat panel only ever lived in the frontend's
    # in-memory reducer — a page reload lost it even though the chat
    # bubble's own summary text survived, because ExecutionLog.result_json
    # used to store `{"events": <count>}`, a number with nothing to replay.
    # GET /execute/logs/{id} must now return the real event list so the
    # frontend can rebuild the step-by-step view after a reload.
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {
                "id": "draft",
                "type": "llm",
                "data": {"label": "Draft", "providerIds": ["anthropic"]},
            },
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    run_id = _sse_events(resp.text)[0][1]["run_id"]

    detail = client.get(f"/execute/logs/{run_id}")
    assert detail.status_code == 200
    events = detail.json()["result"]["events"]
    assert isinstance(events, list)
    assert len(events) > 1

    node_start = next(e for e in events if e["event"] == "node_start" and e["data"]["node_id"] == "draft")
    assert node_start["data"]["adapter"] == "claude"
    node_done = next(e for e in events if e["event"] == "node_done" and e["data"]["node_id"] == "draft")
    assert node_done["data"]["output"] == "real output"
    harness_done = next(e for e in events if e["event"] == "harness_done")
    assert harness_done["data"]["status"] == "complete"


def test_run_harness_unpinned_node_fails_honestly_not_mock(client: TestClient) -> None:
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft"}},  # no providerIds
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }
    resp = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    assert resp.status_code == 200
    events = _sse_events(resp.text)

    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert "provider" in node_error["error"].lower()
    assert not any(n == "node_done" and d.get("node_id") == "draft" for n, d in events)

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"


def test_direct_uses_selected_connection_and_reports_backend_evidence(client: TestClient) -> None:
    response = client.post("/execute/direct", json={
        "instruction": "hello", "mode": "live", "connection_id": "anthropic",
    })
    assert response.status_code == 200
    events = _sse_events(response.text)
    start = next(d for n, d in events if n == "node_start")
    assert start["adapter"] == "claude"
    assert start["connection_id"] == "anthropic"
    done = next(d for n, d in events if n == "node_done")
    assert done["output"] == "real output"
    assert done["provider_verified"] is True
    assert done["connection_id"] == "anthropic"


def test_history_lists_direct_and_harness_with_explicit_source(client):
    """Given both execution paths, when listing history, then their sources differ."""
    direct = client.post("/execute/direct", json={
        "instruction": "hello", "mode": "live", "connection_id": "anthropic",
    })
    harness = client.post("/execute/", json={"mode": "mock", "graph_json": {
        "nodes": [{"id": "in", "type": "input", "data": {"prompt": "hello"}}],
        "edges": [],
    }})
    assert direct.status_code == harness.status_code == 200
    listed = {row["id"]: row for row in client.get("/execute/logs").json()}
    direct_id, harness_id = direct.headers["X-Execution-Id"], harness.headers["X-Execution-Id"]
    assert listed[direct_id]["source"] == "direct"
    assert listed[harness_id]["source"] == "harness"
    assert listed[direct_id]["finished_at"] is not None
    detail = client.get(f"/execute/logs/{direct_id}").json()
    assert detail["source"] == "direct"
    assert detail['harness_id'] == 'direct'
    assert detail['harness_name'] == 'Direct execution'
    assert client.get(f'/execute/logs/{harness_id}').json()['source'] == 'harness'
    # Replay must retain exactly the same events, including verified evidence.
    assert detail["result"]["events"] == [
        {"event": name, "data": data} for name, data in _sse_events(direct.text)
    ]
    done = next(e["data"] for e in detail["result"]["events"] if e["event"] == "node_done")
    assert done["provider_verified"] is True


@pytest.mark.parametrize("connection_id,change,detail", [
    (None, {}, "No provider"), ("missing", {}, "not found"),
    ("anthropic", {"enabled": False}, "disconnected"),
    ("anthropic", {"provider": "cursor"}, "does not serve"),
    ("anthropic", {"provider": "openrouter", "secretRef": None}, "credential"),
])
def test_direct_rejects_unusable_connection(client, connection_id, change, detail):
    app.state.provider_connections["anthropic"].update(change)
    response = client.post("/execute/direct", json={
        "instruction": "hello", "mode": "live", "connection_id": connection_id,
        "adapter": "mock",
    })
    assert response.status_code == 400
    assert detail in response.json()["detail"]


@pytest.mark.parametrize("provider,adapter_name,endpoint,model", [
    ("openai", "codex", "", ""),
    ("ollama", "ollama", "http://localhost:11434/v1", "llama3.2"),
    ("openrouter", "openrouter", "https://openrouter.ai/api/v1", "openai/gpt-4o"),
])
def test_direct_resolves_server_owned_configuration(client, monkeypatch, provider, adapter_name, endpoint, model):
    class ConfigEcho(_StubAdapter):
        async def stream(self, prompt, config):
            assert config.endpoint == endpoint or provider == "openai"
            assert config.model == model
            if provider == "openrouter":
                assert config.api_key == "test-secret"
            yield "configured response"

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: ConfigEcho())
    app.state.secrets_store.put("test-key", "test-secret")
    app.state.provider_connections["chosen"] = {
        "id": "chosen", "provider": provider, "enabled": True,
        "endpoint": endpoint, "defaultModel": model, "secretRef": "test-key",
    }
    response = client.post("/execute/direct", json={
        "instruction": "hello", "mode": "local" if provider == "ollama" else "live",
        "connection_id": "chosen", "adapter": "mock", "api_key": "client-must-not-override",
    })
    assert response.status_code == 200
    events = _sse_events(response.text)
    assert next(d for n, d in events if n == "node_start")["adapter"] == adapter_name
    assert next(d for n, d in events if n == "node_done")["output"] == "configured response"
    assert "test-secret" not in response.text


def test_direct_explicit_simulation_never_verifies_connection(client):
    response = client.post("/execute/direct", json={
        "instruction": "hello", "mode": "mock", "connection_id": "anthropic",
    })
    assert response.status_code == 200
    events = _sse_events(response.text)
    assert next(d for n, d in events if n == "node_start")["adapter"] == "mock"
    assert not any(d.get("provider_verified") for _, d in events)


def test_only_real_harness_turn_has_provider_evidence(client):
    graph = {"nodes": [
        {"id": "input", "type": "input", "data": {
            "prompt": "hello", "adapter": "claude", "providerIds": ["anthropic"],
            "provider_verified": True, "connection_id": "anthropic",
        }},
        {"id": "agent", "type": "agent", "data": {"providerIds": ["anthropic"]}},
    ], "edges": [{"source": "input", "target": "agent"}]}
    response = client.post("/execute/", json={"graph_json": graph, "mode": "live"})
    events = _sse_events(response.text)
    done = {d["node_id"]: d for n, d in events if n == "node_done"}
    assert not done["input"].get("provider_verified")
    assert done["agent"]["provider_verified"] is True
    assert done["agent"]["connection_id"] == "anthropic"


@pytest.mark.parametrize("direct", [True, False])
def test_connection_failure_is_structured_and_keeps_partial_usage(client, monkeypatch, direct):
    import httpx

    class Interrupted(_StubAdapter):
        async def stream_events(self, prompt, config):
            yield {"kind": "text", "text": "partial"}
            yield {"kind": "usage", "tokens": 37}
            raise httpx.ConnectError("private endpoint detail")

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: Interrupted())
    if direct:
        response = client.post("/execute/direct", json={
            "instruction": "hello", "mode": "live", "connection_id": "anthropic",
        })
    else:
        response = client.post("/execute/", json={"mode": "live", "graph_json": {
            "nodes": [{"id": "a", "type": "agent", "data": {"providerIds": ["anthropic"]}}],
            "edges": [],
        }})
    events = _sse_events(response.text)
    error = next(d for n, d in events if n == "node_error")
    assert error["provider_failure"] == "transport"
    assert error["connection_id"] == "anthropic"
    assert error["tokens"] == 37
    assert next(d for n, d in events if n == "harness_done")["total_tokens"] == 37
    assert "private endpoint detail" not in response.text


def test_direct_history_survives_a_fresh_detail_request(client):
    response = client.post("/execute/direct", json={
        "instruction": "hello", "mode": "live", "connection_id": "anthropic",
    })
    run_id = response.headers["X-Execution-Id"]
    detail = client.get(f"/execute/logs/{run_id}")
    assert detail.status_code == 200
    assert detail.json()["status"] == "complete"
    done = next(e["data"] for e in detail.json()["result"]["events"] if e["event"] == "node_done")
    assert done["output"] == "real output"
    assert done["connection_id"] == "anthropic"


@pytest.mark.parametrize("failure", ["transport", "authentication"])
def test_direct_failed_history_preserves_safe_classification(client, monkeypatch, failure):
    """Given a provider failure, when reopening the run, then failure and usage survive safely."""
    import httpx

    class Failing(_StubAdapter):
        async def stream_events(self, prompt, config):
            yield {"kind": "text", "text": "partial response"}
            yield {"kind": "usage", "tokens": 37}
            if failure == "transport":
                raise httpx.ConnectError("private endpoint detail")
            request = httpx.Request("POST", "https://provider.invalid")
            raise httpx.HTTPStatusError("private credential detail", request=request,
                                        response=httpx.Response(401, request=request))

    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: Failing())
    response = client.post("/execute/direct", json={
        "instruction": "hello", "mode": "live", "connection_id": "anthropic",
    })
    run_id = response.headers["X-Execution-Id"]
    detail = client.get(f"/execute/logs/{run_id}")
    assert detail.status_code == 200
    assert detail.json()["status"] == "failed"
    assert detail.json()["finished_at"] is not None
    events = detail.json()["result"]["events"]
    error = next(e["data"] for e in events if e["event"] == "node_error")
    assert error["provider_failure"] == failure
    assert error["connection_id"] == "anthropic"
    assert error["tokens"] == 37
    assert next(e["data"] for e in events if e["event"] == "harness_done")["status"] == "error"
    assert not any(e["data"].get("provider_verified") for e in events)
    assert "private" not in detail.text
    assert next(row for row in client.get("/execute/logs").json() if row["id"] == run_id)["status"] == "failed"
