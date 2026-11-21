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
from pathlib import Path
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


_LOGIN_NAMES = {"claude", "codex", "cursor-agent", "claude.exe", "codex.exe", "cursor-agent.exe", "cursor-agent.cmd"}
_TERMINAL_NAMES = {"wt.exe", "x-terminal-emulator", "xterm"}


def _checked_argv(argv: list[str]) -> list[str]:
    """Refuse anything that is not a known terminal plus one of the three login commands."""
    if len(argv) < 2:
        raise ValueError("refused")
    name = Path(argv[0]).name.lower()
    if name in _TERMINAL_NAMES:
        # terminal, "-e" or the login binary, then the fixed login command
        tail = argv[-2:]
        if Path(tail[0]).name.lower() not in _LOGIN_NAMES or tail[1] != "login":
            raise ValueError("refused")
        return argv
    if name not in _LOGIN_NAMES or argv[1:] != ["login"]:
        raise ValueError("refused")
    return argv


def default_spawner(argv: list[str]) -> int | None:
    """Run the login without reading its output. Prefer an external terminal."""
    command = _checked_argv(_external_terminal(argv) or argv)
    # The executable name is one of a fixed set, and the last argument is the literal "login".
    # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
    proc = subprocess.Popen(  # noqa: S603
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
            # The process has already exited. Nothing it printed is read.
            session.pid = None
    session.running = False
    session.pid = None
    return True
