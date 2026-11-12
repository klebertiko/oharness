"""R-PRV-18: the desktop app and the `oharness` CLI read the same data directory (connections, secrets)."""

import json
import os
from pathlib import Path

import pytest

import data_dir
import sidecar_entry

TAURI_CONF = Path(__file__).resolve().parents[2] / "src-tauri" / "tauri.conf.json"


def _app_identifier() -> str:
    return json.loads(TAURI_CONF.read_text(encoding="utf-8"))["identifier"]


def test_identifier_matches_the_desktop_app() -> None:
    """The directory name is the Tauri bundle identifier: `app_local_data_dir` in the shell is `<local data>/<identifier>`."""
    assert data_dir.APP_IDENTIFIER == _app_identifier()


def test_override_wins_and_is_created(tmp_path: Path) -> None:
    target = tmp_path / "chosen"
    assert data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(target)}) == target
    assert target.is_dir()


def test_blank_override_is_ignored(tmp_path: Path) -> None:
    resolved = data_dir.resolve_data_dir(env={"OH_DATA_DIR": "  ", "LOCALAPPDATA": str(tmp_path)}, system="Windows", create=False)
    assert resolved == tmp_path / _app_identifier()


@pytest.mark.parametrize(
    ("system", "env", "expected"),
    [
        ("Windows", {"LOCALAPPDATA": "C:/Users/a/AppData/Local"}, Path("C:/Users/a/AppData/Local") / "dev.oharness.app"),
        ("Darwin", {}, Path("/home/a") / "Library" / "Application Support" / "dev.oharness.app"),
        ("Linux", {}, Path("/home/a") / ".local" / "share" / "dev.oharness.app"),
        ("Linux", {"XDG_DATA_HOME": "/xdg"}, Path("/xdg") / "dev.oharness.app"),
    ],
)
def test_default_follows_the_shell_per_platform(system: str, env: dict, expected: Path) -> None:
    assert data_dir.resolve_data_dir(env=env, system=system, home=Path("/home/a"), create=False) == expected


def test_windows_without_localappdata_falls_back_to_home() -> None:
    resolved = data_dir.resolve_data_dir(env={}, system="Windows", home=Path("/home/a"), create=False)
    assert resolved == Path("/home/a") / "AppData" / "Local" / "dev.oharness.app"


def test_sidecar_and_cli_resolve_the_same_directory(monkeypatch, tmp_path: Path) -> None:
    """The packaged sidecar (which the shell hands OH_DATA_DIR) and the CLI (which has no shell) land on one directory."""
    monkeypatch.delenv("OH_DATA_DIR", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("XDG_DATA_HOME", str(tmp_path))
    monkeypatch.setattr(data_dir.platform, "system", lambda: "Windows")
    from_sidecar = sidecar_entry._data_dir()
    from_shell = Path(os.environ["LOCALAPPDATA"]) / _app_identifier()
    assert from_sidecar == from_shell


def test_configure_environment_points_database_and_secrets_at_it(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("OH_DATA_DIR", str(tmp_path))
    for name in ("DATABASE_URL", "OH_SECRETS", "OH_SECRETS_DIR"):
        monkeypatch.delenv(name, raising=False)
    sidecar_entry.configure_environment()
    assert os.environ["DATABASE_URL"].endswith((tmp_path / "harness.db").as_posix())
    assert Path(os.environ["OH_SECRETS_DIR"]) == tmp_path / "secrets"
