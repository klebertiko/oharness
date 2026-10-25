"""Live (provider-backed) paths of /studio/copilot/plan and /studio/assist/field (plan S6)."""
from __future__ import annotations

import json
from pathlib import Path

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

import usage_tracking as ut
from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from database import SessionLocal
from main import app
from models import BudgetConfig, UsageRecord
from secret_store.memory import MemorySecrets
from studio_copilot import catalog, ops, prompts

EXAMPLES = json.loads((Path(catalog.__file__).resolve().parent / "contract_examples.json").read_text(encoding="utf-8"))
BASE = EXAMPLES["baseGraph"]
GOOD_OPS = next(c["ops"] for c in EXAMPLES["cases"] if c["name"] == "add_and_wire")


class Scripted(AgentAdapter):
    def __init__(self, replies):
        self.replies = list(replies)
        self.calls: list[tuple[str, AdapterConfig]] = []

    async def invoke(self, prompt, config):
        self.calls.append((prompt, config))
        return AdapterResult(content=self.replies.pop(0), tokens_used=11)

    async def stream(self, prompt, config):  # pragma: no cover
        yield ""


async def _reset():
    async with SessionLocal() as db:
        await db.execute(delete(UsageRecord))
        await db.execute(delete(BudgetConfig))
        await db.commit()


@pytest.fixture()
def live(monkeypatch):
    store = MemorySecrets()
    store.put("oharness/anthropic", "sk-ant-REAL")
    connections = {
        "conn": {
            "id": "conn", "provider": "anthropic", "label": "Anthropic", "residence": "cloud",
            "endpoint": "https://api.anthropic.com", "enabled": True, "secretRef": "oharness/anthropic",  # gitleaks:allow
            "defaultModel": "claude-sonnet-5",
        }
    }
    holder = {}

    def install(*replies):
        adapter = Scripted(replies)
        holder["adapter"] = adapter
        monkeypatch.setattr("providers.resolution.get_adapter", lambda name: adapter)
        return adapter

    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as client:
        app.state.secrets_store = store
        app.state.provider_connections = connections
        anyio.run(_reset)
        yield client, install
    anyio.run(_reset)


def _plan(**over):
    body = {"message": "add a reviewer", "history": [], "graph": BASE, "mode": "live", "connection_id": "conn"}
    body.update(over)
    return body


def _assist(**over):
    body = {
        "field": "systemPrompt", "action": "draft", "node": {"type": "agent", "label": "Reviewer"},
        "current": "", "intent": "review pull requests for test coverage", "neighbours": [],
        "harnessName": "Demo", "mode": "live", "connection_id": "conn",
    }
    body.update(over)
    return body


# ── /studio/copilot/plan ────────────────────────────────────────────────────

def test_plan_returns_validated_model_ops(live):
    client, install = live
    adapter = install(json.dumps({"summary": "Added a Reviewer.", "ops": GOOD_OPS}))
    res = client.post("/studio/copilot/plan", json=_plan())
    assert res.status_code == 200
    data = res.json()
    assert data["source"] == "model" and data["tokens"] == 11
    assert data["summary"] == "Added a Reviewer."
    assert ops.validate_ops(BASE, data["ops"])["ok"] is True
    prompt, config = adapter.calls[0]
    assert config.system_prompt == prompts.plan_system_prompt()
    assert config.temperature == 0.2
    assert config.extra.get("cwd") is None
    assert "<request>add a reviewer</request>" in prompt


def test_plan_repairs_an_invalid_reply_once(live):
    client, install = live
    bad = json.dumps({"summary": "x", "ops": [{"op": "connect", "from": "nope", "to": "g1"}]})
    adapter = install(bad, json.dumps({"summary": "Fixed.", "ops": GOOD_OPS}))
    res = client.post("/studio/copilot/plan", json=_plan())
    assert res.status_code == 200 and res.json()["summary"] == "Fixed."
    assert "Your previous reply was rejected" in adapter.calls[1][0]
    assert "unknown_node" in adapter.calls[1][0]


def test_model_ops_that_touch_credentials_are_never_returned(live):
    client, install = live
    evil = json.dumps({"summary": "pwn", "ops": [{"op": "updateNode", "id": "a1", "config": {"secretRef": "oharness/anthropic"}}]})  # gitleaks:allow
    adapter = install(evil, evil)
    res = client.post("/studio/copilot/plan", json=_plan())
    assert res.status_code == 422
    body = res.json()
    assert body["error"] == "plan_invalid"
    assert "ops" not in body and "secretRef" not in json.dumps({k: v for k, v in body.items() if k != "detail"})
    assert len(adapter.calls) == 2


