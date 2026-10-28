"""Managed worktree root: the server builds every destination, and proves it stays inside the root.

A client never supplies a destination. A worktree lives at ``<managed root>/<repo dir>/<workspace id>`` where the repo dir is
derived from the source repository's identity and the id is generated here. This module is the check that makes that claim
true on a hostile disk: no link (symlink or junction) between the root and the destination, no UNC/device roots, no Windows
device names or illegal characters in any component, and a length bound.
"""
from __future__ import annotations

import hashlib
import os
import re
import secrets
from pathlib import Path

from .errors import WorkspaceError

MAX_DESTINATION = 220
_ID = re.compile(r"^ws-[0-9a-f]{16}$")
_DEVICE = re.compile(r"^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$", re.IGNORECASE)
_ILLEGAL = set('<>:"/\\|?*')


def new_workspace_id() -> str:
    return "ws-" + secrets.token_hex(8)


def valid_workspace_id(value: object) -> bool:
    return isinstance(value, str) and bool(_ID.match(value))


def canonical(path: Path | str) -> str:
    """Comparable form of a path: resolved, case-folded where the platform is case-insensitive."""
    return os.path.normcase(os.path.realpath(os.fspath(path)))


def repo_dir_name(common_dir: Path) -> str:
    """``<readable name>-<hash>``: stable per repository, never a bare user-chosen name (so never ``CON``, never colliding)."""
    base = common_dir.parent.name if common_dir.name == ".git" else common_dir.name
    readable = re.sub(r"[^A-Za-z0-9_.-]", "-", base).strip(".-")[:32] or "repo"
    return f"{readable}-{hashlib.sha256(canonical(common_dir).encode('utf-8')).hexdigest()[:10]}"


def is_link(path: Path | str) -> bool:
    isjunction = getattr(os.path, "isjunction", None)
    return os.path.islink(path) or bool(isjunction and isjunction(path))


def _unsafe(message: str) -> WorkspaceError:
    return WorkspaceError("unsafe_destination", message, 409)


def _check_component(name: str) -> None:
    if (not name or name in {".", ".."} or len(name) > 100 or name != name.strip(" ") or name.endswith(".")
            or any(ch in _ILLEGAL or ord(ch) < 0x20 for ch in name) or _DEVICE.match(name)):
        raise _unsafe(f"unsafe directory name: {name!r}")


class ManagedRoot:
    def __init__(self, path: Path | str):
        raw = os.fspath(path)
        if raw.startswith(("\\\\", "//")):
            raise _unsafe("UNC and device paths cannot be a managed root")
        self.path = Path(os.path.realpath(raw))

    @classmethod
    def from_path(cls, raw: Path | str) -> "ManagedRoot":
        root = cls(raw)
        root.path.mkdir(parents=True, exist_ok=True)
        return root

    def _expected_child(self, name: str) -> str:
        return canonical(self.path) + os.sep + os.path.normcase(name)

    def destination(self, repo_dir: str, workspace_id: str) -> Path:
        """The directory a new worktree would use. Raises unless every guarantee holds; creates nothing."""
        _check_component(repo_dir)
        if not valid_workspace_id(workspace_id):
            raise _unsafe("workspace id is not a generated id")
        repo_path = self.path / repo_dir
        dest = repo_path / workspace_id
        if len(os.fspath(dest)) > MAX_DESTINATION:
            raise _unsafe("destination path is too long")
        if os.path.lexists(repo_path):
            if is_link(repo_path) or not repo_path.is_dir() or canonical(repo_path) != self._expected_child(repo_dir):
                raise _unsafe("a link or non-directory sits between the managed root and the destination")
        if os.path.lexists(dest):
            raise WorkspaceError("id_collision", "a workspace with this id already exists", 409)
        return dest

    def prepare(self, dest: Path) -> bool:
        """Create the repo directory under the root (if missing), re-checking links; True when it was created here."""
        parent = dest.parent
        created = not os.path.lexists(parent)
        self.path.mkdir(parents=True, exist_ok=True)
        parent.mkdir(exist_ok=True)
        if is_link(parent) or canonical(parent) != self._expected_child(parent.name):
            raise _unsafe("a link appeared between the managed root and the destination")
        return created

    def owns(self, path: Path | str) -> bool:
        """True when ``path`` is strictly inside the root (after resolving links)."""
        root, target = canonical(self.path), canonical(path)
        return target != root and target.startswith(root + os.sep)
