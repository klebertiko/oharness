"""`oharness providers dump-config` (R-PRV-19, #410): the effective configuration and where each field came from. Never a secret (I5)."""
import json
import os
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from oharness.cli import main
from secret_store.memory import MemorySecrets

BACKEND = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((BACKEND / "oharness" / "schema" / "providers-cli.schema.json").read_text(encoding="utf-8"))
KEY = "sk-" + "canary" + "-9f3a"  # built at run time: not a key-shaped literal
USER = "canaryuser77"
VAULT_REF = "oharness/openrouter"
DB_PASSWORD = "dbpass-" + "c0ffee"
ENV_CANARIES = {  # the credential variables I5 keeps out of a CLI subprocess: none may surface here either
    "ANTHROPIC_API_KEY": "ant-" + "env-canary-1",
    "OPENAI_API_KEY": "oai-" + "env-canary-2",
    "CURSOR_API_KEY": "cur-" + "env-canary-3",
    "OH_SIDECAR_TOKEN": "tok-" + "env-canary-4",
    "OH_HUMAN_TOKEN": "hum-" + "env-canary-5",
}


def _row(pid, provider, **extra):
    return {"id": pid, "provider": provider, "label": pid.title(), "residence": "cloud", "endpoint": "", "enabled": True,
            "secretRef": None, "defaultModel": "", **extra}


@pytest.fixture
def world(monkeypatch, tmp_path):
    home = tmp_path / USER
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    for name in ("OH_DATA_DIR", "OH_SECRETS", "OH_SECRETS_DIR", "DATABASE_URL"):
        monkeypatch.delenv(name, raising=False)
    for name, value in ENV_CANARIES.items():
        monkeypatch.setenv(name, value)
    store = MemorySecrets()
    store.put(VAULT_REF, KEY)
    connections = {
        "anthropic": _row("anthropic", "anthropic"),
        "openrouter": _row("openrouter", "openrouter", secretRef=VAULT_REF, defaultModel="meta/m1",
                           endpoint=f"https://u:{KEY}@openrouter.ai/api/v1?token={KEY}#frag"),
        "ollama": _row("ollama", "ollama", residence="local", enabled=False),
    }

    async def fake_load():
        # what the real loader does first when the process has no database yet: the packaged sidecar's defaults
        os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(home / 'data' / 'harness.db').as_posix()}")
        os.environ.setdefault("OH_SECRETS", "file")
        os.environ.setdefault("OH_SECRETS_DIR", str(home / "data" / "secrets"))
        return connections, store

    monkeypatch.setattr("oharness.providers_cli._load_runtime", fake_load)

    def no_adapter(name):
        raise AssertionError("dump-config never touches a provider adapter")

    monkeypatch.setattr("routers.providers.get_adapter", no_adapter)

    class World:
        pass

    w = World()
    w.connections, w.home = connections, home
    return w


def run(capsys, *argv):
    code = main(["providers", "dump-config", *argv])
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def doc_of(capsys, *argv):
    code, out, err = run(capsys, "--json", *argv)
    assert code == 0 and not err
    return json.loads(out)


def fields(doc, cid):
    return {c["id"]: c["fields"] for c in doc["connections"]}[cid]


def test_dump_config_json_is_versioned_and_schema_valid(world, capsys):
    doc = doc_of(capsys)
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    assert doc["schemaVersion"] == 1 and doc["command"] == "dump-config"
    assert [c["id"] for c in doc["connections"]] == ["anthropic", "openrouter", "ollama"]


def test_a_stored_field_is_from_the_app_and_a_missing_one_from_the_default(world, capsys):
    doc = doc_of(capsys)
    openrouter, anthropic = fields(doc, "openrouter"), fields(doc, "anthropic")
    assert openrouter["endpoint"] == {"value": "https://openrouter.ai/api/v1", "origin": "app"}
    assert openrouter["defaultModel"] == {"value": "meta/m1", "origin": "app"}
    assert anthropic["endpoint"] == {"value": "https://api.anthropic.com", "origin": "default"}  # the catalog's own endpoint
    assert anthropic["defaultModel"] == {"value": "", "origin": "default"}
    assert fields(doc, "ollama")["enabled"] == {"value": False, "origin": "app"}
    assert anthropic["residence"] == {"value": "cloud", "origin": "app"} and anthropic["label"]["origin"] == "app"


