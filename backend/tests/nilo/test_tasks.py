"""A task keeps running while the chat answers. Cancel, milestones, restart and the final note."""
from __future__ import annotations

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from main import app
from nilo.tasks import accept_milestone, compose_delivery, forja_argv, simulate_restart
from nilo.voice import lint_voice

STARTED = datetime(2026, 1, 1, 12, 0, 0)


class Quiet(AgentAdapter):
    async def invoke(self, prompt, config):
        return AdapterResult(content="ok", tokens_used=1)

    async def stream(self, prompt, config):
        yield "ok"

    async def stream_events(self, prompt, config):
        yield {"kind": "text", "text": "ainda aqui"}
        yield {"kind": "usage", "tokens": 1}


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setattr("routers.execution.get_adapter", lambda name: Quiet())
    with TestClient(app) as client:
        yield client


def test_a_running_task_does_not_block_the_chat(client: TestClient) -> None:
    started = client.post("/nilo/tasks", json={"thread_id": "thread-task", "title": "Revisar", "instruction": "olhe o relatório", "kind": "harness"})
    assert started.status_code == 201
    assert started.json()["state"] == "running"
    chat = client.post("/execute/direct", json={"instruction": "olá", "mode": "mock"})
    assert chat.status_code == 200
    assert "ainda aqui" in chat.text
    listed = client.get("/nilo/tasks", params={"state": "running"}).json()
    assert any(item["id"] == started.json()["id"] for item in listed)


def test_cancel_stops_one_task_and_leaves_the_chat_and_the_other(client: TestClient) -> None:
    first = client.post("/nilo/tasks", json={"thread_id": "thread-a", "title": "Um", "instruction": "faça um", "kind": "subagents"}).json()
    second = client.post("/nilo/tasks", json={"thread_id": "thread-b", "title": "Dois", "instruction": "faça dois", "kind": "harness"}).json()
    assert client.post(f"/nilo/tasks/{first['id']}/cancel").json()["state"] == "cancelled"
    running = client.get("/nilo/tasks", params={"state": "running"}).json()
    assert any(item["id"] == second["id"] for item in running)
    assert all(item["id"] != first["id"] for item in running)
    assert client.post("/execute/direct", json={"instruction": "olá", "mode": "mock"}).status_code == 200


def test_milestones_wait_for_a_new_stage_and_for_thirty_seconds() -> None:
    assert accept_milestone("", None, "ler", STARTED) is True
    assert accept_milestone("ler", STARTED, "ler", STARTED + timedelta(seconds=45)) is False
    assert accept_milestone("ler", STARTED, "escrever", STARTED + timedelta(seconds=10)) is False
    assert accept_milestone("ler", STARTED, "escrever", STARTED + timedelta(seconds=30)) is True


def test_a_restart_interrupts_a_running_task_and_continue_resumes_it(client: TestClient) -> None:
    started = client.post("/nilo/tasks", json={"thread_id": "thread-r", "title": "Continuar", "instruction": "siga", "kind": "harness"}).json()
    simulate_restart()
    listed = client.get("/nilo/tasks").json()
    found = next(item for item in listed if item["id"] == started["id"])
    assert found["state"] == "interrupted"
    resumed = client.post(f"/nilo/tasks/{started['id']}/continue")
    assert resumed.status_code == 200
    assert resumed.json()["state"] == "running"


def test_notifications_stay_off_and_a_focused_window_stays_quiet(client: TestClient) -> None:
    assert client.get("/nilo/tasks/notifications").json() == {"enabled": False}
    assert client.post("/nilo/tasks/notifications/decide", json={"focused": False, "kind": "done"}).json() == {"notify": False}
    assert client.put("/nilo/tasks/notifications", json={"enabled": True}).json() == {"enabled": True}
    assert client.post("/nilo/tasks/notifications/decide", json={"focused": True, "kind": "failed"}).json() == {"notify": False}
    assert client.post("/nilo/tasks/notifications/decide", json={"focused": False, "kind": "needs_you"}).json() == {"notify": True}
    client.put("/nilo/tasks/notifications", json={"enabled": False})


def test_the_final_note_passes_the_voice_lint() -> None:
    note = compose_delivery("Ótima pergunta! Pronto.", [{"kind": "report", "ref": "relatório"}])
    assert "!" not in note
    assert lint_voice(note) == []
    assert "Ótima pergunta" not in note


def test_a_forja_task_cannot_approve_or_merge(client: TestClient) -> None:
    argv = forja_argv("enviar o item")
    assert argv[:3] == ["oharness", "forja", "submit"]
    assert "approve" not in argv and "merge" not in argv
    started = client.post("/nilo/tasks", json={"thread_id": "thread-f", "title": "Enviar", "instruction": "enviar o item", "kind": "forja"})
    assert started.status_code == 201
    paths = [path for path in app.openapi()["paths"] if path.startswith("/nilo/tasks")]
    assert paths
    assert not any("approve" in path or "merge" in path for path in paths)
