"""Subscription usage windows. Only a percent and a reset instant leave the text."""
from __future__ import annotations

import asyncio
import json
import re
from datetime import datetime, timezone

from adapters.cli_shared import _kill, find_cli, line_reset_at, scrub_env

_PCT = re.compile(
    r"(?P<label>5[\s-]*hour|five[\s-]*hour|weekly|week)\s+usage:\s*(?P<pct>\d{1,3})%\s*(?P<left>left)?",
    re.IGNORECASE,
)


def _window(used: int | None, remaining: int | None, reset: str | None) -> dict | None:
    pct = used if used is not None else (100 - remaining if remaining is not None else None)
    if pct is None or not 0 <= pct <= 100:
        return None
    row: dict = {"usedPct": pct}
    if reset:
        row["resetsAt"] = reset
    return row


def _from_json(payload: object, now: datetime) -> dict | None:
    if not isinstance(payload, dict):
        return None
    out: dict = {}
    for src, dest in (("fiveHour", "fiveHour"), ("five_hour", "fiveHour"), ("weekly", "weekly")):
        block = payload.get(src)
        if not isinstance(block, dict):
            continue
        used = block.get("usedPct", block.get("used_pct"))
        remaining = block.get("remainingPct", block.get("remaining_pct"))
        reset_raw = block.get("resetsAt", block.get("resets_at"))
        reset = reset_raw if isinstance(reset_raw, str) else None
        if isinstance(reset, str):
            reset = line_reset_at(reset, now) or (reset if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})", reset) else None)
        if isinstance(used, bool) or (used is not None and not isinstance(used, (int, float))):
            used = None
        if isinstance(remaining, bool) or (remaining is not None and not isinstance(remaining, (int, float))):
            remaining = None
        window = _window(int(used) if used is not None else None, int(remaining) if remaining is not None else None, reset)
        if window:
            out[dest] = window
    return out or None


def _from_lines(text: str, now: datetime) -> dict | None:
    found: dict[str, dict] = {}
    reset = None
    for line in text.splitlines():
        instant = line_reset_at(line, now)
        if instant and reset is None:
            reset = instant
        match = _PCT.match(line.strip())
        if not match:
            continue
        label = match.group("label").lower()
        key = "fiveHour" if "hour" in label else "weekly"
        pct = int(match.group("pct"))
        window = _window(None if match.group("left") else pct, pct if match.group("left") else None, instant)
        if window:
            found[key] = window
    if reset:
        for window in found.values():
            window.setdefault("resetsAt", reset)
    return found or None


def parse_usage_windows(text: str, *, now: datetime | None = None) -> dict:
    """Closed windows, or ``available: false``. The source text is not returned."""
    moment = now or datetime.now().astimezone()
    parsed = None
    stripped = (text or "").strip()
    if stripped.startswith("{"):
        try:
            parsed = _from_json(json.loads(stripped), moment)
        except json.JSONDecodeError:
            parsed = None
    if parsed is None:
        parsed = _from_lines(text or "", moment)
    if not parsed:
        return {"available": False}
    return {"available": True, **parsed}


# ── Codex: the app-server answers `account/rateLimits/read` with the two windows ──
# primary is the 300-minute window, secondary the 10080-minute (weekly) one. Only
# the percent and the reset instant leave this module; the account id, plan and
# credits in the same reply are dropped here.
_WINDOW_BY_MINUTES = {300: "fiveHour", 10080: "weekly"}
CODEX_READ_TIMEOUT_S = 15.0
_MAX_LINE = 256 * 1024
_HANDSHAKE = (
    {"method": "initialize", "id": 0, "params": {"clientInfo": {"name": "oharness", "title": "OpenHarness", "version": "0"}}},
    {"method": "initialized", "params": {}},
    {"method": "account/rateLimits/read", "id": 1},
)


def _codex_window(raw: object) -> tuple[str, dict] | None:
    if not isinstance(raw, dict):
        return None
    minutes, used, reset = raw.get("windowDurationMins"), raw.get("usedPercent"), raw.get("resetsAt")
    key = _WINDOW_BY_MINUTES.get(minutes) if isinstance(minutes, int) and not isinstance(minutes, bool) else None
    if key is None or isinstance(used, bool) or not isinstance(used, (int, float)) or not 0 <= used <= 100:
        return None
    row: dict = {"usedPct": int(round(used))}
    if isinstance(reset, int) and not isinstance(reset, bool) and 0 < reset < 4_102_444_800:
        row["resetsAt"] = datetime.fromtimestamp(reset, timezone.utc).isoformat(timespec="seconds")
    return key, row


def windows_from_rate_limits(result: object) -> dict:
    """The two windows from an app-server reply, or ``unreadable``. Nothing else is copied."""
    limits = result.get("rateLimits") if isinstance(result, dict) else None
    found: dict[str, dict] = {}
    if isinstance(limits, dict):
        for slot in ("primary", "secondary"):
            window = _codex_window(limits.get(slot))
            if window:
                found.setdefault(window[0], window[1])
    if not found:
        return {"available": False, "reason": "unreadable"}
    return {"available": True, **found}


async def _reply_to_read(stdout: asyncio.StreamReader) -> dict | None:
    """The result of request id 1. Every other line is dropped unread."""
    while True:
        line = await stdout.readline()
        if not line:
            return None
        try:
            message = json.loads(line)
        except ValueError:
            continue
        if isinstance(message, dict) and message.get("id") == 1:
            result = message.get("result")
            return result if isinstance(result, dict) else None


async def read_codex_rate_limits(*, timeout: float = CODEX_READ_TIMEOUT_S) -> dict | None:
    """Ask the installed codex app-server for the rate limits. None when it is absent or silent.

    The program and its one argument are literals, the environment is the CLI
    allowlist, and stderr is discarded. The app-server exits on end of input
    before it answers, so stdin stays open until the reply arrives.
    """
    if not find_cli("codex"):
        return None
    try:
        proc = await asyncio.create_subprocess_exec(
            "codex", "app-server",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            env=scrub_env(), limit=_MAX_LINE,
        )
    except OSError:
        return None
    try:
        if proc.stdin is None or proc.stdout is None:
            return None
        proc.stdin.write("".join(json.dumps(m) + "\n" for m in _HANDSHAKE).encode())
        await proc.stdin.drain()
        return await asyncio.wait_for(_reply_to_read(proc.stdout), timeout)
    except (asyncio.TimeoutError, OSError, ValueError):
        return None
    finally:
        await _kill(proc)


# Why a subscription shows no windows. The UI turns each into one sentence.
NOT_EXPOSED = {"available": False, "reason": "not-exposed"}
NOT_INSTALLED = {"available": False, "reason": "not-installed"}
