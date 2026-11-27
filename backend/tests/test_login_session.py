"""Sign-in starts a fixed command and never keeps what the CLI prints."""
from __future__ import annotations

import os
import subprocess
import time
import types
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient

from adapters.cli_shared import default_cli_cwd, inert_cwd
from main import app
from providers import login_session
from providers.login_session import cancel_login, default_spawner, reset_sessions, start_login
from secret_store.memory import MemorySecrets

CANARY = "CANARY-TOKEN-9af3"
EMAIL = "canary-person@example.test"


class LoginClient(NamedTuple):
    http: TestClient
    spawned: list[list[str]]


def _fake_os(
    monkeypatch: pytest.MonkeyPatch,
    name: str,
    environ: dict[str, str] | None = None,
    kill: Callable[[int, int], None] | None = None,
) -> None:
    """Only this module's view of ``os`` changes. The process-wide ``os.name`` stays real."""
    fake = types.SimpleNamespace(name=name, environ=dict(environ or {}), kill=kill or os.kill)
    monkeypatch.setattr(login_session, "os", fake)


@pytest.fixture()
def client() -> Iterator[LoginClient]:
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
        yield LoginClient(c, spawned)
    app.state.login_spawner = None
    app.state.login_finder = None
    reset_sessions()


def test_start_uses_the_fixed_argv_and_returns_no_path_or_secret(client: LoginClient) -> None:
    response = client.http.post("/providers/clis/claude/login", json={"command": f"echo {CANARY}", "token": CANARY})
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True and body["cli"] == "claude" and body["running"] is True
    assert client.spawned == [["/usr/local/bin/claude", "login"]]
    assert CANARY not in response.text and EMAIL not in response.text
    assert "/usr/local/bin" not in response.text
    assert app.state.secrets_store._data == {}


def test_unknown_cli_and_a_missing_binary_do_not_spawn(client: LoginClient) -> None:
    unknown = client.http.post("/providers/clis/other/login")
    assert unknown.status_code == 404
    app.state.login_finder = lambda name: None
    missing = client.http.post("/providers/clis/codex/login")
    assert missing.status_code == 409
    assert missing.json()["reason"] == "not-installed"
    assert client.spawned == []
    assert app.state.secrets_store._data == {}


@pytest.mark.parametrize("error", [ValueError("refused"), FileNotFoundError("claude.CMD")])
def test_a_launch_that_fails_is_a_closed_refusal_and_keeps_no_session(client: LoginClient, error: Exception) -> None:
    # A shim the launcher refuses, or a program that is not there.
    def refuse(argv: list[str]) -> int:
        raise error

    app.state.login_spawner = refuse
    response = client.http.post("/providers/clis/claude/login")
    assert response.status_code == 409
    assert response.json() == {"ok": False, "reason": "not-started"}
    assert "CMD" not in response.text and "/usr/local/bin" not in response.text
    assert login_session._sessions == {}


def test_cancel_stops_the_session_without_reading_output(client: LoginClient, monkeypatch: pytest.MonkeyPatch) -> None:
    killed: list[int] = []
    _fake_os(monkeypatch, os.name, kill=lambda pid, sig: killed.append(pid))
    started = client.http.post("/providers/clis/cursor/login").json()
    gone = client.http.delete(f"/providers/clis/login/{started['id']}")
    assert gone.status_code == 200
    assert gone.json()["running"] is False
    assert killed == [4242]
    missing = client.http.delete("/providers/clis/login/missing")
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
    # Windows has no posix_spawn: the guard is added where it is missing and removed afterwards.
    monkeypatch.setattr(login_session.os, "posix_spawn", _refuse_dynamic, raising=False)
    monkeypatch.setattr(login_session.os, "spawnv", _refuse_dynamic, raising=False)
    return calls