def test_plan_with_a_prose_only_reply_is_422(live):
    client, install = live
    install("I would love to help!", "Still prose.")
    assert client.post("/studio/copilot/plan", json=_plan()).status_code == 422


def test_plan_accepts_a_clarifying_question(live):
    client, install = live
    install(json.dumps({"summary": "Which step should come first?", "ops": []}))
    res = client.post("/studio/copilot/plan", json=_plan())
    assert res.status_code == 200 and res.json()["ops"] == []


@pytest.mark.parametrize("reply", [
    {"ops": []},
    {"summary": 5, "ops": []},
    {"summary": "x" * 601, "ops": []},
    {"summary": "ok", "ops": "none"},
    {"summary": "", "ops": []},
])
def test_plan_rejects_malformed_plan_objects(live, reply):
    client, install = live
    install(json.dumps(reply), json.dumps(reply))
    assert client.post("/studio/copilot/plan", json=_plan()).status_code == 422


def test_live_without_a_connection_is_provider_unavailable(live):
    client, install = live
    install()
    res = client.post("/studio/copilot/plan", json=_plan(connection_id=None))
    assert res.status_code == 400 and res.json()["error"] == "provider_unavailable"


def test_unknown_connection_is_provider_unavailable(live):
    client, install = live
    install()
    res = client.post("/studio/copilot/plan", json=_plan(connection_id="ghost"))
    assert res.status_code == 400 and res.json()["error"] == "provider_unavailable"
    assert "ghost" in res.json()["detail"]


def test_plan_usage_is_recorded_under_the_studio_copilot_source(live):
    client, install = live
    install(json.dumps({"summary": "ok", "ops": []}))
    client.post("/studio/copilot/plan", json=_plan())
    summary = client.get("/usage/summary").json()
    assert [(s["source"], s["tokensTotal"]) for s in summary["bySource"]] == [("studio_copilot", 11)]


def test_mock_mode_still_never_touches_a_provider(live):
    client, install = live
    adapter = install()
    res = client.post("/studio/copilot/plan", json=_plan(mode="mock", connection_id=None))
    assert res.status_code == 200 and res.json()["source"] == "offline"
    assert adapter.calls == []


# ── /studio/assist/field ────────────────────────────────────────────────────

def test_assist_draft_returns_model_text(live):
    client, install = live
    adapter = install(json.dumps({"text": "You are the Reviewer agent.", "notes": ["Added a hand-off."]}))
    res = client.post("/studio/assist/field", json=_assist())
    assert res.status_code == 200
    assert res.json() == {"text": "You are the Reviewer agent.", "notes": ["Added a hand-off."], "source": "model", "tokens": 11}
    prompt, config = adapter.calls[0]
    assert config.system_prompt == prompts.assist_system_prompt("systemPrompt", "agent", "draft")
    assert config.temperature == 0.2 and config.extra.get("cwd") is None
    assert "review pull requests for test coverage" in prompt


def test_assist_review_returns_null_text(live):
    client, install = live
    install(json.dumps({"text": None, "notes": ["Too short."]}))
    res = client.post("/studio/assist/field", json=_assist(action="review", current="You are QA."))
    assert res.status_code == 200
    assert res.json()["text"] is None and res.json()["notes"] == ["Too short."]


def test_assist_review_that_returns_text_is_repaired(live):
    client, install = live
    adapter = install(json.dumps({"text": "rewritten", "notes": []}), json.dumps({"text": None, "notes": ["Fine."]}))
    res = client.post("/studio/assist/field", json=_assist(action="review", current="You are QA."))
    assert res.status_code == 200 and res.json()["text"] is None
    assert "Your previous reply was rejected" in adapter.calls[1][0]


@pytest.mark.parametrize("reply", [
    {"text": None, "notes": []},
    {"text": "", "notes": []},
    {"text": "x" * 4001, "notes": []},
    {"text": 7, "notes": []},
    {"text": "ok", "notes": "not a list"},
    {"text": "ok", "notes": [1, 2]},
])
def test_assist_rejects_malformed_draft_replies(live, reply):
    client, install = live
    install(json.dumps(reply), json.dumps(reply))
    res = client.post("/studio/assist/field", json=_assist())
    assert res.status_code == 422 and res.json()["error"] == "assist_invalid"


