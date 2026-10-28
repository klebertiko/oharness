"""Where the Workspace Manager keeps its data. Read from the environment on every use, never cached."""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from .errors import WorkspaceError

HOME_ENV = "OH_WORKSPACES_HOME"


@dataclass(frozen=True)
class Settings:
    """``home`` holds everything: the managed worktree root, the state file, an always-empty hooks directory and scratch space.

    It is the app's own data directory (next to the sidecar token and the CLI-runs directory), never a path a request supplies.
    """

    home: Path

    @classmethod
    def from_env(cls) -> "Settings":
        override = os.environ.get(HOME_ENV)
        if override:
            home = Path(override)
            if not home.is_absolute():
                raise WorkspaceError("invalid_configuration", f"{HOME_ENV} must be an absolute path", 500)
        else:
            base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.home()))
            home = base / "OpenHarness" / "workspaces"
        return cls(home=home)

    @property
    def managed_root(self) -> Path:
        return self.home / "worktrees"

    @property
    def state_path(self) -> Path:
        return self.home / "state.json"

    @property
    def hooks_dir(self) -> Path:
        return self.home / "empty-hooks"

    @property
    def tmp_dir(self) -> Path:
        return self.home / "tmp"

    def ensure_hooks_dir(self) -> Path:
        """A directory that must stay empty: ``core.hooksPath`` points at it so no repository hook can run."""
        self.hooks_dir.mkdir(parents=True, exist_ok=True)
        if any(self.hooks_dir.iterdir()):
            raise WorkspaceError("unsafe_configuration", "the empty hooks directory is not empty", 500)
        return self.hooks_dir
