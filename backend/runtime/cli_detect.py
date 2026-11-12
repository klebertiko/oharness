"""Detect which subscription CLIs (Claude, Codex, Cursor) are installed and signed in.

Only ever asks a CLI for its version and its own status command: no prompt, no
credential, an allowlisted environment (``cli_shared.scrub_env``) — so nothing here
spends a token (I5, I7). Raw CLI output never reaches the caller: errors map to fixed
messages and the version is clamped to one short line.
"""

from __future__ import annotations

import asyncio
from typing import Any, Callable

from adapters.base import AdapterConfig, AgentAdapter, ProbeResult
from adapters.cli_claude import ClaudeCliAdapter
from adapters.cli_codex import CodexCliAdapter
from adapters.cli_cursor import CursorCliAdapter
from adapters.cli_shared import resolve_cwd, run_cli, scrub_env

# (cli id, provider id, adapter class) — provider ids are the catalog's credential.kind=cli ones.
DETECTED: tuple[tuple[str, str, type[AgentAdapter]], ...] = (
    ("claude", "anthropic", ClaudeCliAdapter),
    ("codex", "openai", CodexCliAdapter),
    ("cursor", "cursor", CursorCliAdapter),
)

VERSION_TIMEOUT_S = 10
VERSION_MAX_CHARS = 80

_STATE_BY_CODE = {
    "not_installed": "not-installed",
    "not_logged_in": "not-logged-in",
    "platform_unsupported": "unavailable",
}
_FIXED_DETAIL = {
    "not-installed": "Not installed on this machine.",
    "unavailable": "Not available on this platform.",
    "error": "Could not read the CLI status.",
}


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
    installed = probe.code != "not_installed"
    if probe.ok:
        state = "ready"
    else:
        state = _STATE_BY_CODE.get(probe.code, "error")
    version = await _version(adapter, runner) if installed else ""
    detail = probe.detail if state in ("ready", "not-logged-in") else _FIXED_DETAIL[state]
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
    return list(await asyncio.gather(*(_detect_one(c, p, k, runner) for c, p, k in DETECTED)))
