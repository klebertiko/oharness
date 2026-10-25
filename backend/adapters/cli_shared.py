"""
Shared subprocess-spawn primitives for CLI-backed adapters (Claude Code, Cursor).

Every CLI adapter rides the vendor's own authenticated session (Claude Pro/Max,
Cursor Pro) instead of a metered API key. The security posture below is what
makes spawning a real subprocess from user-supplied chat text an acceptable
default rather than an open injection surface:

  * argv only, never a shell string — every spawn goes through
    ``asyncio.create_subprocess_exec`` with a literal argv list. Prompt text is
    one argv element; there is no shell to reinterpret quotes, ``&&``, ``|``,
    backticks, or newlines embedded in it.
  * cwd is always one of: a caller-supplied directory that actually exists on
    disk, or a fixed, app-owned default (`default_cli_cwd`). Never the
    sidecar process's own ambient working directory, which callers do not
    control and which could be anywhere.
  * env is rebuilt from an explicit allowlist (`scrub_env`), never passed
    through wholesale — only what a CLI needs to find its own config/session
    (PATH, USERPROFILE/HOME, APPDATA, …). No vendor API keys, no unrelated
    secrets from the sidecar's own environment.
  * every spawn is timeboxed. On timeout or task cancellation the child is
    killed and reaped before the coroutine returns — nothing is left running
    unattended.
"""
from __future__ import annotations

import asyncio
import os
import platform
from dataclasses import dataclass
from pathlib import Path
from shutil import which

# What a CLI needs to locate its own config/session and run at all.
# Deliberately excludes ANTHROPIC_API_KEY, OPENAI_API_KEY, CURSOR_API_KEY, or
# any other vendor credential — the entire point of this path is to ride the
# CLI's own logged-in session, never a metered key pulled from the environment.
_ENV_ALLOWLIST = (
    "PATH",
    "PATHEXT",
    "USERPROFILE",
    "HOMEDRIVE",
    "HOMEPATH",
    "HOME",
    "APPDATA",
    "LOCALAPPDATA",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "SYSTEMROOT",
    "SYSTEMDRIVE",
    "WINDIR",
    "TEMP",
    "TMP",
    "COMSPEC",
    "USERNAME",
    "USER",
    "LANG",
    "LC_ALL",
)
# Windows env-var names are conventionally mixed-case (`SystemRoot`) but the
# OS treats lookups case-insensitively, and `os.environ` on Windows preserves
# whatever casing the process actually has (observed on this machine:
# `SYSTEMROOT`, all caps). Matching case-sensitively against a fixed-case
# allowlist silently drops variables a CLI genuinely needs — confirmed live:
# without SystemRoot, Claude Code's bundled runtime (Bun) refuses to make
# network requests at all. Compare uppercased on both sides instead.
_ENV_ALLOWLIST_UPPER = {k.upper() for k in _ENV_ALLOWLIST}

DEFAULT_TIMEOUT_S = 120.0


def is_windows() -> bool:
    return platform.system() == "Windows"