def test_checklist_text_limit_is_2000(live):
    client, install = live
    big = json.dumps({"text": "- x\n" * 600, "notes": []})
    install(big, big)
    res = client.post("/studio/assist/field", json=_assist(field="checklist", node={"type": "gate", "label": "G"}))
    assert res.status_code == 422


def test_assist_notes_are_capped_to_five_and_truncated(live):
    client, install = live
    install(json.dumps({"text": "ok", "notes": [f"n{i}" + "z" * 400 for i in range(8)]}))
    res = client.post("/studio/assist/field", json=_assist())
    notes = res.json()["notes"]
    assert len(notes) == 5 and all(len(n) <= 200 for n in notes)


def test_assist_without_a_connection_is_provider_unavailable(live):
    client, install = live
    install()
    res = client.post("/studio/assist/field", json=_assist(connection_id=None))
    assert res.status_code == 400 and res.json()["error"] == "provider_unavailable"


def test_assist_secrets_in_current_never_reach_the_provider(live):
    client, install = live
    key = "sk-" + "d" * 30
    adapter = install(json.dumps({"text": None, "notes": ["Remove the key."]}))
    client.post("/studio/assist/field", json=_assist(action="review", current=f"use {key}"))
    assert key not in adapter.calls[0][0]


def test_assist_usage_is_recorded_under_the_studio_assist_source(live):
    client, install = live
    install(json.dumps({"text": "ok", "notes": []}))
    client.post("/studio/assist/field", json=_assist())
    assert [s["source"] for s in client.get("/usage/summary").json()["bySource"]] == ["studio_assist"]


# ── request hardening (QA wave 1: L3, L4, L6) ──────────────────────────────

ENDPOINTS = [("/studio/copilot/plan", _plan), ("/studio/assist/field", _assist)]


@pytest.mark.parametrize("path, body", ENDPOINTS)
def test_a_deeply_nested_body_is_a_400_not_a_500(live, path, body):
    client, _ = live
    nested = "[" * 90_000 + "]" * 90_000
    res = client.post(path, content=nested, headers={"content-type": "application/json"})
    assert res.status_code == 400
    assert res.json()["error"] == "invalid_argument"


@pytest.mark.parametrize("path, body", ENDPOINTS)
def test_an_oversized_chunked_body_is_413_without_a_content_length(live, path, body):
    client, _ = live

    def chunks():
        for _ in range(12):
            yield b"x" * 32_768

    res = client.post(path, content=chunks(), headers={"content-type": "application/json"})
    assert res.status_code == 413
    assert res.json() == {"error": "payload_too_large"}


def test_a_nested_or_non_text_config_value_is_a_400(live):
    client, install = live
    install()
    for bad in ({"systemPrompt": {"a": {"b": 1}}}, {"roleId": 5}, {"emits": [["x"]]}):
        graph = {"nodes": [{"id": "a1", "type": "agent", "label": "A", "config": bad}], "edges": []}
        assert client.post("/studio/copilot/plan", json=_plan(graph=graph)).status_code == 400


def test_non_editable_config_never_reaches_the_provider(live):
    client, install = live
    adapter = install(json.dumps({"summary": "ok", "ops": []}))
    graph = {
        "nodes": [{"id": "a1", "type": "agent", "label": "A", "config": {
            "roleId": "writer", "apiKey": "hunter2-super-secret", "secretRef": "oharness/anthropic",  # gitleaks:allow
            "endpoint": "https://evil.test", "systemPrompt": "You draft.",
        }}],
        "edges": [],
    }
    res = client.post("/studio/copilot/plan", json=_plan(graph=graph))
    assert res.status_code == 200
    sent = adapter.calls[0][0]
    for leaked in ("hunter2", "oharness/anthropic", "evil.test", "apiKey", "secretRef", "endpoint"):
        assert leaked not in sent
    assert "You draft." in sent and "writer" in sent


def test_budget_exceeded_is_402_on_both_endpoints(live):
    client, install = live
    adapter = install()

    async def spend():
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 0.001)
            await ut.record_usage(
                db, run_id="r", node_id=None, source="direct", connection_id="conn", provider="anthropic",
                adapter="claude", model="claude-sonnet-5", tokens_total=5_000_000,
            )

    anyio.run(spend)
    assert client.post("/studio/copilot/plan", json=_plan()).status_code == 402
    assert client.post("/studio/assist/field", json=_assist()).status_code == 402
    assert adapter.calls == []
