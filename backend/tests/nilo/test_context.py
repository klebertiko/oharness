"""The second turn still knows the first. History is data, redacted and bounded."""
from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from main import app
from nilo.context import (
    HISTORY_HEADER,
    build_messages,
    prompt_with_history,
    register_session_reader,
)
from providers.resolution import ResolvedProvider

SOUL = (Path(__file__).resolve().parents[3] / "SOUL.md").read_text(encoding="utf-8")
SECRET = "ghp_" + "a" * 36


class Capturing(AgentAdapter):
    def __init__(self) -> None:
        self.messages: list[dict] = []
        self.prompts: list[str] = []

    async def invoke(self, prompt, config):
        self.prompts.append(prompt)
        return AdapterResult(content="ok", tokens_used=1)

    async def stream(self, prompt, config):
        self.prompts.append(prompt)
        yield "ok"

    async def stream_events(self, prompt, config):
        self.prompts.append(prompt)
        yield {"kind": "text", "text": "ok"}
        yield {"kind": "usage", "tokens": 1}

    async def stream_turn(self, messages, config, tools=None):
        self.messages = [dict(item) for item in messages]
        self.prompts.append(messages[-1]["content"])
        text = "\n".join(item.get("content") or "" for item in messages)
        answer = "Ana" if "meu nome é Ana" in text else "ok"
        yield {"kind": "text", "text": answer}
        yield {"kind": "usage", "tokens": 1}


def _resolved(adapter: AgentAdapter, name: str = "ollama") -> ResolvedProvider:
    return ResolvedProvider(
        adapter_name=name,
        adapter=adapter,
        config=AdapterConfig(adapter=name, model="test-model", endpoint="http://127.0.0.1:9"),
        connection_id="c1",
        connection_label="C1",
    )


@pytest.fixture()
def client():
    with TestClient(app) as client:
        yield client


@pytest.fixture(autouse=True)
def _no_session_reader():
    register_session_reader(None)
    yield
    register_session_reader(None)


def _post(client: TestClient, body: dict) -> str:
    response = client.post("/execute/direct", json=body)
    assert response.status_code == 200, response.text
    return response.text


def _output(body: str) -> str:
    chunks = []
    for block in body.split("\n\n"):
        if not block.startswith("event: node_stream"):
            continue
        data = json.loads(block.split("data: ", 1)[1])
        chunks.append(data.get("chunk", ""))
    return "".join(chunks)


def _workspace(client: TestClient, tmp_path: Path) -> str:
    assert client.post("/cowork/projects", json={"name": "Demo", "rootPath": str(tmp_path)}).status_code == 201
    return str(tmp_path)


def test_the_second_turn_receives_the_first_pair(client, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cap = Capturing()
    cwd = _workspace(client, tmp_path)
    monkeypatch.setattr("routers.execution.resolve_node_provider", lambda *a, **k: _resolved(cap))
    _post(client, {"instruction": "olá", "mode": "live", "connection_id": "c1", "cwd": cwd, "tools": {"enabled": True, "thread_id": "thread-ctx-1"}})
    _post(client, {
        "instruction": "e agora?",
        "mode": "live",
        "connection_id": "c1",
        "cwd": cwd,
        "tools": {"enabled": True, "thread_id": "thread-ctx-1"},
        "context": {"thread_id": "thread-ctx-1", "turns": [
            {"role": "user", "content": "olá"},
            {"role": "assistant", "content": "Oi."},
        ]},
    })
    roles = [(item["role"], item["content"]) for item in cap.messages]
    assert roles[0][0] == "system" and roles[0][1].startswith(SOUL)
    assert ("user", "olá") in roles
    assert ("assistant", "Oi.") in roles
    assert roles[-1] == ("user", "e agora?")


def test_an_old_tool_result_is_compacted_and_the_transcript_stays_whole() -> None:
    transcript = [
        {"role": "tool", "content": "x" * 400},
        {"role": "assistant", "content": "li"},
    ]
    original = transcript[0]["content"]
    messages = build_messages("system", transcript, "agora", compact_at=1)
    assert messages[1]["content"].startswith("[compacted tool result:")
    assert transcript[0]["content"] == original
    assert messages[-1]["content"] == "agora"


def test_the_oldest_turns_leave_first_and_the_current_turn_stays() -> None:
    turns = [{"role": "user" if i % 2 == 0 else "assistant", "content": f"t{i}"} for i in range(50)]
    messages = build_messages("system", turns, "ATUAL")
    history = [item["content"] for item in messages if item["role"] != "system"]
    assert history[-1] == "ATUAL"
    assert "t0" not in history
    assert sum(1 for item in messages[1:-1] if item["role"] in {"user", "assistant"}) <= 40


def test_history_is_redacted_before_it_reaches_the_model() -> None:
    messages = build_messages("system", [{"role": "user", "content": f"guarde {SECRET}"}], "ok")
    assert SECRET not in messages[1]["content"]
    assert "redacted" in messages[1]["content"]


def test_a_session_reader_ignores_turns_sent_in_the_request(client, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cap = Capturing()
    cwd = _workspace(client, tmp_path)
    monkeypatch.setattr("routers.execution.resolve_node_provider", lambda *a, **k: _resolved(cap))
    register_session_reader(lambda thread_id: [
        {"role": "user", "content": "do store"},
        {"role": "assistant", "content": thread_id},
    ])
    _post(client, {
        "instruction": "agora",
        "mode": "live",
        "connection_id": "c1",
        "cwd": cwd,
        "tools": {"enabled": True, "thread_id": "thread-store"},
        "context": {"thread_id": "thread-store", "turns": [{"role": "user", "content": "do pedido"}]},
    })
    contents = [item["content"] for item in cap.messages]
    assert "do store" in contents
    assert "thread-store" in contents
    assert "do pedido" not in contents


def test_a_cli_connection_serializes_history_as_data(client, monkeypatch: pytest.MonkeyPatch) -> None:
    cap = Capturing()
    monkeypatch.setattr("routers.execution.resolve_node_provider", lambda *a, **k: _resolved(cap, "codex"))
    _post(client, {
        "instruction": "continua",
        "mode": "live",
        "connection_id": "c1",
        "context": {"thread_id": "thread-cli", "turns": [
            {"role": "user", "content": "primeiro"},
            {"role": "assistant", "content": "segundo"},
        ]},
    })
    prompt = cap.prompts[-1]
    assert prompt.startswith(HISTORY_HEADER)
    assert "<nilo_history>" in prompt and "</nilo_history>" in prompt
    assert "primeiro" in prompt and "segundo" in prompt
    assert prompt.rstrip().endswith("continua")
    assert cap.messages == []


def test_a_later_turn_can_use_the_name_from_the_earlier_one(client, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cap = Capturing()
    cwd = _workspace(client, tmp_path)
    monkeypatch.setattr("routers.execution.resolve_node_provider", lambda *a, **k: _resolved(cap))
    body = _post(client, {
        "instruction": "qual é meu nome?",
        "mode": "live",
        "connection_id": "c1",
        "cwd": cwd,
        "tools": {"enabled": True, "thread_id": "thread-ana"},
        "context": {"thread_id": "thread-ana", "turns": [
            {"role": "user", "content": "meu nome é Ana"},
            {"role": "assistant", "content": "Anotado."},
        ]},
    })
    assert _output(body) == "Ana"


def test_prompt_with_history_without_history_is_the_question_itself() -> None:
    messages = build_messages("system", [], "só isso")
    assert prompt_with_history(messages) == "só isso"
