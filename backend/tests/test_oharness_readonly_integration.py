"""The CLIs that promise to only look do only look (#497): no directory, database, tables, secrets folder or sidecar token is created, and stdin is not read.

Nothing here stubs `_load_runtime`, `_app_version`, the database or the secrets store: the real read path runs against a real directory.
"""
import hashlib
import json
import os
import sys
from pathlib import Path

import pytest

from oharness.cli import main

DB_PASSWORD = "dbpass-" + "c0ffee"
SIDECAR_CANARY = "sidecar-" + "tok-4417"
HUMAN_CANARY = "human-" + "tok-9021"
MODULES = ("adapters.cli_claude", "adapters.cli_codex", "adapters.cli_cursor")
COMMANDS = [["doctor", "--json"], ["doctor"], ["providers", "list"], ["providers", "list", "--json"], ["providers", "doctor", "--json"], ["providers", "doctor"]]


class _NoStdin:
    def read(self, *args):
        raise AssertionError("stdin was read")

    readline = readlines = read

    def __iter__(self):
        raise AssertionError("stdin was read")


@pytest.fixture
def quiet(monkeypatch, tmp_path):
    """A process with no database configured, no CLI installed (so no process is spawned) and canaries where a leak would show."""
    for name in ("DATABASE_URL", "OH_SECRETS", "OH_SECRETS_DIR"):
        monkeypatch.delenv(name, raising=False)
    for module in MODULES:
        monkeypatch.setattr(f"{module}.find_cli", lambda name: None)
    monkeypatch.setenv("OH_SIDECAR_TOKEN", SIDECAR_CANARY)
    monkeypatch.setenv("OH_HUMAN_TOKEN", HUMAN_CANARY)
    monkeypatch.setenv("OH_HUMAN_STDIN", "1")
    monkeypatch.setattr(sys, "stdin", _NoStdin())
    monkeypatch.setitem(sys.modules, "main", None)  # importing the whole app would read the human credential and write the sidecar token
    data = tmp_path / "data"
    monkeypatch.setenv("OH_DATA_DIR", str(data))
    return data


def _tree(root: Path) -> list[str]:
    return sorted(str(p.relative_to(root)) for p in root.rglob("*")) if root.exists() else ["<absent>"]


@pytest.mark.parametrize("argv", COMMANDS)
def test_an_empty_data_directory_stays_empty(quiet, capsys, argv):
    quiet.mkdir()
    main(argv)
    out = capsys.readouterr()
    assert _tree(quiet) == []  # no harness.db, no secrets/, no sidecar.token
    assert SIDECAR_CANARY not in out.out + out.err and HUMAN_CANARY not in out.out + out.err
    assert os.environ["OH_HUMAN_TOKEN"] == HUMAN_CANARY  # `load_human_credential` would have removed it from the environment


@pytest.mark.parametrize("argv", COMMANDS)
def test_a_data_directory_that_does_not_exist_is_not_created(quiet, capsys, argv):
    main(argv)
    capsys.readouterr()
    assert not quiet.exists() and not (quiet.parent / "data" / "sidecar.token").exists()


def test_a_first_run_is_a_clean_report_not_a_contradiction(quiet, capsys):
    code = main(["doctor", "--json"])
    doc = json.loads(capsys.readouterr().out)
    states = {c["id"]: (c["status"], c["detail"]) for c in doc["checks"]}
    assert code == 0 and states["dataDir"] == ("ok", "missing") and states["database"] == ("ok", "missing") and states["secretsStore"] == ("ok", "missing")


def _seed(path: Path) -> None:
    from sqlalchemy import create_engine
    from sqlalchemy.orm import Session

    from models import Base, ProviderConnection

    engine = create_engine(f"sqlite:///{path.as_posix()}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(ProviderConnection(id="cursor", provider="cursor", label="Cursor", residence="cloud", endpoint="", enabled=True, secret_ref=None, default_model=""))
        session.commit()
    engine.dispose()


def _digest(path: Path) -> tuple:
    return hashlib.sha256(path.read_bytes()).hexdigest(), path.stat().st_mtime_ns


def test_an_existing_database_is_read_and_left_byte_for_byte_as_it_was(quiet, capsys):
    quiet.mkdir()
    database = quiet / "harness.db"
    _seed(database)
    before, listing = _digest(database), _tree(quiet)
    assert main(["providers", "list", "--json"]) == 0
    doc = json.loads(capsys.readouterr().out)
    assert [c["id"] for c in doc["connections"]] == ["cursor"]
    assert main(["doctor", "--json"]) in (0, 1)
    capsys.readouterr()
    assert _digest(database) == before and _tree(quiet) == listing  # opened read-only: not even a journal or a wal file appeared


def test_a_database_that_is_not_sqlite_fails_with_a_fixed_code_and_never_prints_the_url(quiet, capsys, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"postgresql://app:{DB_PASSWORD}@db.example.test/oh")
    code = main(["doctor", "--json"])
    out = capsys.readouterr()
    doc = json.loads(out.out)
    assert code == 1 and {c["id"]: c for c in doc["checks"]}["database"] == {"id": "database", "status": "fail", "detail": "cannot-open"}
    assert DB_PASSWORD not in out.out + out.err and "db.example.test" not in out.out + out.err


def test_a_file_that_is_not_a_database_fails_with_a_fixed_code(quiet, capsys):
    quiet.mkdir()
    (quiet / "harness.db").write_text("this is not a sqlite file " + DB_PASSWORD, encoding="utf-8")
    code = main(["doctor", "--json"])
    out = capsys.readouterr()
    assert code == 1 and DB_PASSWORD not in out.out + out.err and str(quiet) not in out.out + out.err


def test_the_providers_commands_report_an_unreadable_database_with_one_stable_line(quiet, capsys, monkeypatch):
    monkeypatch.setenv("DATABASE_URL", f"postgresql://app:{DB_PASSWORD}@db.example.test/oh")
    code = main(["providers", "list"])
    out = capsys.readouterr()
    assert code == 1 and DB_PASSWORD not in out.out + out.err and "Traceback" not in out.err
