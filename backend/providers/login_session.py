"""Start a subscription sign-in in an external terminal. Nothing it prints is kept.

The command is one of three fixed argv lists. The request cannot name a binary,
a flag, or a prompt. Stdout and stderr are discarded, and the secrets store is
never touched. It runs in a directory no run can write to, with the CLI
environment allowlist, never the sidecar's whole environment.
"""
from __future__ import annotations

import os
import secrets
import subprocess
from dataclasses import dataclass
from pathlib import PureWindowsPath
from shutil import which
from typing import Callable

from adapters.cli_shared import find_cli, inert_cwd, scrub_env

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
# A sign-in that was cancelled is forgotten; the table never holds more than this.
MAX_SESSIONS = 16


def reset_sessions() -> None:
    _sessions.clear()


def _keep(session: LoginSession) -> None:
    for stale in [key for key, row in _sessions.items() if not row.running]:
        del _sessions[stale]
    while len(_sessions) >= MAX_SESSIONS:
        del _sessions[next(iter(_sessions))]
    _sessions[session.id] = session


# Basename from the installed path -> the literal command that is actually started.
# The request never supplies the path: it comes from a PATH lookup of a fixed name. Only a
# Windows `.cmd` shim is started by that path, after `_checked_shim`; anything else runs the literal.
_LOGIN_NAMES = {
    "claude": "claude",
    "claude.exe": "claude",
    "claude.cmd": "claude",
    "codex": "codex",
    "codex.exe": "codex",
    "codex.cmd": "codex",
    "cursor-agent": "cursor-agent",
    "cursor-agent.exe": "cursor-agent",
    "cursor-agent.cmd": "cursor-agent",
}


@dataclass(frozen=True)
class _Login:
    name: str
    # An npm `.cmd` shim on Windows: CreateProcess cannot start it, `cmd.exe /c` can.
    # cmd.exe gets the shim's absolute path, so it never looks a bare name up anywhere.
    shim: str | None = None


# What cmd.exe (and wt.exe, for `;`) would read as syntax instead of a file name.
_CMD_SYNTAX = frozenset('&|^%!"<>;')


def _checked_shim(path: str) -> str:
    """The absolute `.cmd` path found on PATH, or a refusal. It is never rewritten or escaped."""
    if not PureWindowsPath(path).is_absolute():
        raise ValueError("refused")
    if any(ch in _CMD_SYNTAX or ord(ch) < 32 for ch in path):
        raise ValueError("refused")
    return path


def _checked_login(argv: list[str]) -> _Login:
    """One of the three login commands, or a refusal. Extra flags are refused."""
    if len(argv) != 2 or argv[1] != "login":
        raise ValueError("refused")
    base = PureWindowsPath(argv[0]).name.lower()
    name = _LOGIN_NAMES.get(base)
    if name is None:
        raise ValueError("refused")
    if os.name == "nt" and base.endswith(".cmd"):
        return _Login(name=name, shim=_checked_shim(argv[0]))
    return _Login(name=name)


def _login_cwd() -> str:
    """A directory no run can write to. cmd.exe searches its own cwd before PATH."""
    return inert_cwd(windows=os.name == "nt")


def _system_cmd() -> str:
    """cmd.exe by absolute path, so the launcher's own search order is not involved either."""
    return str(PureWindowsPath(_login_cwd(), "cmd.exe"))


# A terminal window needs these to appear on a desktop session; none of them is a credential.
_DISPLAY_ENV = ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS")


def _login_env() -> dict[str, str]:
    """The CLI allowlist, plus the display, plus no current-directory lookup on Windows."""
    extra = {key: os.environ[key] for key in _DISPLAY_ENV if os.environ.get(key)}
    extra["NoDefaultCurrentDirectoryInExePath"] = "1"
    return scrub_env(extra)


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
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    raise ValueError("refused")


def _spawn_cmd(shim: str) -> int:
    """cmd.exe by absolute path runs the checked shim by absolute path. Only the shim is not a literal."""
    return _quiet(subprocess.Popen(
        ["cmd.exe", "/c", shim, "login"],
        executable=_system_cmd(),
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        cwd=_login_cwd(), env=_login_env(),
    ))


def _spawn_wt(name: str) -> int:
    detached = os.name != "nt"
    if name == "claude":
        return _quiet(subprocess.Popen(
            ["wt.exe", "claude", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["wt.exe", "codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["wt.exe", "cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    raise ValueError("refused")


def _spawn_wt_cmd(shim: str) -> int:
    """A Windows Terminal tab may be opened by an already running terminal with its own
    directory and environment, so the tab's directory, cmd.exe and the shim are all absolute."""
    return _quiet(subprocess.Popen(
        ["wt.exe", "-d", _login_cwd(), _system_cmd(), "/c", shim, "login"],
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        cwd=_login_cwd(), env=_login_env(),
    ))


def _spawn_emulator(name: str) -> int:
    detached = os.name != "nt"
    if name == "claude":
        return _quiet(subprocess.Popen(
            ["x-terminal-emulator", "-e", "claude", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["x-terminal-emulator", "-e", "codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["x-terminal-emulator", "-e", "cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    raise ValueError("refused")


def _spawn_xterm(name: str) -> int:
    detached = os.name != "nt"
    if name == "claude":
        return _quiet(subprocess.Popen(
            ["xterm", "-e", "claude", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "codex":
        return _quiet(subprocess.Popen(
            ["xterm", "-e", "codex", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["xterm", "-e", "cursor-agent", "login"],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    raise ValueError("refused")


def default_spawner(argv: list[str]) -> int | None:
    """Run one fixed login command. Its output is discarded.

    When this machine has a terminal, that same command is shown there so the
    person can finish signing in. The request's path is not the program that runs.
    """
    login = _checked_login(argv)
    kind = _terminal_kind()
    if kind == "wt":
        return _spawn_wt_cmd(login.shim) if login.shim else _spawn_wt(login.name)
    if kind == "x-terminal-emulator":
        return _spawn_emulator(login.name)
    if kind == "xterm":
        return _spawn_xterm(login.name)
    return _spawn_cmd(login.shim) if login.shim else _spawn_direct(login.name)


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
    _keep(session)
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
    _sessions.pop(session_id, None)
    return True
