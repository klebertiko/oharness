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

EMAIL = "canary-person@example.test"
CLAUDE_OK = json.dumps({"loggedIn": True, "email": EMAIL, "subscriptionType": "max"})
CURSOR_OK = json.dumps({"isAuthenticated": True, "userInfo": {"email": EMAIL}})


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
    assert EMAIL not in r.text and CANARY not in r.text  # no account e-mail, no raw CLI output
    clis = _by_id(r.json())
    assert set(clis) == {"claude", "codex", "cursor"}
    assert clis["claude"] == {
        "id": "claude", "provider": "anthropic", "installed": True, "loggedIn": True,
        "version": "2.1.4 (Claude Code)", "state": "ready", "detail": "Signed in.",
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


@pytest.mark.parametrize(
    "version_stdout",
    [
        "\n" + "v" * 300 + "\nsecond line\n",          # one long line
        f"warn: Logged in as {EMAIL}\n",                 # an account e-mail
        "2.1.4 \u202e(Claude Code)\n",                    # bidi override
        "\x1b[31m2.1.4\x1b[0m\n",                       # terminal escape
        f"2.1.4 {CANARY}!\n",                            # free text outside the version alphabet
    ],
)
def test_version_that_is_not_a_version_never_appears(client: TestClient, version_stdout: str) -> None:
    app.state.cli_runner = _runner([], {
        ("claude", "--version"): _ok(version_stdout),
        ("claude", "auth"): _ok(CLAUDE_OK),
    })
    r = client.get("/providers/clis")
    claude = _by_id(r.json())["claude"]
    assert claude["version"] == "" and claude["state"] == "ready"
    for needle in (EMAIL, "\u202e", "\x1b", CANARY, "v" * 81):
        assert needle not in r.text and needle not in json.dumps(r.json(), ensure_ascii=False)


def test_version_is_never_read_from_stderr(client: TestClient) -> None:
    app.state.cli_runner = _runner([], {
        ("claude", "--version"): _ok(stdout="", stderr="2.1.4 (Claude Code)\n"),
        ("claude", "auth"): _ok(CLAUDE_OK),
    })
    assert _by_id(client.get("/providers/clis").json())["claude"]["version"] == ""


def test_the_cap_counts_bytes_not_characters(client: TestClient) -> None:
    # 40,000 two-byte characters: under 64 K characters, over 64 KiB.
    wide = json.dumps({"loggedIn": True, "pad": "\u00e9" * 40_000}, ensure_ascii=False)
    app.state.cli_runner = _runner([], {("claude", "--version"): _ok("2.1.4\n"), ("claude", "auth"): _ok(wide)})
    assert _by_id(client.get("/providers/clis").json())["claude"]["state"] == "error"


def test_gate_closed_with_the_binary_present_runs_nothing(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: False)  # Codex only runs on Windows (SEC-6)
    calls: list[dict] = []
    app.state.cli_runner = _runner(calls, {})
    codex = _by_id(client.get("/providers/clis").json())["codex"]
    assert codex["installed"] is True and codex["state"] == "unavailable" and codex["version"] == ""
    assert not any(c["argv"][0].endswith("codex") for c in calls)  # not even --version


def test_gate_closed_with_the_binary_absent_is_not_installed(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.find_cli", lambda name: None)
    calls: list[dict] = []
    app.state.cli_runner = _runner(calls, {})
    codex = _by_id(client.get("/providers/clis").json())["codex"]
    assert codex["installed"] is False and codex["state"] == "unavailable"
    assert not any(c["argv"][0].endswith("codex") for c in calls)


def test_native_windows_cursor_without_wsl_is_unavailable_and_not_installed(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: True)
    monkeypatch.setattr("adapters.cli_cursor._windows_wsl_prefix", lambda: None)
    calls: list[dict] = []
    app.state.cli_runner = _runner(calls, {})
    cursor = _by_id(client.get("/providers/clis").json())["cursor"]
    assert cursor["installed"] is False and cursor["state"] == "unavailable"
    assert not any("cursor-agent" in c["argv"][0] for c in calls)


def test_version_timeout_keeps_the_state(client: TestClient) -> None:
    app.state.cli_runner = _runner([], {
        ("claude", "--version"): CliRunResult(returncode=-1, stdout="", stderr="timed out", timed_out=True),
        ("claude", "auth"): _ok(CLAUDE_OK),
    })
    claude = _by_id(client.get("/providers/clis").json())["claude"]
    assert claude["state"] == "ready" and claude["version"] == ""


def test_cli_output_is_read_up_to_64_kib(client: TestClient) -> None:
    huge = json.dumps({"loggedIn": True, "pad": "x" * 100_000})
    app.state.cli_runner = _runner([], {
        ("claude", "--version"): _ok("2.1.4\n" + "y" * 200_000),
        ("claude", "auth"): _ok(huge),
    })
    claude = _by_id(client.get("/providers/clis").json())["claude"]
    assert claude["version"] == "2.1.4"
    assert claude["state"] == "error"  # the status was cut at 64 KiB, so it no longer parses


def test_route_needs_the_sidecar_token() -> None:
    import httpx
    from starlette.testclient import TestClient as Raw

    raw = Raw(app)
    raw.request = httpx.Client.request.__get__(raw, Raw)  # bypass conftest's auto-auth
    assert raw.get("/providers/clis").status_code == 401
    assert raw.get("/providers/clis", headers={"Authorization": "Bearer nope"}).status_code == 401
