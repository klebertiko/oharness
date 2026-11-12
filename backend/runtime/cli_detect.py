"""Detect which subscription CLIs (Claude, Codex, Cursor) are installed and signed in.

Only ever asks a CLI for its version and its own status command: no prompt, no
credential, an allowlisted environment (``cli_shared.scrub_env``) — so nothing here
spends a token (I5, I7). Raw CLI output never reaches the caller: every ``detail`` is
fixed text per state (no account e-mail, no stderr) and the version is clamped to one
short line. Each CLI answer is read up to ``MAX_OUTPUT_BYTES``.

Contract (``GET /providers/clis``, docs/product/providers-cli-detection.md)::

    {"clis": [{"id": "claude|codex|cursor", "provider": "anthropic|openai|cursor",
               "installed": bool, "loggedIn": bool, "version": str,
               "state": "ready|not-logged-in|not-installed|unavailable|error",
               "detail": str}]}
"""

from __future__ import annotations

import asyncio
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
VERSION_MAX_CHARS = 80
MAX_OUTPUT_BYTES = 64 * 1024

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


def _capped(runner: Callable[..., Any]) -> Callable[..., Any]:
    """Read at most MAX_OUTPUT_BYTES of what a CLI printed, without touching run_cli."""

    async def run(*args: Any, **kwargs: Any) -> CliRunResult:
        result: CliRunResult = await runner(*args, **kwargs)
        return CliRunResult(
            returncode=result.returncode,
            stdout=result.stdout[:MAX_OUTPUT_BYTES],
            stderr=result.stderr[:MAX_OUTPUT_BYTES],
            timed_out=result.timed_out,
        )

    return run


def _one_line(text: str) -> str:
    for line in text.splitlines():
        line = line.strip()
        if line:
            return line[:VERSION_MAX_CHARS]
    return ""


async def _version(adapter: Any, runner: Callable[..., Any]) -> str:
    prefix = adapter.cli_argv_prefix()
    if not prefix:
        return ""
    result = await runner(
        [*prefix, "--version"], cwd=resolve_cwd(None), env=scrub_env(), timeout=VERSION_TIMEOUT_S,
    )
    if result.timed_out or result.returncode != 0:
        return ""
    return _one_line(result.stdout or result.stderr)


async def _detect_one(cli: str, provider: str, cls: type[AgentAdapter], runner: Callable[..., Any]) -> dict:
    adapter = cls(runner=runner)  # type: ignore[call-arg]
    config = AdapterConfig(adapter=cli, model="")
    probe: ProbeResult = await adapter.probe(config)
    # Installed means "the binary resolves", decided by the adapter's own lookup — not by
    # the probe code, which a platform gate can set before any lookup happened.
    installed = bool(adapter.cli_argv_prefix())  # type: ignore[attr-defined]
    state = "ready" if probe.ok else _STATE_BY_CODE.get(probe.code, "error")
    # A closed platform gate (SEC-6, SEC-2) runs nothing, not even `--version`.
    version = await _version(adapter, runner) if installed and state != "unavailable" else ""
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


async def detect_clis(runner: Callable[..., Any] = run_cli) -> list[dict]:
    capped = _capped(runner)
    return list(await asyncio.gather(*(_detect_one(c, p, k, capped) for c, p, k in DETECTED)))
