"""Sign-in starts a fixed command and never keeps what the CLI prints."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app
from providers.login_session import reset_sessions, start_login
from secret_store.memory import MemorySecrets

CANARY = "CANARY-TOKEN-9af3"
EMAIL = "canary-person@example.test"


@pytest.fixture()
def client():
    reset_sessions()
    app.state.secrets_store = MemorySecrets()
    spawned: list[list[str]] = []

    def spawner(argv: list[str]) -> int:
        spawned.append(list(argv))
        return 4242

    app.state.login_spawner = spawner
    app.state.login_finder = lambda name: f"/usr/local/bin/{name}"
    with TestClient(app) as c:
        app.state.secrets_store = MemorySecrets()
        app.state.login_spawner = spawner
        app.state.login_finder = lambda name: f"/usr/local/bin/{name}"
        c.spawned = spawned  # type: ignore[attr-defined]
        yield c
    app.state.login_spawner = None
    app.state.login_finder = None
    reset_sessions()


def test_start_uses_the_fixed_argv_and_returns_no_path_or_secret(client: TestClient) -> None:
    response = client.post("/providers/clis/claude/login", json={"command": f"echo {CANARY}", "token": CANARY})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True and body["cli"] == "claude" and body["running"] is True
    assert client.spawned == [["/usr/local/bin/claude", "login"]]  # type: ignore[attr-defined]
    assert CANARY not in response.text and EMAIL not in response.text
    assert "/usr/local/bin" not in response.text
    assert app.state.secrets_store._data == {}


def test_unknown_cli_and_a_missing_binary_do_not_spawn(client: TestClient) -> None:
    unknown = client.post("/providers/clis/other/login")
    assert unknown.status_code == 404
    app.state.login_finder = lambda name: None
    missing = client.post("/providers/clis/codex/login")
    assert missing.status_code == 409
    assert missing.json()["reason"] == "not-installed"
    assert client.spawned == []  # type: ignore[attr-defined]
    assert app.state.secrets_store._data == {}


def test_cancel_stops_the_session_without_reading_output(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    killed: list[int] = []
    monkeypatch.setattr("providers.login_session.os.kill", lambda pid, sig: killed.append(pid))
    started = client.post("/providers/clis/cursor/login").json()
    gone = client.delete(f"/providers/clis/login/{started['id']}")
    assert gone.status_code == 200
    assert gone.json()["running"] is False
    assert killed == [4242]
    missing = client.delete("/providers/clis/login/missing")
    assert missing.status_code == 404
    assert app.state.secrets_store._data == {}


def test_start_login_rejects_a_command_that_is_not_one_of_the_three() -> None:
    with pytest.raises(KeyError):
        start_login("sh")
