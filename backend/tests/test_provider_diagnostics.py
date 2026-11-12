"""GET /providers/diagnostics — a doctor-style report per connection (R-PRV-07).

Carries no secret: no key from the vault, no account e-mail the CLI probe printed,
no local user name in a CLI path, no userinfo/query in an endpoint.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from adapters.cli_shared import CliRunResult
from main import app
from secret_store.memory import MemorySecrets

KEY = "sk-" + "canary" + "-9f3a"  # built at run time: not a key-shaped literal
USER = "canaryuser77"
EMAIL = "canary-person@example.test"
MODULES = ("adapters.cli_claude", "adapters.cli_codex", "adapters.cli_cursor")
CLAUDE_OK = json.dumps({"loggedIn": True, "email": EMAIL})


@pytest.fixture(autouse=True)
def _host(monkeypatch: pytest.MonkeyPatch) -> None:
    for module in MODULES:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: f"/home/{USER}/bin/{name}")
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path(f"/home/{USER}")))


@pytest.fixture()
def client():
    with TestClient(app) as c:
        store = MemorySecrets()
        store.put("oharness/openrouter", KEY)
        app.state.secrets_store = store
        app.state.provider_connections = {
            "openrouter": {"id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "residence": "cloud",
                           "enabled": True, "secretRef": "oharness/openrouter", "defaultModel": "m",
                           "endpoint": f"https://u:{KEY}@openrouter.ai/api/v1?token={KEY}#frag"},
            "anthropic": {"id": "anthropic", "provider": "anthropic", "label": "Claude", "residence": "cloud",
                          "enabled": True, "secretRef": None, "defaultModel": "", "endpoint": ""},
            "ollama": {"id": "ollama", "provider": "ollama", "label": "Ollama", "residence": "local",
                       "enabled": True, "secretRef": None, "defaultModel": "", "endpoint": "http://localhost:11434"},
        }
        yield c
    app.state.cli_runner = None


def _runner(logged_in: bool):
    async def run(argv, *, cwd, env, timeout, stdin=None):
        if argv[1] == "--version":
            return CliRunResult(returncode=0, stdout=f"2.1.4 (Claude Code) {EMAIL}\n" if False else "2.1.4\n", stderr="")
        if logged_in:
            return CliRunResult(returncode=0, stdout=CLAUDE_OK, stderr="")
        return CliRunResult(returncode=0, stdout=json.dumps({"loggedIn": False, "email": EMAIL}), stderr=f"Not logged in {EMAIL}")

    return run


def test_report_shape_and_no_canary_anywhere(client: TestClient) -> None:
    app.state.cli_runner = _runner(True)
    r = client.get("/providers/diagnostics")
    assert r.status_code == 200
    for canary in (KEY, USER, EMAIL):
        assert canary not in r.text, canary
    body = r.json()
    assert set(body["app"]) == {"version", "os"} and body["app"]["version"]
    rows = {c["id"]: c for c in body["connections"]}
    assert rows["openrouter"]["credentialKind"] == "api-key"
    assert rows["openrouter"]["credentialOrigin"] == "vault"
    assert rows["openrouter"]["endpoint"] == "https://openrouter.ai/api/v1"
    assert rows["openrouter"]["state"] == "configured" and rows["openrouter"]["failureClass"] is None
    assert rows["openrouter"]["cli"] is None
    cli = rows["anthropic"]
    assert cli["credentialKind"] == "cli" and cli["credentialOrigin"] == "cli"
    assert cli["state"] == "ready" and cli["failureClass"] is None
    assert cli["cli"]["version"] == "2.1.4"
    assert cli["cli"]["path"].startswith("~/") and USER not in cli["cli"]["path"]
    assert rows["ollama"]["credentialKind"] == "none" and rows["ollama"]["credentialOrigin"] == "none"


def test_signed_out_cli_gets_a_failure_class_without_the_probe_text(client: TestClient) -> None:
    app.state.cli_runner = _runner(False)
    r = client.get("/providers/diagnostics")
    assert EMAIL not in r.text
    row = {c["id"]: c for c in r.json()["connections"]}["anthropic"]
    assert row["state"] == "not-logged-in" and row["failureClass"] == "cli-signin"


def test_api_key_connection_without_a_credential_is_flagged(client: TestClient) -> None:
    app.state.cli_runner = _runner(True)
    app.state.provider_connections["openrouter"]["secretRef"] = None
    r = client.get("/providers/diagnostics")
    row = {c["id"]: c for c in r.json()["connections"]}["openrouter"]
    assert row["state"] == "no-credential" and row["failureClass"] == "credential-missing"
    assert row["credentialOrigin"] == "none"


def test_mask_home_handles_windows_paths(monkeypatch: pytest.MonkeyPatch) -> None:
    from providers.diagnostics import mask_home

    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path("C:/Users/" + USER)))
    assert mask_home(rf"C:\Users\{USER}\AppData\claude.exe") == "~/AppData/claude.exe"
    assert mask_home("/usr/local/bin/claude") == "/usr/local/bin/claude"
