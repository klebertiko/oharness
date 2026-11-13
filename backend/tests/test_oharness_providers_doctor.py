"""`oharness providers doctor` (R-PRV-17, #408): the same secret-free report as `GET /providers/diagnostics`, from a terminal."""
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from adapters.cli_shared import CliRunResult
from oharness.cli import main
from providers.diagnostics import build_report
from secret_store.memory import MemorySecrets

BACKEND = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((BACKEND / "oharness" / "schema" / "providers-cli.schema.json").read_text(encoding="utf-8"))
KEY = "sk-" + "canary" + "-9f3a"  # built at run time: not a key-shaped literal
USER = "canaryuser77"
EMAIL = "canary-person@example.test"
STDERR_CANARY = "CANARY-STDERR-" + "5f1c9a"
VAULT_REF = "oharness/openrouter"
MODULES = ("adapters.cli_claude", "adapters.cli_codex", "adapters.cli_cursor")


def _row(pid, provider, **extra):
    return {"id": pid, "provider": provider, "label": pid.title(), "residence": "cloud", "endpoint": "", "enabled": True,
            "secretRef": None, "defaultModel": "", **extra}


def _runner(logged_in: bool):
    async def run(argv, *, cwd, env, timeout, stdin=None):
        if argv[1] == "--version":
            return CliRunResult(returncode=0, stdout=f"2.1.4 (Claude Code) {EMAIL}\n", stderr="")
        if logged_in:
            return CliRunResult(returncode=0, stdout=json.dumps({"loggedIn": True, "email": EMAIL}), stderr="")
        return CliRunResult(returncode=0, stdout=json.dumps({"loggedIn": False, "email": EMAIL}), stderr=f"Not logged in {EMAIL} {STDERR_CANARY}")

    return run


class World:
    def __init__(self, connections, monkeypatch):
        self.connections, self._monkeypatch = connections, monkeypatch

    def signed_in(self, yes: bool) -> None:
        self.runner = _runner(yes)
        self._monkeypatch.setattr("adapters.cli_shared.run_cli", self.runner)


@pytest.fixture
def world(monkeypatch):
    for module in MODULES:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: f"/home/{USER}/bin/{name}")
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path(f"/home/{USER}")))
    store = MemorySecrets()
    store.put(VAULT_REF, KEY)
    connections = {
        "anthropic": _row("anthropic", "anthropic"),
        "openrouter": _row("openrouter", "openrouter", secretRef=VAULT_REF, endpoint=f"https://u:{KEY}@openrouter.ai/api/v1?token={KEY}#frag"),
        "ollama": _row("ollama", "ollama", residence="local", endpoint="http://localhost:11434"),
    }

    async def fake_load():
        return connections, store

    monkeypatch.setattr("oharness.providers_cli._load_runtime", fake_load)

    def no_probe(name):  # a doctor never probes: no key to a vendor, no CLI prompt
        raise AssertionError("doctor must not call a provider adapter")

    monkeypatch.setattr("routers.providers.get_adapter", no_probe)
    w = World(connections, monkeypatch)
    w.signed_in(True)
    return w


def run(capsys, *argv):
    code = main(["providers", "doctor", *argv])
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_doctor_json_is_versioned_and_schema_valid(world, capsys):
    code, out, err = run(capsys, "--json")
    doc = json.loads(out)
    assert code == 0 and not err
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    assert doc["schemaVersion"] == 1 and doc["command"] == "doctor"
    assert {c["id"]: c["state"] for c in doc["connections"]} == {"anthropic": "ready", "openrouter": "configured", "ollama": "configured"}


def test_doctor_carries_exactly_the_report_the_endpoint_serves(world, capsys):
    """One report, two doors: the CLI adds only its own envelope (schemaVersion, command)."""
    import asyncio

    _, out, _ = run(capsys, "--json")
    doc = json.loads(out)
    expected = asyncio.run(build_report(world.connections, world.runner, doc["app"]["version"]))
    assert {k: v for k, v in doc.items() if k not in ("schemaVersion", "command")} == expected


@pytest.mark.parametrize("flags", [["--json"], []])
@pytest.mark.parametrize("signed_in", [True, False])
def test_no_canary_reaches_any_output(world, capsys, flags, signed_in):
    world.signed_in(signed_in)
    _, out, err = run(capsys, *flags)
    for canary in (KEY, USER, EMAIL, STDERR_CANARY, VAULT_REF, "token=", "frag"):
        assert canary not in out + err, canary


def test_doctor_exits_non_zero_when_an_enabled_connection_needs_attention(world, capsys):
    world.signed_in(False)
    code, out, _ = run(capsys, "--json")
    states = {c["id"]: (c["state"], c["failureClass"]) for c in json.loads(out)["connections"]}
    assert code == 1 and states["anthropic"] == ("not-logged-in", "cli-signin")


def test_a_disabled_connection_that_needs_attention_does_not_fail_the_doctor(world, capsys):
    world.signed_in(False)
    world.connections["anthropic"]["enabled"] = False
    code, out, _ = run(capsys, "--json")
    assert code == 0 and json.loads(out)["connections"][0]["state"] == "not-logged-in"


def test_an_api_key_connection_without_a_key_needs_attention(world, capsys):
    world.connections["openrouter"]["secretRef"] = None
    code, out, _ = run(capsys, "--json")
    row = {c["id"]: c for c in json.loads(out)["connections"]}["openrouter"]
    assert code == 1 and row["state"] == "no-credential" and row["failureClass"] == "credential-missing"


def test_text_shows_each_connection_and_one_fixed_sentence_per_language(world, capsys, monkeypatch):
    monkeypatch.setenv("OHARNESS_LANG", "en")
    _, en, _ = run(capsys)
    assert "anthropic" in en and "ready" in en and "All connections are ready." in en
    monkeypatch.setenv("OHARNESS_LANG", "pt-BR")
    _, pt, _ = run(capsys)
    assert "Todas as conexões estão prontas." in pt
    world.signed_in(False)
    _, pt_bad, _ = run(capsys)
    assert "precisa de atenção" in pt_bad.lower() or "precisam de atenção" in pt_bad.lower()


def test_no_connections_is_a_clean_report(world, capsys):
    world.connections.clear()
    code, out, _ = run(capsys, "--json")
    assert code == 0 and json.loads(out)["connections"] == []
