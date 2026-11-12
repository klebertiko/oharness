"""The one place that says where OHarness keeps its data (connections database, secrets).

The desktop shell hands its sidecar `OH_DATA_DIR`, which is Tauri's `app_local_data_dir`: `<local data>/<bundle identifier>`.
A process the shell did not start (`oharness run --mode live`, `oharness providers ...`) has no shell to ask, so it derives the
same directory from the same identifier. A second, different default is how the CLI once looked at a database the app never wrote.
"""

from __future__ import annotations

import os
import platform
from collections.abc import Mapping
from pathlib import Path

# Keep equal to `identifier` in src-tauri/tauri.conf.json (tests/test_data_dir.py checks it).
APP_IDENTIFIER = "dev.oharness.app"


def resolve_data_dir(
    env: Mapping[str, str] | None = None,
    *,
    system: str | None = None,
    home: Path | None = None,
    create: bool = True,
) -> Path:
    """`OH_DATA_DIR` when set; otherwise the directory the desktop app uses on this platform."""
    env = os.environ if env is None else env
    configured = (env.get("OH_DATA_DIR") or "").strip()
    if configured:
        path = Path(configured)
    else:
        system = system or platform.system()
        home = home or Path.home()
        if system == "Windows":
            base = Path(env.get("LOCALAPPDATA") or home / "AppData" / "Local")
        elif system == "Darwin":
            base = home / "Library" / "Application Support"
        else:
            base = Path(env.get("XDG_DATA_HOME") or home / ".local" / "share")
        path = base / APP_IDENTIFIER
    if create:
        path.mkdir(parents=True, exist_ok=True)
    return path
