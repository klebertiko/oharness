"""complete_json — the one live-call helper behind Copilot and field assist (plan S6, spec §5.2)."""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import anyio
import pytest
from sqlalchemy import delete, select

import usage_tracking as ut
from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from database import SessionLocal, init_db
from models import BudgetConfig, UsageRecord
from secret_store.memory import MemorySecrets
from studio_copilot import extract, llm


class Scripted(AgentAdapter):
    def __init__(self, replies, *, tokens=10, delay=0.0, raises=None):
        self.replies = list(replies)
        self.tokens = tokens
        self.delay = delay
        self.raises = raises
        self.calls: list[tuple[str, AdapterConfig]] = []

    async def invoke(self, prompt, config):
        self.calls.append((prompt, config))
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.raises:
            raise self.raises
        reply = self.replies.pop(0)
        if isinstance(reply, AdapterResult):
            return reply
        return AdapterResult(content=reply, tokens_used=self.tokens)

    async def stream(self, prompt, config):  # pragma: no cover - never used by complete_json
        yield ""


def _connections(model="claude-sonnet-5"):
    return {
        "conn": {
            "id": "conn",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "oharness/anthropic",  # gitleaks:allow
            "defaultModel": model,
        }
    }


def _request(connections=None):
    store = MemorySecrets()
    store.put("oharness/anthropic", "sk-ant-REAL")
    state = SimpleNamespace(provider_connections=connections if connections is not None else _connections(), secrets_store=store)
    return SimpleNamespace(app=SimpleNamespace(state=state))


def _accept(obj):
    return (obj, None) if "ok" in obj else (None, "field_invalid: missing ok")


async def _reset():
    async with SessionLocal() as db:
        await db.execute(delete(UsageRecord))
        await db.execute(delete(BudgetConfig))
        await db.commit()


@pytest.fixture(autouse=True)
def clean_db():
    anyio.run(init_db)
    anyio.run(_reset)
    yield
    anyio.run(_reset)


@pytest.fixture()
def adapter(monkeypatch):
    holder = {}

    def install(a):
        holder["a"] = a
        monkeypatch.setattr("providers.resolution.get_adapter", lambda name: a)
        return a

    return install


def _run(**over):
    async def go():
        async with SessionLocal() as db:
            kwargs = dict(
                connection_id="conn", system="SYS", user="USER", validate=_accept,
                source="studio_copilot", timeout_s=5, invalid_code="plan_invalid",
            )
            kwargs.update(over)
            req = kwargs.pop("request", None) or _request()
            return await llm.complete_json(req, db, **kwargs)

    return anyio.run(go)


def _fails(**over):
    with pytest.raises(llm.StudioLlmError) as info:
        _run(**over)
    return info.value


async def _usage_rows():
    async with SessionLocal() as db:
        return list((await db.execute(select(UsageRecord))).scalars())


# ── extract_json ────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "text, expected",
    [
        ('{"a": 1}', {"a": 1}),
        ('Sure!\n```json\n{"a": 1}\n```\nDone.', {"a": 1}),
        ('```\n{"a": 2}\n```', {"a": 2}),
        ('Here you go: {"a": {"b": [1, 2]}} thanks', {"a": {"b": [1, 2]}}),
        ('{"s": "a } brace and { another"}', {"s": "a } brace and { another"}),
        ('prefix {not json} then {"ok": true}', {"ok": True}),
        ('```json\n[1, 2]\n```\n{"x": 1}', {"x": 1}),
        ('```json\n{broken\n```\n{"x": 1}', {"x": 1}),
    ],
)
def test_extract_json_finds_the_first_object(text, expected):
    assert extract.extract_json(text) == expected


@pytest.mark.parametrize("text", ["", "no json here", "[1, 2, 3]", "{unterminated", '{"a": 1', '"just a string"'])
def test_extract_json_returns_none_without_an_object(text):
    assert extract.extract_json(text) is None


def test_extract_json_is_linear_enough_on_hostile_input():
    assert extract.extract_json("{" * 50000) is None
    assert extract.extract_json('{"a":' * 5000) is None


# ── complete_json ───────────────────────────────────────────────────────────

def test_valid_reply_on_the_first_try_invokes_once(adapter):
    a = adapter(Scripted(['{"ok": 1}']))
    value, tokens = _run()
    assert value == {"ok": 1}
    assert tokens == 10
    assert len(a.calls) == 1
    assert a.calls[0][0] == "USER"


def test_invalid_then_valid_repairs_once(adapter):
    a = adapter(Scripted(['{"nope": 1}', '{"ok": 2}']))
    value, tokens = _run()
    assert value == {"ok": 2}
    assert tokens == 20
    assert len(a.calls) == 2
    assert a.calls[1][0].startswith("USER")
    assert "Your previous reply was rejected" in a.calls[1][0]
    assert "field_invalid: missing ok" in a.calls[1][0]
    assert a.calls[1][1].system_prompt == "SYS"