def test_default_spawner_runs_the_found_program_by_path_with_a_literal_argv(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_os(monkeypatch, "posix", environ={})
    calls = _record_popen(monkeypatch)
    assert default_spawner(["/usr/local/bin/claude", "login"]) == 77
    argv, kwargs = calls[0]
    assert argv == ["claude", "login"]
    # No PATH lookup at all: the program is the absolute path the finder returned.
    assert kwargs["executable"] == "/usr/local/bin/claude"
    assert kwargs["stdin"] is subprocess.DEVNULL
    assert kwargs["stdout"] is subprocess.DEVNULL
    assert kwargs["stderr"] is subprocess.DEVNULL


def test_a_windows_exe_runs_by_its_path_so_the_sidecar_folder_is_never_searched(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_os(monkeypatch, "nt")
    monkeypatch.setattr(login_session, "which", lambda _name: None)
    calls = _record_popen(monkeypatch)
    assert default_spawner([r"C:\Users\me\.local\bin\claude.exe", "login"]) == 77
    argv, kwargs = calls[0]
    assert argv == ["claude", "login"]
    assert kwargs["executable"] == r"C:\Users\me\.local\bin\claude.exe"


def test_default_spawner_opens_a_terminal_with_the_same_fixed_command(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_os(monkeypatch, "posix", environ={"DISPLAY": ":1"})
    monkeypatch.setattr(
        "providers.login_session.which",
        lambda name: "/usr/bin/xterm" if name == "xterm" else None,
    )
    calls = _record_popen(monkeypatch)
    assert default_spawner(["/opt/tools/cursor-agent", "login"]) == 77
    argv, kwargs = calls[0]
    assert argv == ["xterm", "-e", "/opt/tools/cursor-agent", "login"]
    assert kwargs["executable"] == "/usr/bin/xterm"


def test_default_spawner_prefers_the_windows_terminal_when_it_is_installed(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_os(monkeypatch, "nt")
    monkeypatch.setattr(
        "providers.login_session.which",
        lambda name: r"C:\Users\me\AppData\Local\Microsoft\WindowsApps\wt.exe" if name == "wt.exe" else None,
    )
    calls = _record_popen(monkeypatch)
    assert default_spawner([r"C:\Program Files\OpenAI\codex.exe", "login"]) == 77
    argv, kwargs = calls[0]
    assert argv == ["wt.exe", "-d", SYSTEM32, r"C:\Program Files\OpenAI\codex.exe", "login"]
    assert kwargs["executable"] == r"C:\Users\me\AppData\Local\Microsoft\WindowsApps\wt.exe"
    assert kwargs["start_new_session"] is False


@pytest.mark.parametrize("terminal", ["wt", r"C:\x;y\wt.exe", r"C:\tools\notwt.exe"])
def test_a_terminal_that_is_not_an_absolute_checked_path_is_not_used(monkeypatch: pytest.MonkeyPatch, terminal: str) -> None:
    _fake_os(monkeypatch, "nt")
    monkeypatch.setattr(login_session, "which", lambda name: terminal if name == "wt.exe" else None)
    calls = _record_popen(monkeypatch)
    assert default_spawner([r"C:\tools\codex.exe", "login"]) == 77
    argv, kwargs = calls[0]
    assert argv == ["codex", "login"] and kwargs["executable"] == r"C:\tools\codex.exe"


@pytest.mark.parametrize("found", ["claude", "bin/claude", r"C:\a&b\claude.exe", "/opt/a\nb/claude"])
def test_a_program_path_that_is_relative_or_has_syntax_is_refused(monkeypatch: pytest.MonkeyPatch, found: str) -> None:
    _fake_os(monkeypatch, "nt" if "\\" in found else "posix", environ={})
    monkeypatch.setattr(login_session, "which", lambda _name: None)
    calls = _record_popen(monkeypatch)
    with pytest.raises(ValueError):
        default_spawner([found, "login"])
    assert calls == []


def test_default_spawner_refuses_anything_outside_the_three_commands(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_os(monkeypatch, "nt")
    calls = _record_popen(monkeypatch)
    refused = (
        ["/tmp/sh", "-c"],
        ["claude", "login", "--extra"],
        ["xterm", "-e", "claude", "login"],
        ["C:\\tools\\evil.cmd", "login"],
        ["C:\\npm\\claude.bat", "login"],
        ["C:\\npm\\claude.ps1", "login"],
        ["C:\\npm\\claude.cmd", "logout"],
    )
    for argv in refused:
        with pytest.raises(ValueError):
            default_spawner(argv)
    assert calls == []


ENV_CANARY = "OH_LOGIN_CANARY_51b2"
SYSTEM32 = inert_cwd(windows=True)
SYSTEM_CMD = SYSTEM32 + r"\cmd.exe"


def test_spawns_run_in_a_directory_no_run_can_write_with_the_cli_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(ENV_CANARY, CANARY)
    _fake_os(monkeypatch, "posix", environ={})
    calls = _record_popen(monkeypatch)
    default_spawner(["/usr/local/bin/codex", "login"])
    kwargs = calls[0][1]
    assert kwargs["cwd"] == inert_cwd(windows=False) == "/"
    assert kwargs["cwd"] != str(default_cli_cwd())
    env = kwargs["env"]
    assert ENV_CANARY not in env and ENV_CANARY.upper() not in env
    assert env["NoDefaultCurrentDirectoryInExePath"] == "1"
    assert CANARY not in env.values()


def test_a_display_session_keeps_only_what_a_terminal_needs(monkeypatch: pytest.MonkeyPatch) -> None:
    _fake_os(monkeypatch, "posix", environ={"DISPLAY": ":1", "XAUTHORITY": "/home/u/.Xauthority", ENV_CANARY: CANARY})
    monkeypatch.setattr(login_session, "which", lambda name: "/usr/bin/xterm" if name == "xterm" else None)
    calls = _record_popen(monkeypatch)
    default_spawner(["/usr/local/bin/claude", "login"])
    env = calls[0][1]["env"]
    assert env["DISPLAY"] == ":1" and env["XAUTHORITY"] == "/home/u/.Xauthority"
    assert ENV_CANARY not in env


SHIM_LINE = "cmd.exe /d /v:off /s /c %OH_LOGIN_COMMAND%"
CREATE_NEW_CONSOLE = 0x00000010


@pytest.mark.parametrize("shim", [
    r"C:\npm\claude.CMD",
    r"C:\npm\codex.cmd",
    r"C:\Program Files (x86)\nodejs\cursor-agent.cmd",
    r"C:\Users\a@b (c)\AppData\Roaming\npm\claude.cmd",
])
def test_a_windows_npm_shim_reaches_cmd_with_exactly_two_quotes(monkeypatch: pytest.MonkeyPatch, shim: str) -> None:
    monkeypatch.setenv(ENV_CANARY, CANARY)
    _fake_os(monkeypatch, "nt")
    monkeypatch.setattr(login_session, "which", lambda _name: None)
    calls = _record_popen(monkeypatch)
    assert default_spawner([shim, "login"]) == 77
    argv, kwargs = calls[0]
    # Every argv element is a literal; this is the exact line CreateProcess receives.
    assert subprocess.list2cmdline(argv) == SHIM_LINE
    # cmd.exe expands the variable before it reads quotes, so the shim is one quoted word.
    assert kwargs["env"]["OH_LOGIN_COMMAND"] == f'"{shim}" login'
    assert kwargs["executable"] == SYSTEM_CMD
    assert kwargs["cwd"] == SYSTEM32
    assert kwargs["env"]["NoDefaultCurrentDirectoryInExePath"] == "1"
    assert ENV_CANARY not in kwargs["env"]
    assert kwargs["creationflags"] == CREATE_NEW_CONSOLE
    assert "shell" not in kwargs


def test_a_windows_npm_shim_never_goes_through_the_windows_terminal(monkeypatch: pytest.MonkeyPatch) -> None:
    # A tab may be opened by a terminal that is already running, with its own environment.
    _fake_os(monkeypatch, "nt")
    monkeypatch.setattr(
        login_session, "which",
        lambda name: r"C:\Windows\wt.exe" if name == "wt.exe" else None,
    )
    calls = _record_popen(monkeypatch)
    assert default_spawner([r"C:\npm\codex.cmd", "login"]) == 77
    argv, kwargs = calls[0]
    assert subprocess.list2cmdline(argv) == SHIM_LINE
    assert kwargs["executable"] == SYSTEM_CMD


@pytest.mark.skipif(os.name != "nt", reason="cmd.exe quoting exists only on Windows")
@pytest.mark.parametrize("folder", ["Program Files (x86)", "a@b (c)"])
def test_a_real_shim_in_a_folder_with_spaces_parentheses_or_at_runs_with_login(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, folder: str,
) -> None:
    marker = tmp_path / "ran.txt"
    npm = tmp_path / folder / "nodejs"
    npm.mkdir(parents=True)
    shim = npm / "claude.cmd"
    shim.write_text(f'@echo off\r\necho [%1][%2]> "{marker}"\r\n', encoding="ascii")
    monkeypatch.setattr(login_session, "which", lambda _name: None)
    assert default_spawner([str(shim), "login"])
    deadline = time.monotonic() + 15
    while not marker.exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    time.sleep(0.3)
    assert marker.read_text(encoding="ascii").strip() == "[login][]"


@pytest.mark.parametrize("bad", [
    r"C:\a&b\claude.cmd", r"C:\a|b\claude.cmd", r"C:\a^b\claude.cmd", r"C:\%PATH%\claude.cmd",
    r"C:\a!b!\claude.cmd", r'C:\a"b\claude.cmd', r"C:\a;b\claude.cmd", "C:\\a\nb\\claude.cmd",
    r"npm\claude.cmd", "claude.cmd", r"C:\a<b\claude.cmd", r"C:\a>b\claude.cmd",
])
def test_a_shim_path_cmd_could_reinterpret_is_refused(monkeypatch: pytest.MonkeyPatch, bad: str) -> None:
    _fake_os(monkeypatch, "nt")
    monkeypatch.setattr(login_session, "which", lambda _name: None)
    calls = _record_popen(monkeypatch)
    with pytest.raises(ValueError):
        default_spawner([bad, "login"])
    assert calls == []


@pytest.mark.skipif(os.name != "nt", reason="cmd.exe resolves names only on Windows")
def test_a_claude_cmd_planted_where_runs_write_does_not_run(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    # Runs write under %LOCALAPPDATA%\OHarness\cli-runs. A shim planted there must not start on "Sign in".
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "local"))
    # The Windows default: cmd.exe searches its current directory before PATH.
    monkeypatch.delenv("NoDefaultCurrentDirectoryInExePath", raising=False)
    runs = default_cli_cwd()
    planted_marker = tmp_path / "planted-ran.txt"
    (runs / "claude.cmd").write_text(f'@echo off\r\necho x> "{planted_marker}"\r\n', encoding="ascii")
    npm = tmp_path / "npm"
    npm.mkdir()
    real_marker = tmp_path / "real-ran.txt"
    shim = npm / "claude.cmd"
    shim.write_text(f'@echo off\r\necho %1> "{real_marker}"\r\n', encoding="ascii")
    monkeypatch.setenv("PATH", str(npm) + os.pathsep + os.environ.get("PATH", ""))
    monkeypatch.setattr(login_session, "which", lambda _name: None)
    assert default_spawner([str(shim), "login"])
    deadline = time.monotonic() + 15
    while not real_marker.exists() and time.monotonic() < deadline:
        time.sleep(0.1)
    time.sleep(0.5)
    assert not planted_marker.exists()
    assert real_marker.read_text(encoding="ascii").strip() == "login"


def test_finished_sessions_are_dropped_and_the_table_is_capped() -> None:
    reset_sessions()
    try:
        ids = [
            start_login("claude", finder=lambda name: f"/bin/{name}", spawner=lambda argv: None)["id"]
            for _ in range(login_session.MAX_SESSIONS + 5)
        ]
        assert len(login_session._sessions) == login_session.MAX_SESSIONS
        assert ids[-1] in login_session._sessions and ids[0] not in login_session._sessions
        assert cancel_login(ids[-1]) is True
        assert ids[-1] not in login_session._sessions
        assert cancel_login(ids[-1]) is False
    finally:
        reset_sessions()
