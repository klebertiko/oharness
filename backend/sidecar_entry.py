"""Packaged OHarness sidecar entry point.

The desktop shell supplies a loopback port and per-process bearer token. User
data lives under LOCALAPPDATA instead of the read-only installation directory.
"""

from __future__ import annotations

import os
from pathlib import Path


def _data_dir() -> Path:
    configured = os.environ.get("OH_DATA_DIR")
    path = Path(configured) if configured else Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "OHarness"
    path.mkdir(parents=True, exist_ok=True)
    return path


def configure_environment() -> int:
    data = _data_dir()
    os.environ.setdefault("DATABASE_URL", f"sqlite+aiosqlite:///{(data / 'harness.db').as_posix()}")
    os.environ.setdefault("OH_SECRETS", "file")
    os.environ.setdefault("OH_SECRETS_DIR", str(data / "secrets"))
    return int(os.environ.get("OH_PORT", "8000"))


def main() -> None:
    port = configure_environment()
    import uvicorn
    # Configure persistence before importing the app. The direct import also
    # makes the complete FastAPI application visible to PyInstaller.
    from main import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
