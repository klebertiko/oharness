"""Helpers for the Workspace Manager tests (fixtures live in conftest.py).

Everything a test touches lives under ``tmp_path``: HOME/USERPROFILE and the git
configuration are redirected there, the managed root and the state store are
redirected there (``OH_WORKSPACES_HOME``), and no test reads or writes a real
repository or the user's data. Fixture repositories are built through the
production ``GitRunner`` so the test suite adds no subprocess call site of its own.
"""
from __future__ import annotations

import os
from pathlib import Path


from workspaces.gitrun import GitRunner

IDENT = ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false"]
PAYLOAD = "import pathlib, sys\npathlib.Path(sys.argv[1], sys.argv[2]).write_text('ran', encoding='utf-8')\n"


def posix(path) -> str:
    return os.fspath(path).replace("\\", "/")


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
