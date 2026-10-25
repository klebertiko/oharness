"""
Local-process auth for the FastAPI sidecar.

SEC-3 (harness Security Gate, 2026-09-11): the sidecar bound to 127.0.0.1 and
CORS excluding "null" close the *remote* vector (any website, any browser tab
— proven exploitable before that fix via `Origin: null`). What neither of
those closes is a *local* one: any other process running as this Windows
user can still call the sidecar's mutating routes with no credential at all,
because loopback binding restricts *where from*, never *who*.

This module is the local answer: a random token, generated once and
persisted to a file only this user account can read, required on every
mutating request via `Authorization: Bearer <token>`. A page in a browser —
even one somehow running as this user — cannot read that file; only a
process with real filesystem access can, which is the same bar the CLI
adapters already assume for cwd/env (see adapters/cli_shared.py).

**What this does not yet cover, by design, not oversight:** the packaged
desktop build does not yet spawn this sidecar as a Tauri-managed child
process — src-tauri/tauri.conf.json currently has no `externalBin` (removed
earlier this session: "no packaged sidecar binary exists yet"). The intended
production shape is for Tauri's Rust side to generate this token, pass it to
the sidecar as an environment variable at spawn time, and inject it into the
webview the same way `window.__OH_API__` already is (see
frontend/src/lib/apiBase.ts). Until that integration exists, this module
persists the token to a file instead — good enough to close the local vector
in dev, but the file-based handoff below (`frontend/src/app/api/
sidecar-token/route.ts`, a same-origin Next server route) is a dev-only
bridge, not the production design. Revisit when the sidecar is actually
packaged.
"""

from __future__ import annotations

import os
import platform
import secrets
import subprocess
from pathlib import Path

TOKEN_HEADER = "authorization"
TOKEN_ENV_VAR = "OH_SIDECAR_TOKEN"


def _token_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.home()))
    d = base / "OHarness"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _token_path() -> Path:
    return _token_dir() / "sidecar.token"


def _restrict_to_current_user(path: Path) -> None:
    """Best-effort: strip access for anyone but the current account.

    Not a hard guarantee (a local admin can always override ACLs/chmod —
    that is true of any secret-on-disk scheme, including this app's own
    FileSecrets store), but it raises the bar past "any process that can
    open a file this user's shell can also open."
    """
    if platform.system() == "Windows":
        try:
            subprocess.run(
                ["icacls", str(path), "/inheritance:r", "/grant:r", f"{os.environ.get('USERNAME', '')}:F"],
                capture_output=True,
                timeout=5,
                check=False,
            )
        except (OSError, subprocess.SubprocessError):
            pass
    else:
        try:
            os.chmod(path, 0o600)
        except OSError:
            pass


def get_or_create_token() -> str:
    """The sidecar's own auth secret for this run.

    ``OH_SIDECAR_TOKEN`` in the environment wins when set — that is the seam
    a real Tauri-spawns-sidecar integration would use (env var at spawn
    time, never touching disk). Otherwise, generate once and persist to a
    user-restricted file so the token survives a sidecar restart without
    invalidating whatever the frontend has already cached.
    """
    env_token = os.environ.get(TOKEN_ENV_VAR, "").strip()
    if env_token:
        return env_token

    path = _token_path()
    if path.is_file():
        existing = path.read_text(encoding="utf-8").strip()
        if existing:
            return existing

    token = secrets.token_urlsafe(32)
    path.write_text(token, encoding="utf-8")
    _restrict_to_current_user(path)
    return token
