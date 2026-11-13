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
        # the real loader (`readonly.read_connections`) only reads: it never fills in the sidecar's defaults (#497), so neither does this one
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
    assert env["secretsDir"] == {"value": "default", "origin": "default"}  # the label, never the path
    assert env["dataDir"]["origin"] == "default"


def test_a_secrets_directory_the_process_was_given_is_a_label_and_its_path_is_never_printed(world, capsys, monkeypatch):
    monkeypatch.setenv("OH_SECRETS_DIR", str(world.home / "elsewhere"))
    for flags in (["--json"], []):
        _, out, _ = run(capsys, *flags)
        assert "elsewhere" not in out
    doc = doc_of(capsys)
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    assert doc["environment"]["secretsDir"] == {"value": "custom", "origin": "env"}


def test_the_default_secrets_directory_is_labelled_default(world, capsys):
    doc = doc_of(capsys)
    assert doc["environment"]["secretsDir"] == {"value": "default", "origin": "default"}
    assert "secrets" not in json.dumps(doc["environment"]["secretsDir"]).replace("secretsDir", "")


def test_there_is_no_flag_that_prints_the_secrets_path(world, capsys):
    """The folder is a label only: `--verbose` does not exist for dump-config."""
    with pytest.raises(SystemExit) as raised:
        main(["providers", "dump-config", "--json", "--verbose"])
    assert raised.value.code == 2
    assert "elsewhere" not in capsys.readouterr().out


@pytest.mark.parametrize("backend", ["memory", "keychain"])
def test_there_is_no_secrets_directory_when_the_backend_is_not_a_file(world, capsys, monkeypatch, backend):
    monkeypatch.setenv("OH_SECRETS", backend)
    monkeypatch.setenv("OH_SECRETS_DIR", str(world.home / "elsewhere"))
    doc = doc_of(capsys)
    assert doc["environment"]["secretsDir"] == {"value": None, "origin": "default"}  # no folder at all: the variable it was given does not apply (#494)
    assert "elsewhere" not in json.dumps(doc)


@pytest.mark.parametrize(("alias", "name"), [("mem", "memory"), ("keyring", "keychain"), ("os", "keychain"), ("FILE", "file"), ("", "memory")])
def test_the_aliases_the_secrets_factory_accepts_are_named_the_same(world, capsys, monkeypatch, alias, name):
    monkeypatch.setenv("OH_SECRETS", alias)
    assert doc_of(capsys)["environment"]["secretsBackend"]["value"] == name


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


def test_the_environment_is_the_packaged_sidecars_without_any_loader_filling_it_in(world, capsys, monkeypatch):
    """Nothing set: the installed app keeps its keys in `<data>/secrets` (file) and its database in `<data>/harness.db`: that is what is reported."""
    env = doc_of(capsys)["environment"]
    assert env["secretsBackend"] == {"value": "file", "origin": "default"}
    assert env["secretsDir"] == {"value": "default", "origin": "default"}
    assert env["database"] == {"value": "sqlite", "origin": "default"}
    for name in ("OH_SECRETS", "OH_SECRETS_DIR", "DATABASE_URL"):
        assert name not in os.environ  # reporting the defaults does not set them


def test_a_stored_endpoint_that_is_not_a_url_is_reported_invalid_not_as_the_default(world, capsys, monkeypatch):
    """A broken value the app stored must show as the app's (and broken), never hide behind the catalog default (#494)."""
    world.connections["anthropic"]["endpoint"] = "ftp://files.example.test/" + KEY
    assert fields(doc_of(capsys), "anthropic")["endpoint"] == {"value": None, "origin": "app"}
    monkeypatch.setenv("OHARNESS_LANG", "en")
    _, out, _ = run(capsys)
    line = next(l for l in out.splitlines() if l.strip().startswith("endpoint") and "invalid" in l)
    assert "(app)" in line and KEY not in out and "files.example.test" not in out


def test_the_text_follows_the_language_like_the_doctor(world, capsys, monkeypatch):
    monkeypatch.setenv("OHARNESS_LANG", "pt-BR")
    world.connections["anthropic"]["endpoint"] = "not a url"
    _, pt, _ = run(capsys)
    assert "(padrão)" in pt and "(app)" in pt and "inválido" in pt
    monkeypatch.setenv("OHARNESS_LANG", "en")
    _, en, _ = run(capsys)
    assert "(default)" in en and "invalid" in en and "padrão" not in en


def test_no_connections_text_says_so_in_the_language(world, capsys, monkeypatch):
    world.connections.clear()
    monkeypatch.setenv("OHARNESS_LANG", "pt-BR")
    _, out, _ = run(capsys)
    assert "nenhuma conexão" in out.lower()


@pytest.mark.parametrize("odd", ["file ", "FILE", "keychain\x1b[31m", KEY, None])
def test_only_a_word_of_the_codes_own_vocabulary_is_ever_printed_for_the_backend(world, capsys, monkeypatch, odd):
    """What `readonly` returns never reaches the output as itself: it is mapped to a literal of this module, anything else is `unknown`."""
    monkeypatch.setattr("oharness.readonly.secrets_backend", lambda: odd)
    for flags in (["--json"], []):
        _, out, _ = run(capsys, *flags)
        assert (KEY not in out) and "\x1b" not in out
    assert doc_of(capsys)["environment"]["secretsBackend"]["value"] == "unknown"


def test_a_label_or_id_with_a_terminal_escape_is_cleaned_in_the_text_output(world, capsys):
    """Free text a person typed reaches the terminal as printable characters only, cut short (#483); JSON keeps the data as it is."""
    escape = "\x1b[31m"
    world.connections["anthropic"]["label"] = "a" + escape + "b" + "x" * 200 + " " + KEY
    world.connections["evil" + escape] = _row("evil" + escape, "ollama")
    code, out, _ = run(capsys)
    assert code == 0
    assert "\x1b" not in out
    assert KEY not in out  # past the cut
    assert max(len(line) for line in out.splitlines()) < 200
    assert fields(doc_of(capsys), "anthropic")["label"]["value"].startswith("a" + escape + "b")


def test_every_text_value_is_cleaned_the_environment_and_the_provider_too(world, capsys, monkeypatch):
    """Not only `id` and the free fields: a data directory or a provider name holding a terminal escape is cleaned too (#494)."""
    escape = "]0;title"
    monkeypatch.setenv("OH_DATA_DIR", str(world.home / ("d" + escape)))
    world.connections["odd"] = _row("odd", "ollama" + escape)
    code, out, _ = run(capsys)
    assert code == 0 and "" not in out and "" not in out
