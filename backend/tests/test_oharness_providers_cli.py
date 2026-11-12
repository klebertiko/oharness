"""`oharness providers list|test` (R-PRV-17): connections from the data directory, probe by id, stable --json, never a secret."""
import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

from adapters.base import ProbeResult
from oharness.cli import main
from secret_store.memory import MemorySecrets

BACKEND = Path(__file__).resolve().parents[1]
SCHEMA = json.loads((BACKEND / "oharness" / "schema" / "providers-cli.schema.json").read_text(encoding="utf-8"))
SECRET = "canary-secret-" + "9b41e7"
STDERR_CANARY = "CANARY-STDERR-" + "5f1c9a"


def _row(pid, provider, **extra):
    return {"id": pid, "provider": provider, "label": pid.title(), "residence": "cloud", "endpoint": "", "enabled": True,
            "secretRef": None, "defaultModel": "", **extra}


class FakeAdapter:
    def __init__(self, result=None, error=None):
        self.result, self.error, self.seen = result, error, []

    async def probe(self, config):
        self.seen.append(config)
        if self.error:
            raise self.error
        return self.result


@pytest.fixture
def world(monkeypatch):
    """Two stored connections (a subscription one and an api-key one with a stored secret) and a probe stub."""
    store = MemorySecrets()
    store.put("oharness/openrouter", SECRET)
    connections = {
        "anthropic": _row("anthropic", "anthropic"),
        "openrouter": _row("openrouter", "openrouter", secretRef="oharness/openrouter", endpoint="https://openrouter.ai/api/v1"),
    }

    async def fake_load():
        return connections, store

    monkeypatch.setattr("oharness.providers_cli._load_runtime", fake_load)
    adapter = FakeAdapter(ProbeResult(ok=True, health="live", detail="Signed in.", latency_ms=12, facts=[("Plan", "Max", "ok")], models=["m1"]))
    monkeypatch.setattr("routers.providers.get_adapter", lambda name: adapter)
    return SimpleWorld(connections, adapter)


class SimpleWorld:
    def __init__(self, connections, adapter):
        self.connections, self.adapter = connections, adapter


def run(capsys, *argv):
    code = main(["providers", *argv])
    captured = capsys.readouterr()
    return code, captured.out, captured.err


def test_the_schema_is_a_valid_json_schema():
    Draft202012Validator.check_schema(SCHEMA)


def test_list_json_is_versioned_schema_valid_and_has_no_secret(world, capsys):
    code, out, err = run(capsys, "list", "--json")
    assert code == 0
    doc = json.loads(out)
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    assert doc["schemaVersion"] == 1 and doc["command"] == "list"
    by_id = {c["id"]: c for c in doc["connections"]}
    assert by_id["anthropic"]["credentialKind"] == "cli" and by_id["anthropic"]["hasSecret"] is False
    assert by_id["openrouter"]["credentialKind"] == "api-key" and by_id["openrouter"]["hasSecret"] is True
    assert SECRET not in out + err and "secretRef" not in out


def test_an_endpoint_is_printed_without_userinfo_query_or_fragment(world, capsys):
    """A pasted `https://user:token@host/path?key=...` must never reach stdout, in JSON or in text."""
    world.connections["openrouter"]["endpoint"] = "https://me:" + SECRET + "@openrouter.ai/api/v1?api_key=" + SECRET + "#frag"
    code, out, err = run(capsys, "list", "--json")
    assert code == 0 and SECRET not in out + err and "me:" not in out and "api_key" not in out and "frag" not in out
    doc = json.loads(out)
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    assert {c["id"]: c["endpoint"] for c in doc["connections"]}["openrouter"] == "https://openrouter.ai/api/v1"
    code, text, err = run(capsys, "list")
    assert SECRET not in text + err and "me:" not in text and "api_key" not in text


