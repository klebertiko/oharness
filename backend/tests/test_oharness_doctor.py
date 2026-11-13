"""`oharness doctor` (R-DX-01, #411): one report of version, data directory, database, secrets store, sidecar, sandbox and connections. Never a secret."""
import json
import os
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from adapters.cli_shared import CliRunResult
from oharness.cli import main
from providers.diagnostics import build_report
from secret_store.memory import MemorySecrets

BACKEND = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((BACKEND / "oharness" / "schema" / "doctor.schema.json").read_text(encoding="utf-8"))
KEY = "sk-" + "canary" + "-9f3a"  # built at run time: not a key-shaped literal
USER = "canaryuser77"
EMAIL = "canary-person@example.test"
STDERR_CANARY = "CANARY-STDERR-" + "5f1c9a"
DB_CANARY = "dbfail-" + "7c1e44"
VAULT_REF = "oharness/openrouter"
MODULES = ("adapters.cli_claude", "adapters.cli_codex", "adapters.cli_cursor")
CHECK_IDS = ["dataDir", "database", "secretsStore", "sidecar", "sandbox", "connections"]


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
    def signed_in(self, yes: bool) -> None:
        self.runner = _runner(yes)
        self.monkeypatch.setattr("adapters.cli_shared.run_cli", self.runner)


def _no_adapter(name):
    raise AssertionError("doctor never calls an adapter")


@pytest.fixture
def world(monkeypatch, tmp_path):
    home = tmp_path / USER
    data = home / "data"
    data.mkdir(parents=True)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setenv("OH_DATA_DIR", str(data))
    for module in MODULES:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: f"/home/{USER}/bin/{name}")
    monkeypatch.setattr("adapters.cli_cursor.is_windows", lambda: False)
    monkeypatch.setattr("adapters.cli_codex.is_windows", lambda: True)
    store = MemorySecrets()
    store.put(VAULT_REF, KEY)
    connections = {
        "anthropic": _row("anthropic", "anthropic"),
        "openrouter": _row("openrouter", "openrouter", secretRef=VAULT_REF, endpoint=f"https://u:{KEY}@openrouter.ai/api/v1?token={KEY}#frag"),
    }

    async def fake_load():
        return connections, store

    monkeypatch.setattr("oharness.providers_cli._load_runtime", fake_load)
    monkeypatch.setattr("routers.providers.get_adapter", _no_adapter)
    w = World()
    w.monkeypatch, w.connections, w.home, w.data = monkeypatch, connections, home, data
    w.signed_in(True)
    return w


def run(capsys, *argv):
    code = main(["doctor", *argv])
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def doc_of(capsys, *argv):
    _, out, _ = run(capsys, "--json", *argv)
    return json.loads(out)


def checks(doc):
    return {c["id"]: c for c in doc["checks"]}


def test_doctor_json_is_versioned_schema_valid_and_all_ok(world, capsys):
    code, out, err = run(capsys, "--json")
    doc = json.loads(out)
    assert code == 0 and not err and doc["ok"] is True
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    assert doc["schemaVersion"] == 1 and doc["command"] == "doctor"
    assert [c["id"] for c in doc["checks"]] == CHECK_IDS and {c["status"] for c in doc["checks"]} == {"ok"}
    assert doc["version"] and doc["os"] and doc["dataDir"] == "~/data"
    assert set(doc["sandbox"]) == {"defaultMode", "modes", "gitFound"} and doc["sandbox"]["defaultMode"] in doc["sandbox"]["modes"]


def test_the_connections_are_the_report_the_providers_doctor_builds(world, capsys):
    """Reuse, not a second implementation: the same `build_report` rows, nothing added to them."""
    import asyncio

    doc = doc_of(capsys)
    expected = asyncio.run(build_report(world.connections, world.runner, doc["version"]))
    assert doc["connections"] == expected["connections"]


@pytest.mark.parametrize("flags", [["--json"], []])
@pytest.mark.parametrize("signed_in", [True, False])
def test_no_canary_reaches_any_output(world, capsys, flags, signed_in):
    world.signed_in(signed_in)
    _, out, err = run(capsys, *flags)
    for canary in (KEY, USER, EMAIL, STDERR_CANARY, VAULT_REF, "token=", "frag", str(world.home)):
        assert canary not in out + err, canary


def test_it_exits_non_zero_when_an_enabled_connection_needs_attention(world, capsys):
    world.signed_in(False)
    code, out, _ = run(capsys, "--json")
    doc = json.loads(out)
    assert code == 1 and doc["ok"] is False
    assert checks(doc)["connections"]["status"] == "fail" and checks(doc)["database"]["status"] == "ok"


def test_a_disabled_connection_that_needs_attention_is_not_a_failure(world, capsys):
    world.signed_in(False)
    world.connections["anthropic"]["enabled"] = False
    code, out, _ = run(capsys, "--json")
    assert code == 0 and json.loads(out)["ok"] is True


def test_a_database_that_cannot_open_fails_with_a_fixed_code_never_the_exception(world, capsys):
    async def broken():
        raise RuntimeError(f"unable to open database file {world.data} {DB_CANARY}")

    world.monkeypatch.setattr("oharness.providers_cli._load_runtime", broken)
    for flags in (["--json"], []):
        code, out, err = run(capsys, *flags)
        assert code == 1 and DB_CANARY not in out + err and str(world.data) not in out + err
    doc = doc_of(capsys)
    assert checks(doc)["database"] == {"id": "database", "status": "fail", "detail": "cannot-open"}
    assert checks(doc)["connections"]["status"] == "skipped" and checks(doc)["secretsStore"]["status"] == "skipped"
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))


def test_a_data_directory_that_is_not_writable_fails(world, capsys):
    world.monkeypatch.setattr(os, "access", lambda path, mode: False)
    code, out, _ = run(capsys, "--json")
    assert code == 1 and checks(json.loads(out))["dataDir"] == {"id": "dataDir", "status": "fail", "detail": "not-writable"}


def test_a_data_directory_that_does_not_exist_yet_is_a_first_run_not_a_failure(world, capsys):
    world.monkeypatch.setenv("OH_DATA_DIR", str(world.home / "first-run"))
    code, out, _ = run(capsys, "--json")
    assert code == 0 and checks(json.loads(out))["dataDir"] == {"id": "dataDir", "status": "ok", "detail": "missing"}
    assert not (world.home / "first-run").exists()  # a doctor looks, it does not create


def test_a_sidecar_that_cannot_load_fails_with_a_fixed_code(world, capsys):
    def broken():
        raise ImportError(f"cannot import {DB_CANARY}")

    world.monkeypatch.setattr("oharness.providers_cli._app_version", broken)
    code, out, err = run(capsys, "--json")
    assert code == 1 and DB_CANARY not in out + err
    assert checks(json.loads(out))["sidecar"] == {"id": "sidecar", "status": "fail", "detail": "cannot-load"}


def test_the_text_report_has_one_fixed_sentence_per_language(world, capsys, monkeypatch):
    monkeypatch.setenv("OHARNESS_LANG", "en")
    _, en, _ = run(capsys)
    assert "dataDir" in en and "sandbox" in en and "Everything is in order." in en
    monkeypatch.setenv("OHARNESS_LANG", "pt-BR")
    _, pt, _ = run(capsys)
    assert "Tudo em ordem." in pt
    world.signed_in(False)
    _, bad, _ = run(capsys)
    assert "Há falhas" in bad


def test_no_connections_is_a_clean_report(world, capsys):
    world.connections.clear()
    code, out, _ = run(capsys, "--json")
    assert code == 0 and json.loads(out)["connections"] == []