def test_the_credential_is_described_never_shown(world, capsys):
    doc = doc_of(capsys)
    assert fields(doc, "anthropic")["credentialKind"] == {"value": "cli", "origin": "default"}
    assert fields(doc, "openrouter")["credentialKind"] == {"value": "api-key", "origin": "default"}
    assert fields(doc, "openrouter")["secretStored"] == {"value": True, "origin": "app"}
    assert fields(doc, "anthropic")["secretStored"] == {"value": False, "origin": "app"}


def test_environment_values_the_process_was_given_are_from_env(world, capsys, monkeypatch):
    monkeypatch.setenv("OH_DATA_DIR", str(world.home / "mine"))
    monkeypatch.setenv("OH_SECRETS", "keychain")
    env = doc_of(capsys)["environment"]
    assert env["dataDir"] == {"value": "~/mine", "origin": "env"}
    assert env["secretsBackend"] == {"value": "keychain", "origin": "env"}


def test_environment_values_the_sidecar_defaults_filled_in_are_default(world, capsys):
    """`OH_SECRETS`/`OH_SECRETS_DIR` were not in the process environment: the packaged sidecar's own defaults set them."""
    env = doc_of(capsys)["environment"]
    assert env["secretsBackend"] == {"value": "file", "origin": "default"}
    assert env["secretsDir"] == {"value": "~/data/secrets", "origin": "default"}
    assert env["dataDir"]["origin"] == "default"


def test_the_database_is_reported_by_kind_only(world, capsys, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"postgresql://app:{DB_PASSWORD}@db.example.test/oh")
    _, out, _ = run(capsys, "--json")
    assert json.loads(out)["environment"]["database"] == {"value": "other", "origin": "env"}
    assert DB_PASSWORD not in out and "db.example.test" not in out


@pytest.mark.parametrize("flags", [["--json"], []])
def test_no_canary_reaches_any_output(world, capsys, monkeypatch, flags):
    monkeypatch.setenv("OH_DATA_DIR", str(world.home / "mine"))
    _, out, err = run(capsys, *flags)
    secrets = (KEY, VAULT_REF, USER, DB_PASSWORD, *ENV_CANARIES.values(), "token=", "frag", "secretRef")
    for canary in secrets:
        assert canary not in out + err, canary


def test_only_an_allowlist_of_variables_is_ever_read(world, capsys, monkeypatch):
    """Nothing else from the environment may travel: a new variable carrying a canary in its name or value never shows up."""
    monkeypatch.setenv("SOMETHING_ELSE_ENTIRELY", "whatever-" + "zz9")
    _, out, _ = run(capsys, "--json")
    assert "SOMETHING_ELSE" not in out and "whatever-" not in out


def test_text_lists_each_field_with_its_origin(world, capsys):
    code, out, _ = run(capsys)
    assert code == 0
    assert "openrouter" in out and "endpoint" in out and "(app)" in out and "(default)" in out


def test_no_connections_still_reports_the_environment(world, capsys):
    world.connections.clear()
    doc = doc_of(capsys)
    assert doc["connections"] == [] and doc["environment"]["secretsBackend"]["value"] == "file"


def test_a_secrets_backend_the_app_does_not_know_is_never_echoed(world, capsys, monkeypatch):
    """The backend is reported from a fixed vocabulary: whatever text the variable holds stays out of the output."""
    monkeypatch.setenv("OH_SECRETS", "weird-" + "value-7731")
    _, out, _ = run(capsys, "--json")
    assert json.loads(out)["environment"]["secretsBackend"] == {"value": "unknown", "origin": "env"}
    assert "weird-" not in out