def test_an_endpoint_that_is_not_a_url_is_never_echoed(world, capsys):
    world.connections["openrouter"]["endpoint"] = "not a url with " + SECRET
    _, out, err = run(capsys, "list", "--json")
    assert SECRET not in out + err
    _, text, err = run(capsys, "list")
    assert SECRET not in text + err


def test_the_data_directory_is_shown_relative_to_the_profile_unless_verbose(world, capsys, monkeypatch, tmp_path):
    """The absolute path carries the OS user name: it is spelled `~/...` by default and in full only on request."""
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: tmp_path))
    monkeypatch.setenv("OH_DATA_DIR", str(tmp_path / "data" / "oh"))
    _, out, _ = run(capsys, "list", "--json")
    shown = json.loads(out)["dataDir"]
    assert shown == "~/data/oh" and str(tmp_path) not in out
    _, full, _ = run(capsys, "list", "--json", "--verbose")
    assert json.loads(full)["dataDir"] == str(tmp_path / "data" / "oh")


def test_a_data_directory_outside_the_profile_is_shown_as_it_is(world, capsys, monkeypatch, tmp_path):
    home, elsewhere = tmp_path / "home", tmp_path / "elsewhere"
    home.mkdir()
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))
    monkeypatch.setenv("OH_DATA_DIR", str(elsewhere))
    _, out, _ = run(capsys, "list", "--json")
    assert json.loads(out)["dataDir"] == str(elsewhere)


def test_list_text_shows_every_connection_and_no_secret(world, capsys):
    code, out, err = run(capsys, "list")
    assert code == 0
    assert "anthropic" in out and "openrouter" in out
    assert SECRET not in out + err


def test_list_with_no_connections_says_so(world, capsys):
    world.connections.clear()
    code, out, _ = run(capsys, "list")
    assert code == 0 and "no connections" in out.lower()
    code, out, _ = run(capsys, "list", "--json")
    assert json.loads(out)["connections"] == []


def test_test_live_exits_zero_with_schema_valid_json(world, capsys):
    code, out, _ = run(capsys, "test", "anthropic", "--json")
    assert code == 0
    doc = json.loads(out)
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))
    assert doc["command"] == "test" and doc["health"] == "live" and doc["ok"] is True and doc["id"] == "anthropic"
    assert doc["modelCount"] == 1 and doc["latencyMs"] == 12 and doc["message"] == "The connection is live."


@pytest.mark.parametrize("health", ["setup", "degraded", "fault"])
def test_test_any_state_but_live_exits_non_zero(world, capsys, health):
    world.adapter.result = ProbeResult(ok=False, health=health, detail="Sign in first.")
    code, out, _ = run(capsys, "test", "anthropic", "--json")
    doc = json.loads(out)
    assert code == 1 and doc["health"] == health and doc["ok"] is False
    assert not list(Draft202012Validator(SCHEMA).iter_errors(doc))


def test_test_unknown_id_is_a_usage_error_on_stderr(world, capsys):
    code, out, err = run(capsys, "test", "nope", "--json")
    assert code == 2 and out == "" and "nope" in err


def test_test_attaches_the_stored_key_only_to_the_probe_never_to_output(world, capsys):
    world.adapter.result = ProbeResult(ok=True, health="live", detail="Reachable.")
    code, out, err = run(capsys, "test", "openrouter", "--json")
    assert code == 0
    assert world.adapter.seen[0].api_key == SECRET  # the same probe the app runs
    assert SECRET not in out + err


def test_a_subscription_probe_never_gets_a_key(world, capsys):
    run(capsys, "test", "anthropic")
    assert world.adapter.seen[0].api_key == ""


def test_a_crashing_probe_prints_a_fixed_line_not_the_exception_text(world, capsys):
    world.adapter.error = RuntimeError(f"boom {STDERR_CANARY} {SECRET}")
    code, out, err = run(capsys, "test", "anthropic", "--json")
    assert code == 1
    assert STDERR_CANARY not in out + err and SECRET not in out + err
    assert json.loads(out)["health"] == "fault"