def scrub_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Rebuild a minimal environment from the allowlist. Never pass the
    sidecar's full environment through — it may carry other providers' API
    keys or unrelated secrets that a spawned CLI has no business seeing."""
    env = {k: v for k, v in os.environ.items() if k.upper() in _ENV_ALLOWLIST_UPPER}
    if extra:
        env.update(extra)
    return env


def default_cli_cwd() -> Path:
    """Fixed, app-owned working directory used when the caller has not pinned
    one to a specific harness/project directory. Never the sidecar process's
    own cwd, which callers do not control."""
    base = Path(os.environ.get("LOCALAPPDATA") or os.environ.get("HOME") or str(Path.home()))
    d = base / "OHarness" / "cli-runs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def resolve_cwd(requested: str | None, *, root: Path | str | None = None) -> Path:
    """A caller may pin cwd via ``AdapterConfig.extra["cwd"]`` — a Cowork
    project's root directory, now that that concept exists upstream
    (``routers/execution.py`` resolves and validates it against the
    ``cowork_projects`` table before it ever reaches here, passing the same
    validated path again as ``extra["cwd_root"]``). It must resolve to a
    real, existing directory *inside* ``root`` — the app-owned CLI-runs tree
    by default, or the caller's validated project root when one was passed —
    anything else, including a path that escapes it via ``..`` or an
    absolute path elsewhere on disk, falls back to the safe default rather
    than silently inheriting an unvalidated path. This is the only place
    that trust decision is made; a caller that skips validation and passes
    an arbitrary ``root`` reopens exactly the gap this check exists to
    close, so only a DB-validated path may ever reach ``root``."""
    if requested:
        base = Path(root) if root else default_cli_cwd()
        try:
            p = Path(requested).resolve()
            if p.is_dir() and p.is_relative_to(base.resolve()):
                return p
        except OSError:
            pass
    return default_cli_cwd()


def find_cli(name: str) -> str | None:
    """`which`-style PATH lookup for a directly-executable binary."""
    return which(name)


def find_cli_script(name: str, ext: str) -> str | None:
    """Manually scan PATH for ``<name><ext>``.

    ``shutil.which`` only resolves extensions listed in ``PATHEXT`` on
    Windows, which does not include ``.ps1`` — even though a ``.ps1`` is the
    real entry point some CLIs install alongside a ``.cmd`` shim (cursor-agent
    ships both). A ``.cmd``/``.bat`` cannot be handed to
    ``asyncio.create_subprocess_exec`` directly (Windows `CreateProcess` needs
    a real PE executable; there is no shell fallback the way
    ``subprocess.run(shell=True)`` gets one), so a caller that finds the
    `.ps1` here is expected to launch it through `powershell.exe -File`.
    """
    for d in os.environ.get("PATH", "").split(os.pathsep):
        if not d:
            continue
        p = Path(d) / f"{name}{ext}"
        if p.is_file():
            return str(p)
    return None


@dataclass
class CliRunResult:
    returncode: int
    stdout: str
    stderr: str
    timed_out: bool = False


async def run_cli(
    argv: list[str],
    *,
    cwd: Path,
    env: dict[str, str],
    timeout: float = DEFAULT_TIMEOUT_S,
    stdin: str | None = None,
) -> CliRunResult:
    """
    Spawn ``argv`` as a subprocess — never through a shell — capture
    stdout/stderr, and enforce a hard timeout. On timeout, or if this
    coroutine itself is cancelled (e.g. the run was stopped mid-node), the
    child (and, on Windows, its whole process tree — see ``_kill``) is
    killed and reaped before returning/raising.

    ``stdin``, when given, is written to the child's stdin instead of the
    prompt ever appearing as an argv element (see SEC-1, harness Security
    Gate 2026-09-11: a prompt string starting with ``-`` is parsed by the
    target CLI as a *flag*, not data — proven exploitable via
    ``claude --settings=<hostile json>`` executing an attacker-chosen shell
    command through Claude Code's own hooks feature). When ``stdin`` is
    None the child's stdin is explicitly closed (DEVNULL), never left to
    inherit the sidecar's own stdin.
    """
    # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-asyncio-create-exec-audit
    # nosemgrep: python.lang.security.audit.dangerous-asyncio-create-exec-audit
    proc = await asyncio.create_subprocess_exec(  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-asyncio-create-exec-audit
        *argv,
        cwd=str(cwd),
        env=env,
        stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        input_bytes = stdin.encode("utf-8") if stdin is not None else None
        out, err = await asyncio.wait_for(proc.communicate(input=input_bytes), timeout=timeout)
        return CliRunResult(
            returncode=proc.returncode if proc.returncode is not None else -1,
            stdout=out.decode("utf-8", "replace"),
            stderr=err.decode("utf-8", "replace"),
        )
    except asyncio.TimeoutError:
        await _kill(proc)
        return CliRunResult(returncode=-1, stdout="", stderr=f"timed out after {timeout}s", timed_out=True)
    except asyncio.CancelledError:
        await _kill(proc)
        raise


async def _kill(proc: "asyncio.subprocess.Process") -> None:
    """Kill the child and, on Windows, its whole descendant tree.

    ``Process.kill()`` alone is ``TerminateProcess`` on the direct child
    only. For the Cursor adapter that direct child is a ``powershell.exe``
    wrapper whose real work happens in a ``node.exe`` grandchild — proven
    live (harness Security Gate, SEC-4, 2026-09-11) to survive a killed
    parent and keep running, unbounded, after this app has given up on the
    timeout. ``taskkill /T /F`` terminates the whole tree; it is a no-op
    with a nonzero exit if the process already exited, which is fine.
    """
    if proc.returncode is not None:
        return
    if is_windows() and proc.pid:
        try:
            killer = await asyncio.create_subprocess_exec(
                "taskkill", "/T", "/F", "/PID", str(proc.pid),
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await asyncio.wait_for(killer.wait(), timeout=5)
        except (OSError, asyncio.TimeoutError):
            pass
    try:
        proc.kill()
    except ProcessLookupError:
        return
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        pass
