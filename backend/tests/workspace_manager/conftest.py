"""Fixtures for the Workspace Manager tests: HOME, git environment and data directory all live under tmp_path."""
from __future__ import annotations

import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from workspaces.config import Settings
from workspaces.gitrun import GitRunner
from workspaces.service import WorkspaceService
from workspaces_support import PAYLOAD, Repo, posix


@pytest.fixture
def oh_env(monkeypatch, tmp_path):
    """Isolated HOME, git environment and Workspace Manager data directory."""
    for key in list(os.environ):
        if key.upper().startswith("GIT_"):
            monkeypatch.delenv(key)
    home = tmp_path / "home"
    home.mkdir()
    for key in ("HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "XDG_CONFIG_HOME"):
        monkeypatch.setenv(key, str(home))
    data = tmp_path / "oh-data"
    monkeypatch.setenv("OH_WORKSPACES_HOME", str(data))
    return SimpleNamespace(home=home, data=data, tmp=tmp_path, settings=Settings.from_env())


@pytest.fixture
def runner(oh_env):
    return GitRunner(hooks_dir=oh_env.settings.ensure_hooks_dir())


@pytest.fixture
def make_repo(oh_env, runner):
    def build(name: str = "src-repo", branch: str = "main") -> Repo:
        path = oh_env.tmp / name
        path.mkdir()
        repo = Repo(path, runner)
        repo.git("init", "-q", "-b", branch)
        repo.commit("README.md", "hello\n", "init")
        return repo

    return build


@pytest.fixture
def repo(make_repo) -> Repo:
    return make_repo()


@pytest.fixture
def marker_bench(tmp_path):
    """A payload command that drops a marker file when git (wrongly) runs it."""
    markers = tmp_path / "markers"
    markers.mkdir()
    script = tmp_path / "payload.py"
    script.write_text(PAYLOAD, encoding="utf-8")

    def command(label: str) -> str:
        return f'"{posix(sys.executable)}" "{posix(script)}" "{posix(markers)}" {label}'

    return SimpleNamespace(dir=markers, command=command, ran=lambda: sorted(p.name for p in markers.iterdir()))


class Outside:
    """A directory outside every managed root that a hostile link points at; it must come out of any test byte for byte as it went in."""

    def __init__(self, path):
        self.path = path
        path.mkdir()
        (path / "secret.txt").write_bytes(b"TOPSECRET\n")
        (path / "victim.txt").write_bytes(b"VICTIM\n")
        (path / "sub").mkdir()
        (path / "sub" / "deep.txt").write_bytes(b"DEEP\n")
        self.before = self.snapshot()

    def snapshot(self) -> dict[str, bytes]:
        return {p.relative_to(self.path).as_posix(): p.read_bytes() for p in sorted(self.path.rglob("*")) if p.is_file()}

    def assert_intact(self) -> None:
        assert self.path.is_dir() and self.snapshot() == self.before


@pytest.fixture
def outside(tmp_path):
    return Outside(tmp_path / "outside-target")


@pytest.fixture
def svc(oh_env, runner):
    return WorkspaceService(oh_env.settings, runner)


@pytest.fixture
def wt(svc, repo, runner):
    """A managed worktree on a new branch, plus a handle to drive git inside it."""
    info = svc.create(str(repo.path), "main", branch="work")
    return info, Repo(Path(info["path"]), runner)
