"""R-PRV-18, security side: the data directory is absolute, honest about what it is, private when we create it, and the CLI path agrees."""

import json
import os
import platform
import subprocess
import sys
from pathlib import Path

import pytest

import data_dir
from oharness import headless
from security import sidecar_token

TAURI_CONF = Path(__file__).resolve().parents[2] / "src-tauri" / "tauri.conf.json"
IDENTIFIER = json.loads(TAURI_CONF.read_text(encoding="utf-8"))["identifier"]


# --- paths must be absolute --------------------------------------------------------------------

@pytest.mark.parametrize("value", ["relative/dir", "."])
def test_a_relative_override_is_refused_with_a_clear_error(value: str) -> None:
    with pytest.raises(data_dir.DataDirError, match="OH_DATA_DIR must be an absolute path"):
        data_dir.resolve_data_dir(env={"OH_DATA_DIR": value}, create=False)


@pytest.mark.parametrize(
    ("system", "env", "name"),
    [("Windows", {"LOCALAPPDATA": "AppData/Local"}, "LOCALAPPDATA"), ("Linux", {"XDG_DATA_HOME": "share"}, "XDG_DATA_HOME")],
)
def test_a_relative_platform_base_is_refused(system: str, env: dict, name: str) -> None:
    with pytest.raises(data_dir.DataDirError, match=f"{name} must be an absolute path"):
        data_dir.resolve_data_dir(env=env, system=system, home=Path("/home/a"), create=False)


# --- stable errors, no personal path -----------------------------------------------------------

def test_an_override_that_is_a_file_gives_a_stable_error_without_the_path(tmp_path: Path) -> None:
    afile = tmp_path / "personal-folder-name"
    afile.write_text("x", encoding="utf-8")
    with pytest.raises(data_dir.DataDirError) as raised:
        data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(afile)})
    assert "personal-folder-name" not in str(raised.value) and str(tmp_path) not in str(raised.value)


def test_an_unwritable_location_gives_a_stable_error_without_the_path(tmp_path: Path) -> None:
    blocker = tmp_path / "blocker"
    blocker.write_text("x", encoding="utf-8")
    with pytest.raises(data_dir.DataDirError) as raised:
        data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(blocker / "inside")})  # the parent is a file: mkdir fails
    assert str(tmp_path) not in str(raised.value) and "blocker" not in str(raised.value)
    assert raised.value.__suppress_context__  # the OSError text carries the path: it is not chained into the traceback


def _link(target: Path, link: Path) -> None:
    try:
        link.symlink_to(target, target_is_directory=True)
    except (OSError, NotImplementedError):
        pytest.skip("symbolic links are not available here")


def test_the_default_directory_is_never_a_link_that_leads_elsewhere(tmp_path: Path) -> None:
    """A planted `dev.oharness.app` link in the base directory would send the database and secrets to a place someone else chose."""
    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    base = tmp_path / "local"
    base.mkdir()
    _link(elsewhere, base / IDENTIFIER)
    with pytest.raises(data_dir.DataDirError, match="link"):
        data_dir.resolve_data_dir(env={"LOCALAPPDATA": str(base)}, system="Windows")
    assert list(elsewhere.iterdir()) == []


@pytest.mark.skipif(platform.system() != "Windows", reason="junctions are a Windows thing")
def test_the_default_directory_is_never_a_junction_that_leads_elsewhere(tmp_path: Path) -> None:
    """A junction needs no privilege to create (a symlink does), so this is the planted-link case that can happen to a normal user."""
    import _winapi

    elsewhere = tmp_path / "elsewhere"
    elsewhere.mkdir()
    base = tmp_path / "local"
    base.mkdir()
    _winapi.CreateJunction(str(elsewhere), str(base / IDENTIFIER))
    assert (base / IDENTIFIER).is_junction() and not (base / IDENTIFIER).is_symlink()  # `is_symlink` alone would let it through
    with pytest.raises(data_dir.DataDirError, match="link"):
        data_dir.resolve_data_dir(env={"LOCALAPPDATA": str(base)}, system="Windows")
    assert list(elsewhere.iterdir()) == []


def test_an_explicit_override_may_be_a_link_the_person_chose(tmp_path: Path) -> None:
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "chosen"
    _link(real, link)
    assert data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(link)}) == link


# --- a directory we create is private to the person --------------------------------------------

def test_a_directory_this_call_creates_is_restricted_to_the_user(monkeypatch, tmp_path: Path) -> None:
    calls: list[Path] = []
    monkeypatch.setattr(sidecar_token, "restrict_to_current_user", lambda path: calls.append(path) or True)
    target = tmp_path / "made" / "app"
    data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(target)})
    assert calls == [target]


