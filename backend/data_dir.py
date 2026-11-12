"""The one place that says where OHarness keeps its connections database and its secrets.

The desktop shell hands its sidecar `OH_DATA_DIR`, which is Tauri's `app_local_data_dir`: `<local data>/<bundle identifier>`.
A process the shell did not start (`oharness run --mode live`, `oharness providers ...`) has no shell to ask, so it derives the
same directory from the same identifier. A second, different default is how the CLI once looked at a database the app never wrote.

Scope, stated plainly: this unifies **the connections database (`harness.db`) and the secrets store (`secrets/`)** between the
app and the CLI, nothing more. Other paths still resolve on their own and are tracked separately (the Forja intake database,
the sidecar token file, the workspaces folder, the CLI working directory `cli-runs`).

Safety: every location must be absolute (a relative one would resolve against whatever the current directory happens to be);
a directory this module creates is private to the person (POSIX `0700` from the first instant, a Windows ACL right after
creation, while the directory is still empty); the *default* location is never followed through a symbolic link or junction;
and a failure says what is wrong without echoing the path (it would put a personal folder name into logs and tracebacks).
"""

from __future__ import annotations

import logging
import os
import platform
from collections.abc import Mapping
from pathlib import Path

# Keep equal to `identifier` in src-tauri/tauri.conf.json (tests/test_data_dir.py checks it).
APP_IDENTIFIER = "dev.oharness.app"

_log = logging.getLogger(__name__)


class DataDirError(RuntimeError):
    """The data directory cannot be used. The message never contains the path."""


def _absolute(name: str, value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        raise DataDirError(f"{name} must be an absolute path")
    return path


def _is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def _ensure(path: Path, *, explicit: bool) -> None:
    """Create `path` private to the person when it does not exist; leave an existing folder exactly as it is."""
    from security import sidecar_token  # late: this module must stay importable before the backend package layout is on sys.path

    try:
        if _is_link(path) and not explicit:
            raise DataDirError("the default data directory is a link; refusing to follow it (set OH_DATA_DIR to choose another location)")
        if path.is_dir():
            return
        if path.exists():
            raise DataDirError("the data directory is not a folder")
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            os.mkdir(path, 0o700)  # born private on POSIX: there is no instant at which it is readable by others
        except FileExistsError:
            if path.is_dir() and not (_is_link(path) and not explicit):
                return  # another process made it between our check and our mkdir
            raise DataDirError("the data directory is not a folder") from None
    except DataDirError:
        raise
    except OSError:
        raise DataDirError("the data directory could not be created") from None
    if not sidecar_token.restrict_to_current_user(path):
        # Windows: the folder is empty here and sits under the person's own profile, which is private by default.
        _log.warning("could not restrict the OHarness data directory to the current user; check its permissions")


def resolve_data_dir(
    env: Mapping[str, str] | None = None,
    *,
    system: str | None = None,
    home: Path | None = None,
    create: bool = True,
) -> Path:
    """`OH_DATA_DIR` when set; otherwise the directory the desktop app uses on this platform. Always absolute."""
    env = os.environ if env is None else env
    configured = (env.get("OH_DATA_DIR") or "").strip()
    if configured:
        path, explicit = _absolute("OH_DATA_DIR", configured), True
    else:
        explicit = False
        system = system or platform.system()
        home = home or Path.home()
        if system == "Windows":
            local = (env.get("LOCALAPPDATA") or "").strip()
            base = _absolute("LOCALAPPDATA", local) if local else home / "AppData" / "Local"
        elif system == "Darwin":
            base = home / "Library" / "Application Support"
        else:
            xdg = (env.get("XDG_DATA_HOME") or "").strip()
            base = _absolute("XDG_DATA_HOME", xdg) if xdg else home / ".local" / "share"
        path = base / APP_IDENTIFIER
    if create:
        _ensure(path, explicit=explicit)
    return path