def test_non_json_reply_is_repaired_too(adapter):
    a = adapter(Scripted(["I think so!", '{"ok": 1}']))
    assert _run()[0] == {"ok": 1}
    assert "not a JSON object" in a.calls[1][0]


def test_invalid_twice_is_a_422_and_the_spend_is_still_recorded(adapter):
    a = adapter(Scripted(['{"no": 1}', '{"no": 2}']))
    err = _fails(source="studio_assist", invalid_code="assist_invalid")
    assert err.status_code == 422
    assert err.body["error"] == "assist_invalid"
    assert len(a.calls) == 2
    rows = anyio.run(_usage_rows)
    assert [(r.source, r.tokens_total) for r in rows] == [("studio_assist", 20)]


def test_adapter_error_is_a_502_with_a_redacted_detail(adapter):
    adapter(Scripted([AdapterResult(content="", error="upstream said key sk-" + "a" * 30 + " is bad")]))
    err = _fails()
    assert err.status_code == 502
    assert err.body["error"] == "provider_error"
    assert "sk-" + "a" * 30 not in err.body["detail"]


def test_adapter_exception_is_a_502_that_does_not_leak_its_message(adapter):
    adapter(Scripted([], raises=RuntimeError("boom sk-" + "b" * 30)))
    err = _fails()
    assert err.status_code == 502
    assert "sk-" + "b" * 30 not in str(err.body)


def test_a_slow_provider_is_a_504(adapter):
    adapter(Scripted(['{"ok": 1}'], delay=2))
    err = _fails(timeout_s=0.05)
    assert err.status_code == 504
    assert err.body["error"] == "provider_timeout"


def test_unknown_connection_is_provider_unavailable(adapter):
    adapter(Scripted([]))
    err = _fails(connection_id="ghost")
    assert (err.status_code, err.body["error"]) == (400, "provider_unavailable")
    assert "ghost" in err.body["detail"]


def test_missing_connection_id_is_provider_unavailable(adapter):
    adapter(Scripted([]))
    err = _fails(connection_id=None)
    assert (err.status_code, err.body["error"]) == (400, "provider_unavailable")


def test_budget_exceeded_is_a_402_and_never_calls_the_model(adapter):
    a = adapter(Scripted(['{"ok": 1}']))

    async def spend():
        async with SessionLocal() as db:
            await ut.set_budget_limit(db, 0.001)
            await ut.record_usage(
                db, run_id="r", node_id=None, source="direct", connection_id="conn", provider="anthropic",
                adapter="claude", model="claude-sonnet-5", tokens_total=5_000_000,
            )

    anyio.run(spend)
    err = _fails()
    assert err.status_code == 402
    assert err.body["error"] == "budget_exceeded"
    assert a.calls == []


def test_usage_is_recorded_with_the_studio_source_and_summed_tokens(adapter):
    adapter(Scripted(['{"nope": 1}', '{"ok": 1}'], tokens=7))
    _run(source="studio_copilot")
    rows = anyio.run(_usage_rows)
    assert len(rows) == 1
    row = rows[0]
    assert (row.source, row.tokens_total, row.connection_id, row.provider, row.adapter, row.model) == (
        "studio_copilot", 14, "conn", "anthropic", "claude", "claude-sonnet-5",
    )


def test_missing_token_counts_fall_back_to_an_estimate(adapter):
    adapter(Scripted(['{"ok": 1}'], tokens=0))
    _, tokens = _run()
    assert tokens >= 1


def test_the_provider_gets_a_cool_capped_cwd_free_config(adapter):
    a = adapter(Scripted(['{"ok": 1}']))
    _run(system="THE SYSTEM PROMPT")
    config = a.calls[0][1]
    assert config.system_prompt == "THE SYSTEM PROMPT"
    assert config.temperature == 0.2
    assert config.max_tokens <= 4096
    assert config.extra.get("cwd") is None
    assert config.extra.get("cwd_root") is None


def test_a_pinned_cwd_on_the_resolved_config_is_stripped(adapter, monkeypatch):
    a = adapter(Scripted(['{"ok": 1}']))
    real = llm.resolve_node_provider

    def with_cwd(*args, **kwargs):
        resolved = real(*args, **kwargs)
        import dataclasses

        config = dataclasses.replace(resolved.config, extra={**resolved.config.extra, "cwd": "C:/work", "cwd_root": "C:/work"})
        return dataclasses.replace(resolved, config=config)

    monkeypatch.setattr(llm, "resolve_node_provider", with_cwd)
    _run()
    assert a.calls[0][1].extra.get("cwd") is None and a.calls[0][1].extra.get("cwd_root") is None


def test_resolution_is_called_without_a_workspace(adapter, monkeypatch):
    adapter(Scripted(['{"ok": 1}']))
    seen = {}
    real = llm.resolve_node_provider

    def spy(*args, **kwargs):
        seen.update(kwargs)
        return real(*args, **kwargs)

    monkeypatch.setattr(llm, "resolve_node_provider", spy)
    _run()
    assert seen["cwd"] is None
