"""Start a subscription sign-in in an external terminal. Nothing it prints is kept.

The command is one of three fixed argv lists. The request cannot name a binary,
a flag, or a prompt. Stdout and stderr are discarded, and the secrets store is
never touched.
"""
from __future__ import annotations

import os
import secrets
import subprocess
from dataclasses import dataclass
from shutil import which
from typing import Callable

from adapters.cli_shared import find_cli

# cli id -> (binary name, fixed args). Never built from request text.
LOGIN_ARGV: dict[str, tuple[str, ...]] = {
    "claude": ("claude", "login"),
    "codex": ("codex", "login"),
    "cursor": ("cursor-agent", "login"),
}

Finder = Callable[[str], str | None]
Spawner = Callable[[list[str]], int | None]


@dataclass
class LoginSession:
    id: str
    cli: str
    pid: int | None
    running: bool


_sessions: dict[str, LoginSession] = {}


def reset_sessions() -> None:
    _sessions.clear()


def _external_terminal(argv: list[str]) -> list[str] | None:
    """A new terminal window for the login, when this machine has one. No shell string."""
    if os.name == "nt":
        wt = which("wt.exe")
        if wt:
            return [wt, *argv]
        return None
    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        return None
    term = which("x-terminal-emulator") or which("xterm")
    if not term:
        return None
    return [term, "-e", *argv]


def default_spawner(argv: list[str]) -> int | None:
    """Run the login without reading its output. Prefer an external terminal."""
    command = _external_terminal(argv) or argv
    proc = subprocess.Popen(  # noqa: S603 — argv is an allowlisted binary plus fixed args
        command,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )
    return proc.pid


def start_login(cli_id: str, *, finder: Finder = find_cli, spawner: Spawner = default_spawner) -> dict:
    spec = LOGIN_ARGV.get(cli_id)
    if spec is None:
        raise KeyError(cli_id)
    binary, *args = spec
    path = finder(binary)
    if not path:
        return {"ok": False, "reason": "not-installed"}
    pid = spawner([path, *args])
    session = LoginSession(id=secrets.token_hex(8), cli=cli_id, pid=pid, running=True)
    _sessions[session.id] = session
    return {"ok": True, "id": session.id, "cli": cli_id, "running": True}


def cancel_login(session_id: str) -> bool:
    session = _sessions.get(session_id)
    if session is None:
        return False
    if session.pid:
        try:
            os.kill(session.pid, 15)
        except OSError:
            pass
    session.running = False
    session.pid = None
    return True
