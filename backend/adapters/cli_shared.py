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
import math
import os
import platform
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from shutil import which
from typing import AsyncIterator

from .base import AdapterResult

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


# ---- failure classes of a subscription CLI (R-PRV-03) ----------------------
# A closed set the run can report without echoing anything the CLI printed (I10).
CLI_SIGNIN = "cli-signin"
CLI_MISSING = "cli-missing"
CLI_TIMEOUT = "cli-timeout"
CLI_USAGE_LIMIT = "usage_limit"
CLI_ERROR = "cli-error"
CLI_FAILURES = (CLI_SIGNIN, CLI_MISSING, CLI_TIMEOUT, CLI_USAGE_LIMIT, CLI_ERROR)

# A model the user typed becomes the value of `--model` in a CLI's argv, so it
# is checked before it gets there: a CLI alias ("sonnet") or a model id
# ("gpt-5.1-codex", "openai/gpt-5", "qwen3:8b"), never a flag, a space or shell text.
CLI_MODEL_MAX_LEN = 128
_CLI_MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]*")
INVALID_CLI_MODEL = (
    "The model name is not valid: use letters, digits, '.', '-', '_', ':' or '/', "
    f"start with a letter or digit, and keep it under {CLI_MODEL_MAX_LEN + 1} characters."
)


def valid_cli_model(model: str) -> bool:
    """True when ``model`` is safe as the value of a CLI's `--model` flag."""
    return 0 < len(model) <= CLI_MODEL_MAX_LEN and _CLI_MODEL.fullmatch(model) is not None


def cli_model_args(model: str) -> list[str]:
    """`--model <model>` for the argv, nothing when empty (the CLI's own default).
    Raises ValueError with fixed text, never echoing what was typed."""
    if not model:
        return []
    if not valid_cli_model(model):
        raise ValueError(INVALID_CLI_MODEL)
    return ["--model", model]


CLI_FAILURE_MESSAGES = {
    CLI_SIGNIN: "The CLI is not signed in. Sign in with the CLI, then retry.",
    CLI_MISSING: "The CLI is not installed on this machine. Install it, then retry.",
    CLI_TIMEOUT: "The CLI did not answer in time. Retry, or check that it is running.",
    CLI_USAGE_LIMIT: "The subscription usage limit was reached. It frees up at the reset time.",
    CLI_ERROR: "The CLI failed to run the request. Check it in Providers and retry.",
}

# A reset instant we stored ourselves. Anything else (free text, an address) is dropped.
_RESET_AT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$")
_MAX_RETRY_S = 14 * 24 * 60 * 60

# Limit phrases only count at the START of a line, same rule as `_SIGNIN_LINE`.
_USAGE_LIMIT_LINE = re.compile(
    r"^\W*(?:error:?\s*)?(?:"
    r"limit reached\b"
    r"|(?:you(?:'ve| have) )?(?:hit|reached) (?:your )?(?:usage |rate )?limit\b"
    r"|usage limit\b"
    r"|out of usage\b"
    r"|rate limit(?:ed)?\b"
    r")",
    re.IGNORECASE | re.MULTILINE,
)
_ISO_IN_LINE = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})")
_CLOCK_IN_LINE = re.compile(r"\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?\b", re.IGNORECASE)


def clean_reset_at(value: object) -> str | None:
    """An ISO reset instant, or None. Never a slice of the text it was read from."""
    if not isinstance(value, str) or not _RESET_AT.fullmatch(value):
        return None
    if "@" in value or any(ch.isspace() for ch in value):
        return None
    return value


