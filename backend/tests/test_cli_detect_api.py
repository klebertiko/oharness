"""GET /providers/clis — which subscription CLIs are installed and signed in (R-PRV-01).

No process is spawned: the route takes its runner from ``app.state.cli_runner``. Detection
only ever asks for a version and a status — never a prompt, never a credential (I5, I7).
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from adapters.cli_shared import CliRunResult
from main import app
from secret_store.memory import MemorySecrets

CRED_VARS = ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CURSOR_API_KEY", "GITHUB_TOKEN")
CANARY = "CANARY-STDERR-5f1c9a"
MODULES = ("adapters.cli_claude", "adapters.cli_codex", "adapters.cli_cursor")

CLAUDE_OK = json.dumps({"loggedIn": True, "email": "a@b.c", "subscriptionType": "max"})
CURSOR_OK = json.dumps({"isAuthenticated": True, "userInfo": {"email": "a@b.c"}})


@pytest.fixture(autouse=True)
def _host(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in MODULES:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: f"/usr/local/bin/{name}")
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: True)
    for var in CRED_VARS:
        monkeypatch.setenv(var, f"leak-{var}")


def _runner(calls: list[dict], answers: dict[tuple[str, str], CliRunResult]):
    """Answer by (binary name, first sub-argument); anything else exits 1."""

    async def run(argv, *, cwd, env, timeout, stdin=None):
        calls.append({"argv": list(argv), "env": dict(env), "stdin": stdin, "timeout": timeout})
        name = argv[0].rsplit("/", 1)[-1]
        return answers.get((name, argv[1]), CliRunResult(returncode=1, stdout="", stderr="unexpected"))

    return run


def _ok(stdout: str = "", stderr: str = "") -> CliRunResult:
    return CliRunResult(returncode=0, stdout=stdout, stderr=stderr)


@pytest.fixture()
def client():
    app.state.secrets_store = MemorySecrets()
    app.state.provider_connections = {}
    with TestClient(app) as c:
        app.state.secrets_store = MemorySecrets()
        app.state.provider_connections = {}
        yield c
    app.state.cli_runner = None


def _by_id(body: dict) -> dict[str, dict]:
    return {c["id"]: c for c in body["clis"]}


def test_reports_installed_signed_in_and_version_per_cli(client: TestClient) -> None:
    calls: list[dict] = []
    app.state.cli_runner = _runner(calls, {
        ("claude", "--version"): _ok("2.1.4 (Claude Code)\n"),
        ("claude", "auth"): _ok(CLAUDE_OK),
        ("codex", "--version"): _ok("codex-cli 0.9.1\n"),
        ("codex", "login"): _ok(stderr="Logged in using ChatGPT\n"),
        ("cursor-agent", "--version"): _ok("2025.11.01\n"),
        ("cursor-agent", "status"): _ok(CURSOR_OK),
    })
    r = client.get("/providers/clis")
    assert r.status_code == 200
    clis = _by_id(r.json())
    assert set(clis) == {"claude", "codex", "cursor"}
    assert clis["claude"] == {
        "id": "claude", "provider": "anthropic", "installed": True, "loggedIn": True,
        "version": "2.1.4 (Claude Code)", "state": "ready", "detail": "Logged in as a@b.c (max plan).",
    }
    assert clis["codex"]["provider"] == "openai" and clis["codex"]["state"] == "ready"
    assert clis["codex"]["version"] == "codex-cli 0.9.1"
    assert clis["cursor"]["provider"] == "cursor" and clis["cursor"]["loggedIn"] is True
    # I5/I7: two commands per CLI (version, status), no prompt, no credential in any env.
    assert len(calls) == 6
    assert all(c["stdin"] is None for c in calls)
    assert not any(var in c["env"] for c in calls for var in CRED_VARS)
    assert {c["argv"][1] for c in calls} <= {"--version", "auth", "login", "status"}


def test_not_installed_never_spawns(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    for module in MODULES:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: None)
    calls: list[dict] = []
    app.state.cli_runner = _runner(calls, {})
    clis = _by_id(client.get("/providers/clis").json())
    assert calls == []
    for cli in clis.values():
        assert cli["installed"] is False and cli["loggedIn"] is False
        assert cli["state"] == "not-installed" and cli["version"] == ""


def test_installed_but_logged_out(client: TestClient) -> None:
    app.state.cli_runner = _runner([], {
        ("claude", "--version"): _ok("2.1.4\n"),
        ("claude", "auth"): _ok(json.dumps({"loggedIn": False})),
        ("codex", "--version"): _ok("codex-cli 0.9.1\n"),
        ("codex", "login"): _ok(stderr="Not logged in\n"),
        ("cursor-agent", "--version"): _ok("1\n"),
        ("cursor-agent", "status"): _ok(json.dumps({"isAuthenticated": False})),
    })
    clis = _by_id(client.get("/providers/clis").json())
    for cli in clis.values():
        assert cli["installed"] is True and cli["loggedIn"] is False
        assert cli["state"] == "not-logged-in"
    assert clis["claude"]["version"] == "2.1.4"


def test_failed_status_is_an_error_without_leaking_stderr(client: TestClient) -> None:
    app.state.cli_runner = _runner([], {
        ("claude", "--version"): _ok("2.1.4\n"),
        ("claude", "auth"): CliRunResult(returncode=2, stdout="", stderr=f"boom {CANARY}"),
        ("codex", "--version"): _ok("x\n"),
        ("codex", "login"): CliRunResult(returncode=-1, stdout="", stderr="timed out after 15s", timed_out=True),
        ("cursor-agent", "--version"): _ok("x\n"),
        ("cursor-agent", "status"): _ok("not json"),
    })
    r = client.get("/providers/clis")
    clis = _by_id(r.json())
    for cli in clis.values():
        assert cli["installed"] is True and cli["loggedIn"] is False and cli["state"] == "error"
    assert CANARY not in r.text


def test_platform_gate_is_unavailable_not_error(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: False)  # Codex only runs on Windows
    app.state.cli_runner = _runner([], {("codex", "--version"): _ok("x\n")})
    codex = _by_id(client.get("/providers/clis").json())["codex"]
    assert codex["installed"] is True and codex["state"] == "unavailable"


def test_version_is_one_short_line(client: TestClient) -> None:
    app.state.cli_runner = _runner([], {
        ("claude", "--version"): _ok("\n" + "v" * 300 + "\nsecond line\n"),
        ("claude", "auth"): _ok(CLAUDE_OK),
    })
    claude = _by_id(client.get("/providers/clis").json())["claude"]
    assert 0 < len(claude["version"]) <= 80 and "second" not in claude["version"]
