"""Sign-in starts a fixed command and never keeps what the CLI prints."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app
import subprocess

from providers.login_session import default_spawner, reset_sessions, start_login
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


class _Proc:
    pid = 77


def _refuse_dynamic(*_args: object, **_kwargs: object) -> int:
    raise AssertionError("dynamic spawn")


def _record_popen(monkeypatch: pytest.MonkeyPatch) -> list[tuple[list[str], dict]]:
    calls: list[tuple[list[str], dict]] = []

    def popen(argv: list[str], **kwargs: object) -> _Proc:
        calls.append((list(argv), kwargs))
        return _Proc()

    monkeypatch.setattr("providers.login_session.subprocess.Popen", popen)
    monkeypatch.setattr("providers.login_session.os.posix_spawn", _refuse_dynamic)
    monkeypatch.setattr("providers.login_session.os.spawnv", _refuse_dynamic)
    return calls


def test_default_spawner_runs_the_literal_command_not_the_resolved_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DISPLAY", raising=False)
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    calls = _record_popen(monkeypatch)
    assert default_spawner(["/usr/local/bin/claude", "login"]) == 77
    argv, kwargs = calls[0]
    assert argv == ["claude", "login"]
    assert kwargs["stdin"] is subprocess.DEVNULL
    assert kwargs["stdout"] is subprocess.DEVNULL
    assert kwargs["stderr"] is subprocess.DEVNULL
    assert "/usr/local/bin" not in " ".join(argv)


def test_default_spawner_opens_a_terminal_with_the_same_fixed_command(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DISPLAY", ":1")
    monkeypatch.delenv("WAYLAND_DISPLAY", raising=False)
    monkeypatch.setattr("providers.login_session.os.name", "posix")
    monkeypatch.setattr(
        "providers.login_session.which",
        lambda name: "/usr/bin/xterm" if name == "xterm" else None,
    )
    calls = _record_popen(monkeypatch)
    assert default_spawner(["/opt/tools/cursor-agent.cmd", "login"]) == 77
    assert calls[0][0] == ["xterm", "-e", "cursor-agent", "login"]


def test_default_spawner_prefers_the_windows_terminal_when_it_is_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("providers.login_session.os.name", "nt")
    monkeypatch.setattr(
        "providers.login_session.which",
        lambda name: "C:\\Windows\\wt.exe" if name == "wt.exe" else None,
    )
    calls = _record_popen(monkeypatch)
    assert default_spawner(["/opt/codex.exe", "login"]) == 77
    assert calls[0][0] == ["wt.exe", "codex", "login"]
    assert calls[0][1]["start_new_session"] is False


def test_default_spawner_refuses_anything_outside_the_three_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _record_popen(monkeypatch)
    for argv in (["/tmp/sh", "-c"], ["claude", "login", "--extra"], ["xterm", "-e", "claude", "login"]):
        with pytest.raises(ValueError):
            default_spawner(argv)
    assert calls == []