def _as_aware(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment


def _iso(moment: datetime) -> str | None:
    return clean_reset_at(_as_aware(moment).isoformat(timespec="seconds"))


def _parse_absolute(token: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(token.replace("Z", "+00:00"))
    except ValueError:
        return None
    return _as_aware(parsed)


def _clock_reset(hour: int, minute: int, second: int, ampm: str | None, now: datetime) -> str | None:
    if ampm:
        if not 1 <= hour <= 12:
            return None
        hour = hour % 12
        if ampm.lower() == "pm":
            hour += 12
    elif not 0 <= hour <= 23:
        return None
    if not 0 <= minute <= 59 or not 0 <= second <= 59:
        return None
    base = _as_aware(now)
    candidate = base.replace(hour=hour, minute=minute, second=second, microsecond=0)
    if candidate <= base:
        candidate += timedelta(days=1)
    return _iso(candidate)


def line_reset_at(line: str, now: datetime | None = None) -> str | None:
    """The reset instant on one line, rebuilt as ISO. No other characters leave the line."""
    return _reset_from_line(line, _as_aware(now or datetime.now().astimezone()))


def _reset_from_line(line: str, now: datetime) -> str | None:
    """The reset instant on this one line, rebuilt as ISO. No other characters leave."""
    absolute = _ISO_IN_LINE.search(line)
    if absolute:
        parsed = _parse_absolute(absolute.group(0))
        if parsed is not None:
            return _iso(parsed)
    clock = _CLOCK_IN_LINE.search(line)
    if not clock:
        return None
    second = int(clock.group(3) or 0)
    return _clock_reset(int(clock.group(1)), int(clock.group(2)), second, clock.group(4), now)


def reset_from_retry_after(value: str | None, *, now: datetime | None = None) -> str | None:
    """HTTP Retry-After (delta-seconds or HTTP-date) as an ISO instant, or None."""
    if not isinstance(value, str):
        return None
    raw = value.strip()
    if not raw or "@" in raw:
        return None
    moment = _as_aware(now or datetime.now().astimezone())
    if raw.isdigit():
        seconds = int(raw)
        if seconds > _MAX_RETRY_S:
            return None
        return _iso(moment + timedelta(seconds=seconds))
    if not _looks_like_http_date(raw):
        return None
    try:
        parsed = parsedate_to_datetime(raw)
    except (TypeError, ValueError, IndexError, OverflowError):
        return None
    if parsed is None:
        return None
    return _iso(parsed)


def _looks_like_http_date(raw: str) -> bool:
    return "," in raw and ":" in raw


@dataclass(frozen=True)
class CliOutcome:
    """Closed class plus, for a usage limit, only the reset instant."""

    failure: str
    reset_at: str | None = None

# Sign-in phrases only count at the START of a line (re.M): the same words in the
# middle of a sentence - a task's own text echoed back - must not flip the class.
_SIGNIN_LINE = re.compile(
    r"^\W*(?:error:?\s*)?(?:"
    r"not (?:logged|signed) in"
    r"|invalid api key"
    r"|authentication (?:required|failed|error)"
    r"|(?:please )?(?:log|sign)[ -]?in (?:again|required)"
    r"|please (?:run|log|sign)"
    r"|session (?:has )?expired"
    r"|(?:token|credentials?) (?:has |have )?(?:expired|invalid|revoked)"
    r"|unauthorized\b"
    r")",
    re.IGNORECASE | re.MULTILINE,
)


def _limit_line(text: str) -> str | None:
    match = _USAGE_LIMIT_LINE.search(text or "")
    if not match:
        return None
    end = text.find("\n", match.start())
    return text[match.start():] if end < 0 else text[match.start():end]


def classify_cli_outcome(*, returncode: int, text: str = "", timed_out: bool = False, now: datetime | None = None) -> CliOutcome:
    """Closed class. ``text`` is only read here. A usage limit also keeps the reset instant and nothing else."""
    if timed_out:
        return CliOutcome(CLI_TIMEOUT)
    if returncode != 0:
        line = _limit_line(text or "")
        if line is not None:
            reset = _reset_from_line(line, _as_aware(now or datetime.now().astimezone()))
            return CliOutcome(CLI_USAGE_LIMIT, reset_at=reset)
        if _SIGNIN_LINE.search(text or ""):
            return CliOutcome(CLI_SIGNIN)
    return CliOutcome(CLI_ERROR)


def classify_cli_failure(*, returncode: int, text: str = "", timed_out: bool = False) -> str:
    """Closed failure class from the exit code plus anchored phrases in ``text``.

    ``text`` is only read here, never returned."""
    return classify_cli_outcome(returncode=returncode, text=text, timed_out=timed_out).failure


def failure_result(*, returncode: int, text: str, fallback_error: str, timed_out: bool = False) -> AdapterResult:
    """An adapter result for a CLI failure. A usage limit keeps the fixed message and the reset instant, never ``text``."""
    outcome = classify_cli_outcome(returncode=returncode, text=text, timed_out=timed_out)
    if outcome.failure == CLI_USAGE_LIMIT:
        return AdapterResult(
            content="",
            error=CLI_FAILURE_MESSAGES[CLI_USAGE_LIMIT],
            failure=CLI_USAGE_LIMIT,
            reset_at=outcome.reset_at or "",
        )
    return AdapterResult(content="", error=fallback_error, failure=outcome.failure)


class CliFailure(RuntimeError):
    """A CLI-backed adapter failed. Carries only the closed class; ``str()`` is a
    fixed message, so nothing the CLI printed can travel with it. ``reset_at`` is
    an ISO instant for a usage limit, or None."""

    def __init__(self, failure: str = CLI_ERROR, *, reset_at: str | None = None) -> None:
        self.failure = failure if failure in CLI_FAILURES else CLI_ERROR
        self.reset_at = clean_reset_at(reset_at) if self.failure == CLI_USAGE_LIMIT else None
        super().__init__(CLI_FAILURE_MESSAGES[self.failure])


class CliMissing(CliFailure, FileNotFoundError):
    """The CLI binary is not on PATH (still a FileNotFoundError for older callers)."""

    def __init__(self) -> None:
        CliFailure.__init__(self, CLI_MISSING)


# No single CLI turn comes near this; a larger figure is a malformed report,
# not a count to charge against the ceiling.
MAX_REPORTED_TOKENS = 10**9


def reported_tokens(usage: object) -> int:
    """Input + output tokens a CLI reported, in snake_case (claude, codex) or
    camelCase (cursor-agent). 0 when nothing usable was reported (not a dict,
    a bool, a string, negative, NaN/Inf, or above ``MAX_REPORTED_TOKENS``): the
    caller then keeps its honest length estimate instead of an invented count."""
    if not isinstance(usage, dict):
        return 0
    total = 0
    for snake, camel in (("input_tokens", "inputTokens"), ("output_tokens", "outputTokens")):
        value = usage.get(snake, usage.get(camel, 0))
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            return 0
        # isfinite only on a float: on a huge int it would itself overflow.
        if isinstance(value, float) and not math.isfinite(value):
            return 0
        if value < 0 or value > MAX_REPORTED_TOKENS:
            return 0
        total += int(value)
    return total if total <= MAX_REPORTED_TOKENS else 0


def reported_model(value: object, fallback: str = "") -> str:
    """The effective model a CLI named, when it is a well-formed model id;
    otherwise the model that was requested (possibly empty). A malformed
    value never travels to events, the ledger or the UI."""
    if isinstance(value, str) and valid_cli_model(value):
        return value
    return fallback or ""


async def completed_result_events(adapter, prompt: str, config) -> AsyncIterator[dict]:
    """`stream_events` for a single-shot CLI: one completed answer, then the
    usage and effective model the CLI itself reported (#418). No usage event
    when the CLI reported no tokens — the engine then marks its count as an
    estimate. A failure raises `CliFailure` with only the closed class."""
    yield {"kind": "phase", "phase": "writing", "detail": config.model or config.adapter}
    result = await adapter.invoke(prompt, config)
    if result.error:
        raise CliFailure(result.failure, reset_at=result.reset_at or None)
    yield {"kind": "text", "text": result.content}
    if result.tokens_used > 0:
        yield {"kind": "usage", "tokens": result.tokens_used, "model": result.model}
