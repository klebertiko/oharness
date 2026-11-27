"""Start a subscription sign-in in an external terminal. Nothing it prints is kept.

The command is one of three fixed argv lists. The request cannot name a binary,
a flag, or a prompt. The app never reads what it prints, and the secrets store is
never touched. It runs in a directory no run can write to, with the CLI
environment allowlist, never the sidecar's whole environment.
"""
from __future__ import annotations

import os
import secrets
import subprocess
from dataclasses import dataclass
from pathlib import PurePosixPath, PureWindowsPath
from shutil import which
from typing import Callable

from adapters.cli_shared import checked_program, find_cli, inert_cwd, scrub_env

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
# The request never supplies the path: it comes from a PATH lookup of a fixed name, and
# `checked_program` refuses it unless it is absolute, has a known basename and no syntax.
# argv stays literal; the checked path is only ever the program to run, never a word to parse.
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
_TERMINAL_NAMES = {"wt": frozenset({"wt.exe"}), "x-terminal-emulator": frozenset({"x-terminal-emulator"}), "xterm": frozenset({"xterm"})}

# CREATE_NEW_CONSOLE, spelled out because `subprocess` only defines it on Windows.
_NEW_CONSOLE = 0x00000010


@dataclass(frozen=True)
class _Login:
    name: str
    path: str
    # An npm `.cmd` shim on Windows: CreateProcess cannot start it, cmd.exe can.
    shim: bool = False


def _checked_login(argv: list[str]) -> _Login:
    """One of the three login commands, or a refusal. Extra flags are refused."""
    if len(argv) != 2 or argv[1] != "login":
        raise ValueError("refused")
    windows = os.name == "nt"
    path = checked_program(argv[0], frozenset(_LOGIN_NAMES), windows=windows)
    base = PureWindowsPath(path).name.lower() if windows else PurePosixPath(path).name.lower()
    return _Login(name=_LOGIN_NAMES[base], path=path, shim=windows and base.endswith(".cmd"))


def _login_cwd() -> str:
    """A directory no run can write to. cmd.exe searches its own cwd before PATH."""
    return inert_cwd(windows=os.name == "nt")


def _system_cmd() -> str:
    """cmd.exe by absolute path, so the launcher's own search order is not involved either."""
    return str(PureWindowsPath(_login_cwd(), "cmd.exe"))


# A terminal window needs these to appear on a desktop session; none of them is a credential.
_DISPLAY_ENV = ("DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS")


def _login_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """The CLI allowlist, plus the display, plus no current-directory lookup on Windows."""
    added = {key: os.environ[key] for key in _DISPLAY_ENV if os.environ.get(key)}
    added["NoDefaultCurrentDirectoryInExePath"] = "1"
    added.update(extra or {})
    return scrub_env(added)


def _terminal() -> tuple[str, str] | None:
    """Which installed terminal can show the login, and its checked absolute path."""
    if os.name == "nt":
        kinds: tuple[str, ...] = ("wt",)
    elif os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY"):
        kinds = ("x-terminal-emulator", "xterm")
    else:
        return None
    for kind in kinds:
        found = which("wt.exe" if kind == "wt" else kind)
        if not found:
            continue
        try:
            return kind, checked_program(found, _TERMINAL_NAMES[kind], windows=os.name == "nt")
        except ValueError:
            continue
    return None


def _quiet(proc: subprocess.Popen[bytes]) -> int:
    return proc.pid


def _spawn_direct(login: _Login) -> int:
    """The literal command, started from the checked path: no PATH or folder search happens."""
    detached = os.name != "nt"
    if login.name == "claude":
        return _quiet(subprocess.Popen(
            ["claude", "login"], executable=login.path,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if login.name == "codex":
        return _quiet(subprocess.Popen(
            ["codex", "login"], executable=login.path,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    if login.name == "cursor-agent":
        return _quiet(subprocess.Popen(
            ["cursor-agent", "login"], executable=login.path,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=detached, cwd=_login_cwd(), env=_login_env(),
        ))
    raise ValueError("refused")


def _spawn_shim(login: _Login) -> int:
    """cmd.exe gets a fixed line and reads the command from one variable.

    cmd.exe expands ``%OH_LOGIN_COMMAND%`` before it looks at quotes, so the shim
    path is exactly one quoted word, whatever spaces, parentheses or ``@`` it
    holds; the characters that could close the quotes or chain a command were
    refused by `checked_program`. ``/d`` skips AutoRun from the registry,
    ``/v:off`` keeps ``!`` literal, and ``/s`` makes the quote rule fixed. The
    shim gets its own console, so the person can finish signing in there; the
    app never reads it.
    """
    return _quiet(subprocess.Popen(
        ["cmd.exe", "/d", "/v:off", "/s", "/c", "%OH_LOGIN_COMMAND%"],
        executable=_system_cmd(), creationflags=_NEW_CONSOLE,
        cwd=_login_cwd(), env=_login_env({"OH_LOGIN_COMMAND": f'"{login.path}" login'}),
    ))


def _spawn_wt(login: _Login, terminal: str) -> int:
    """A tab may be opened by an already running terminal, with its own directory, so both are absolute."""
    return _quiet(subprocess.Popen(
        ["wt.exe", "-d", _login_cwd(), login.path, "login"], executable=terminal,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=False, cwd=_login_cwd(), env=_login_env(),
    ))


def _spawn_emulator(login: _Login, terminal: str) -> int:
    return _quiet(subprocess.Popen(
        ["x-terminal-emulator", "-e", login.path, "login"], executable=terminal,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, cwd=_login_cwd(), env=_login_env(),
    ))


def _spawn_xterm(login: _Login, terminal: str) -> int:
    return _quiet(subprocess.Popen(
        ["xterm", "-e", login.path, "login"], executable=terminal,
        stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        start_new_session=True, cwd=_login_cwd(), env=_login_env(),
    ))


def default_spawner(argv: list[str]) -> int | None:
    """Run one fixed login command. Its output is never read by the app.

    When this machine has a terminal, that same command is shown there so the
    person can finish signing in.
    """
    login = _checked_login(argv)
    if login.shim:
        return _spawn_shim(login)
    terminal = _terminal()
    if terminal is None:
        return _spawn_direct(login)
    kind, path = terminal
    if kind == "wt":
        return _spawn_wt(login, path)
    if kind == "x-terminal-emulator":
        return _spawn_emulator(login, path)
    return _spawn_xterm(login, path)


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