def test_a_probe_s_own_words_are_never_printed(world, capsys):
    """The adapters' detail and facts carry the account e-mail and a CLI's own last stderr line: only a fixed sentence per state gets out."""
    email = "someone" + "@" + "example.test"
    leaked = "sk-ant-" + "a1b2c3d4e5f6g7h8i9j0k1l2"
    world.adapter.result = ProbeResult(
        ok=True, health="live", detail=f"Logged in as {email} (Max plan). {STDERR_CANARY} {leaked}",
        facts=[("Account", email, "ok"), ("Raw", STDERR_CANARY, "bad")], models=[STDERR_CANARY],
    )
    for extra in ([], ["--json"]):
        code, out, err = run(capsys, "test", "anthropic", *extra)
        assert code == 0
        for needle in (email, STDERR_CANARY, leaked, "Max plan"):
            assert needle not in out + err, needle


@pytest.mark.parametrize("health", ["live", "setup", "degraded", "fault"])
def test_each_state_prints_its_one_fixed_sentence_in_both_languages(world, capsys, monkeypatch, health):
    world.adapter.result = ProbeResult(ok=health == "live", health=health, detail="ignored")
    monkeypatch.setenv("OHARNESS_LANG", "en")
    _, en_out, _ = run(capsys, "test", "anthropic", "--json")
    monkeypatch.setenv("OHARNESS_LANG", "pt-BR")
    _, pt_out, _ = run(capsys, "test", "anthropic", "--json")
    en, pt = json.loads(en_out)["message"], json.loads(pt_out)["message"]
    assert en and pt and en != pt and "ignored" not in en + pt


def test_a_health_the_cli_does_not_know_is_reported_as_fault(world, capsys):
    world.adapter.result = ProbeResult(ok=True, health="mystery", detail="x")
    code, out, _ = run(capsys, "test", "anthropic", "--json")
    assert code == 1 and json.loads(out)["health"] == "fault" and json.loads(out)["ok"] is False


def _seed_data_dir() -> None:
    """Runs in a fresh interpreter: the app's own persistence code writes one connection into the data directory."""
    import asyncio

    from sidecar_entry import configure_environment

    configure_environment()
    from database import SessionLocal, init_db
    from providers import store

    async def go() -> None:
        await init_db()
        async with SessionLocal() as db:
            await store.upsert(db, {"id": "cursor", "provider": "cursor", "label": "Cursor", "residence": "cloud", "endpoint": "", "enabled": True})

    asyncio.run(go())


def _list_from_data_dir(queue) -> None:
    """Runs in another fresh interpreter: the CLI's own entry point, nothing stubbed."""
    import contextlib
    import io

    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = main(["providers", "list", "--json", "--verbose"])
    queue.put((code, out.getvalue()))


def test_real_process_lists_what_the_data_directory_holds(monkeypatch, tmp_path):
    """No stubs: seed a data directory with the app's own persistence code, then read it back through the CLI in a separate process."""
    import multiprocessing

    monkeypatch.setenv("OH_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("OH_SECRETS", "file")
    monkeypatch.setenv("OH_SECRETS_DIR", str(tmp_path / "secrets"))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    spawn = multiprocessing.get_context("spawn")  # a fresh interpreter each time: no engine or env carried over from this one
    seeding = spawn.Process(target=_seed_data_dir)
    seeding.start()
    seeding.join(60)
    assert seeding.exitcode == 0
    queue = spawn.Queue()
    listing = spawn.Process(target=_list_from_data_dir, args=(queue,))
    listing.start()
    code, text = queue.get(timeout=60)
    listing.join(60)
    assert code == 0 and listing.exitcode == 0
    doc = json.loads(text)
    assert [c["id"] for c in doc["connections"]] == ["cursor"]
    assert doc["dataDir"] == str(tmp_path)  # `--verbose`: the full path, whatever the profile
