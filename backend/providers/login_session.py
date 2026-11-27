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


# Basename from the installed path -> the literal command that is actually started.
# The path passed in is never executed, so a request cannot choose a binary.
_LOGIN_NAMES = {
    "claude": "claude",
    "claude.exe": "claude",
    "codex": "codex",
    "codex.exe": "codex",
    "cursor-agent": "cursor-agent",
    "cursor-agent.exe": "cursor-agent",
    "cursor-agent.cmd": "cursor-agent",
}


def _checked_login(argv: list[str]) -> str:
    """One of the three login commands, or a refusal. Extra flags are refused."""
    if len(argv) != 2 or argv[1] != "login":
        raise ValueError("refused")
    name = _LOGIN_NAMES.get(Path(argv[0]).name.lower())
    if name is None:
        raise ValueError("refused")
    return name


def _terminal_kind() -> str | None:
    """Which installed terminal can show the login, if this machine has a display."""
    if os.name == "nt":
        return "wt" if which("wt.exe") else None
    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        return None
    if which("x-terminal-emulator"):
        return "x-terminal-emulator"
    if which("xterm"):
        return "xterm"
    return None


def _quiet(proc: subprocess.Popen[bytes]) -> int:
    return proc.pid


def _spawn_direct(name: str) -> int:
    """Each call lists its own argv. Nothing here is assembled from the request."""
    detached = os.name != "nt"
    if name == "claude":
        return _quiet(subprocess.Popen(
            ["claude", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    raise ValueError("refused")


def _spawn_wt(name: str) -> int:
    detached = os.name != "nt"
    if name == "claude":
        return _quiet(subprocess.Popen(
            ["wt.exe", "claude", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["wt.exe", "codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["wt.exe", "cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    raise ValueError("refused")


def _spawn_emulator(name: str) -> int:
    detached = os.name != "nt"
    if name == "claude":
        return _quiet(subprocess.Popen(
            ["x-terminal-emulator", "-e", "claude", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["x-terminal-emulator", "-e", "codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["x-terminal-emulator", "-e", "cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    raise ValueError("refused")


def _spawn_xterm(name: str) -> int:
    detached = os.name != "nt"
    if name == "claude":
        return _quiet(subprocess.Popen(
            ["xterm", "-e", "claude", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["xterm", "-e", "codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["xterm", "-e", "cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached,
        ))
    raise ValueError("refused")


def default_spawner(argv: list[str]) -> int | None:
    """Run one fixed login command. Its output is discarded.

    When this machine has a terminal, that same command is shown there so the
    person can finish signing in. The request's path is not the program that runs.
    """
    name = _checked_login(argv)
    kind = _terminal_kind()
    if kind == "wt":
        return _spawn_wt(name)
    if kind == "x-terminal-emulator":
        return _spawn_emulator(name)
    if kind == "xterm":
        return _spawn_xterm(name)
    return _spawn_direct(name)


def start_login(cli_id: str, *, finder: Finder = find_cli, spawner: Spawner = default_spawner) -> dict:
    spec = LOGIN_ARGV.get(cli_id)
    if spec is None:
        raise KeyError(cli_id)
    binary, *args = spec
    path = finder(binary)
    if not path:
        return {"ok": False, "reason": "not-installed"}
    try:
        pid = spawner([path, *args])
    except (ValueError, OSError):
        # A shim the launcher refuses, or a program that did not start. The reason stays closed.
        return {"ok": False, "reason": "not-started"}
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
