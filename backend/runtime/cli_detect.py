"""Detect which subscription CLIs (Claude, Codex, Cursor) are installed and signed in.

Only ever asks a CLI for its version and its own status command: no prompt, no
credential, an allowlisted environment (``cli_shared.scrub_env``) — so nothing here
spends a token (I5, I7). Raw CLI output never reaches the caller: every ``detail`` is
fixed text per state (no account e-mail, no stderr) and the version is clamped to one
short, strictly shaped line read from stdout only. What enters the analysis of each CLI
answer is cut at ``MAX_ANSWER_BYTES`` (a bound on the response, not on the memory the
CLI run itself uses — see issue #455).

Contract (``GET /providers/clis``, docs/product/providers-cli-detection.md)::

    {"clis": [{"id": "claude|codex|cursor", "provider": "anthropic|openai|cursor",
               "installed": bool, "loggedIn": bool, "version": str | null,
               "state": "ready|not-logged-in|not-installed|unavailable|error",
               "detail": str}]}
"""

from __future__ import annotations

import asyncio
from pathlib import Path
import re
from typing import Any, Callable

from adapters.base import AdapterConfig, AgentAdapter, ProbeResult
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_codex import CodexCliAdapter
from adapters.cli_cursor import CursorCliAdapter
from adapters.cli_shared import CliRunResult, resolve_cwd, run_cli, scrub_env

# (cli id, provider id, adapter class) — provider ids are the catalog's credential.kind=cli ones.
DETECTED: tuple[tuple[str, str, type[AgentAdapter]], ...] = (
    ("claude", "anthropic", ClaudeCliAdapter),
    ("codex", "openai", CodexCliAdapter),
    ("cursor", "cursor", CursorCliAdapter),
)

VERSION_TIMEOUT_S = 10
MAX_ANSWER_BYTES = 64 * 1024
# A version is one short token line: letters, digits and . _ + ( ) - and spaces. No @, :, control
# or bidi characters, so an e-mail or terminal escape printed next to it cannot pass as one.
_VERSION_LINE = re.compile(r"[A-Za-z0-9][A-Za-z0-9.+_() -]{0,79}")

_STATE_BY_CODE = {
    "not_installed": "not-installed",
    "not_logged_in": "not-logged-in",
    "platform_unsupported": "unavailable",
}
_FIXED_DETAIL = {
    "ready": "Signed in.",
    "not-logged-in": "Installed, but not signed in. Sign in with the CLI.",
    "not-installed": "Not installed on this machine.",
    "unavailable": "Not available on this platform.",
    "error": "Could not read the CLI status.",
}


def _cut(text: str) -> str:
    raw = text.encode("utf-8", "replace")
    if len(raw) <= MAX_ANSWER_BYTES:
        return text
    return raw[:MAX_ANSWER_BYTES].decode("utf-8", "ignore")


def _bounded_answer(runner: Callable[..., Any]) -> Callable[..., Any]:
    """Cut what a CLI printed to MAX_ANSWER_BYTES before it is analysed. ``run_cli`` has
    already buffered all of it by then; limiting that is issue #455."""

    async def run(*args: Any, **kwargs: Any) -> CliRunResult:
        result: CliRunResult = await runner(*args, **kwargs)
        return CliRunResult(
            returncode=result.returncode,
            stdout=_cut(result.stdout),
            stderr=_cut(result.stderr),
            timed_out=result.timed_out,
        )

    return run


def _version_line(stdout: str) -> str | None:
    """The first non-empty stdout line if, and only if, it looks like a version; else None."""
    for line in stdout.splitlines():
        line = line.strip()
        if line:
            ok = _VERSION_LINE.fullmatch(line) and any(c.isdigit() for c in line) and "@" not in line
            return line if ok else None
    return None


def _cwd(cwd: Path | None) -> Path:
    """The working directory a detection command runs in: the app's own (made on first use) unless the caller names one that already exists."""
    return resolve_cwd(str(cwd), root=cwd) if cwd else resolve_cwd(None)


async def _version(adapter: Any, runner: Callable[..., Any], cwd: Path | None = None) -> str | None:
    prefix = adapter.cli_argv_prefix()
    if not prefix:
        return None
    result = await runner(
        [*prefix, "--version"], cwd=_cwd(cwd), env=scrub_env(), timeout=VERSION_TIMEOUT_S,
    )
    if result.timed_out or result.returncode != 0:
        return None
    return _version_line(result.stdout)


async def _detect_one(cli: str, provider: str, cls: type[AgentAdapter], runner: Callable[..., Any], cwd: Path | None = None) -> dict:
    adapter = cls(runner=runner)  # type: ignore[call-arg]
    config = AdapterConfig(adapter=cli, model="", extra={"cwd": str(cwd), "cwd_root": str(cwd)} if cwd else {})
    probe: ProbeResult = await adapter.probe(config)
    # Installed means "the binary resolves", decided by the adapter's own lookup — not by
    # the probe code, which a platform gate can set before any lookup happened.
    installed = bool(adapter.cli_argv_prefix())  # type: ignore[attr-defined]
    state = "ready" if probe.ok else _STATE_BY_CODE.get(probe.code, "error")
    # A closed platform gate (SEC-6, SEC-2) runs nothing, not even `--version`.
    version = await _version(adapter, runner, cwd) if installed and state != "unavailable" else None
    detail = _FIXED_DETAIL[state]
    return {
        "id": cli,
        "provider": provider,
        "installed": installed,
        "loggedIn": probe.ok,
        "version": version,
        "state": state,
        "detail": detail,
    }


async def detect_clis(runner: Callable[..., Any] = run_cli, *, cwd: Path | None = None) -> list[dict]:
    """`cwd`: a directory that already exists to run the detection commands in (a look-only caller such as `oharness doctor`); the default is the app's own."""
    if cwd is not None and not Path(cwd).is_dir():  # never fall back to the app's own (it would be created): a look-only caller made a promise (#499)
        raise FileNotFoundError("the detection working directory does not exist")
    capped = _bounded_answer(runner)
    return list(await asyncio.gather(*(_detect_one(c, p, k, capped, cwd) for c, p, k in DETECTED)))
