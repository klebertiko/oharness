"""Helpers for the Workspace Manager tests (fixtures live in conftest.py).

Everything a test touches lives under ``tmp_path``: HOME/USERPROFILE and the git
configuration are redirected there, the managed root and the state store are
redirected there (``OH_WORKSPACES_HOME``), and no test reads or writes a real
repository or the user's data. Fixture repositories are built through the
production ``GitRunner`` so the test suite adds no subprocess call site of its own.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

from workspaces.gitrun import GitRunner

IDENT = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"]
PAYLOAD = "import pathlib, sys\npathlib.Path(sys.argv[1], sys.argv[2]).write_text('ran', encoding='utf-8')\n"


def posix(path) -> str:
    return os.fspath(path).replace("\\", "/")


def make_dir_link(link, target) -> None:
    """A directory link at ``link`` pointing at ``target``: a junction on Windows (no privilege needed), a symlink elsewhere."""
    if sys.platform == "win32":
        import _winapi
        _winapi.CreateJunction(os.fspath(target), os.fspath(link))
        return
    try:
        os.symlink(target, link, target_is_directory=True)
    except OSError:
        pytest.skip("cannot create links here")


def remove_dir_link(link) -> None:
    """Undo a link made by ``make_dir_link`` without touching its target."""
    (os.rmdir if sys.platform == "win32" else os.unlink)(link)


def make_symlink(link, target, *, directory: bool) -> None:
    """A real symbolic link; skipped where the platform or the account does not allow creating one (WinError 1314)."""
    try:
        os.symlink(target, link, target_is_directory=directory)
    except (OSError, NotImplementedError):
        pytest.skip("symbolic links need a privilege this account does not have")


class Repo:
    """A throwaway repository driven through the production runner."""

    def __init__(self, path: Path, runner: GitRunner):
        self.path, self.runner = path, runner

    def git(self, *args, cwd=None, input=None, check=True):
        return self.runner.run(cwd or self.path, [*IDENT, *args], input=input, check=check)

    def out(self, *args, cwd=None) -> str:
        return self.git(*args, cwd=cwd).stdout.decode("utf-8", "replace").strip()

    def write(self, name: str, text: str = "x\n") -> Path:
        target = self.path / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text, encoding="utf-8", newline="\n")
        return target

    def commit(self, name: str, text: str = "x\n", message: str | None = None) -> str:
        self.write(name, text)
        self.git("add", "--", name)
        self.git("commit", "-q", "-m", message or f"add {name}")
        return self.out("rev-parse", "HEAD")