def test_an_existing_directory_is_left_as_it_is(monkeypatch, tmp_path: Path) -> None:
    calls: list[Path] = []
    monkeypatch.setattr(sidecar_token, "restrict_to_current_user", lambda path: calls.append(path) or True)
    data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(tmp_path)})
    assert calls == []


@pytest.mark.skipif(platform.system() == "Windows", reason="POSIX mode bits")
def test_posix_creation_is_0700_from_the_first_instant(monkeypatch, tmp_path: Path) -> None:
    """The mode is checked with the later chmod switched off: the directory must already be 0700 the instant `mkdir` returns."""
    monkeypatch.setattr(sidecar_token, "restrict_to_current_user", lambda path: True)
    target = tmp_path / "private"
    old = os.umask(0)  # a permissive umask would leave 0777 behind if the mode were not passed to mkdir
    try:
        data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(target)})
    finally:
        os.umask(old)
    assert (target.stat().st_mode & 0o777) == 0o700


@pytest.mark.skipif(platform.system() != "Windows", reason="Windows ACLs")
def test_windows_creation_leaves_only_the_current_user_with_inheritable_access(tmp_path: Path) -> None:
    target = tmp_path / "private"
    data_dir.resolve_data_dir(env={"OH_DATA_DIR": str(target)})
    acl = subprocess.run(["icacls", str(target)], capture_output=True, text=True, check=True).stdout  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
    user = os.environ["USERNAME"]
    assert f"{user}:(OI)(CI)(F)" in acl, acl  # what a file written inside inherits
    broad = ("Everyone:", "BUILTIN\\Users:", "NT AUTHORITY\\Authenticated Users:", "NT AUTHORITY\\INTERACTIVE:")
    assert not [name for name in broad if name in acl], acl  # only the person (and the system's own accounts) remain
    child = target / "harness.db"
    child.write_text("x", encoding="utf-8")
    child_acl = subprocess.run(["icacls", str(child)], capture_output=True, text=True, check=True).stdout  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
    assert not [name for name in broad if name in child_acl], child_acl


@pytest.mark.skipif(platform.system() == "Windows", reason="POSIX mode bits")
def test_restrict_to_current_user_gives_a_directory_0700_and_a_file_0600(tmp_path: Path) -> None:
    folder, afile = tmp_path / "d", tmp_path / "f"
    folder.mkdir(mode=0o777)
    afile.write_text("x", encoding="utf-8")
    assert sidecar_token.restrict_to_current_user(folder) and sidecar_token.restrict_to_current_user(afile)
    assert (folder.stat().st_mode & 0o777) == 0o700 and (afile.stat().st_mode & 0o777) == 0o600


# --- the CLI's real path -----------------------------------------------------------------------

def test_the_cli_run_path_configures_the_same_directory_as_the_sidecar(monkeypatch, tmp_path: Path) -> None:
    """`headless._backend_on_path` (what `oharness run --mode live` calls) configures only when DATABASE_URL is absent."""
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("OH_SECRETS", raising=False)
    monkeypatch.delenv("OH_SECRETS_DIR", raising=False)
    monkeypatch.setenv("OH_DATA_DIR", str(tmp_path / "shared"))
    headless._backend_on_path()
    assert os.environ["DATABASE_URL"].endswith((tmp_path / "shared" / "harness.db").as_posix())
    assert Path(os.environ["OH_SECRETS_DIR"]) == tmp_path / "shared" / "secrets"


def test_the_cli_without_override_uses_the_directory_named_by_the_desktop_app(tmp_path: Path) -> None:
    """A real process, no OH_DATA_DIR: the database lands next to the app's own identifier."""
    local = tmp_path / "local"
    env = {k: v for k, v in os.environ.items() if k not in ("OH_DATA_DIR", "DATABASE_URL", "OH_SECRETS", "OH_SECRETS_DIR")}
    env.update({"LOCALAPPDATA": str(local), "XDG_DATA_HOME": str(local), "HOME": str(tmp_path), "USERPROFILE": str(tmp_path)})
    code = "from oharness import headless; import os; headless._backend_on_path(); print(os.environ['DATABASE_URL'])"
    backend = Path(__file__).resolve().parents[1]
    done = subprocess.run([sys.executable, "-c", code], env=env, cwd=backend, capture_output=True, text=True, timeout=60)  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
    assert done.returncode == 0, done.stderr
    system = platform.system()
    if system == "Windows":
        expected = local / IDENTIFIER
    elif system == "Darwin":
        expected = tmp_path / "Library" / "Application Support" / IDENTIFIER
    else:
        expected = local / IDENTIFIER  # XDG_DATA_HOME is set to `local` above
    assert done.stdout.strip().endswith((expected / "harness.db").as_posix())
