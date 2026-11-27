"""A subscription window keeps a percent and a reset instant, never the source text."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import NamedTuple

import pytest
from fastapi.testclient import TestClient

from main import app
from providers.usage_windows import parse_usage_windows

CANARY = "CANARY-USAGE-1c8e"
EMAIL = "canary-person@example.test"
NOW = datetime(2026, 11, 21, 3, 0, tzinfo=timezone(timedelta(hours=-3)))


def test_lines_become_two_windows_and_drop_the_rest() -> None:
    text = "\n".join([
        f"5-hour usage: 62% {EMAIL}",
        "Weekly usage: 40% left",
        f"resets 6:20am {CANARY}",
    ])
    parsed = parse_usage_windows(text, now=NOW)
    assert parsed["available"] is True
    assert parsed["fiveHour"]["usedPct"] == 62
    assert parsed["weekly"]["usedPct"] == 60
    assert parsed["fiveHour"]["resetsAt"].endswith("06:20:00-03:00")
    blob = str(parsed)
    assert CANARY not in blob and EMAIL not in blob and "@" not in blob


def test_json_fields_are_kept_and_free_text_is_not() -> None:
    text = (
        '{"fiveHour": {"usedPct": 10, "resetsAt": "2026-11-21T09:20:00Z", "note": "'
        + CANARY + '"}, "weekly": {"remainingPct": 25}, "email": "' + EMAIL + '"}'
    )
    parsed = parse_usage_windows(text, now=NOW)
    assert parsed["fiveHour"]["usedPct"] == 10
    assert parsed["weekly"]["usedPct"] == 75
    assert "note" not in parsed["fiveHour"]
    assert CANARY not in str(parsed) and "@" not in str(parsed)


def test_no_data_is_unavailable_and_not_zero() -> None:
    for text in ("", f"the task mentioned 5-hour usage: 0% {CANARY}", "hello"):
        parsed = parse_usage_windows(text, now=NOW)
        assert parsed == {"available": False}
        assert "usedPct" not in str(parsed)


def test_route_reports_unavailable_until_a_reader_has_a_window() -> None:
    app.state.usage_window_reader = None

    async def silent() -> None:
        return None

    app.state.codex_rate_reader = silent
    with TestClient(app) as client:
        empty = client.get("/providers/usage-windows")
        assert empty.status_code == 200
        assert all(row["available"] is False for row in empty.json()["windows"])
        assert "0%" not in empty.text and "usedPct" not in empty.text

        def reader(cli: str) -> str:
            if cli == "claude":
                return f"5-hour usage: 62%\nWeekly usage: 40%\n{EMAIL} {CANARY}"
            return ""

        app.state.usage_window_reader = reader
        body = client.get("/providers/usage-windows").json()
        claude = next(row for row in body["windows"] if row["cli"] == "claude")
        assert claude["available"] is True and claude["fiveHour"]["usedPct"] == 62
        assert EMAIL not in str(body) and CANARY not in str(body)
    app.state.usage_window_reader = None
    app.state.codex_rate_reader = None


RATE_LIMITS = {
    "accountId": EMAIL,
    "rateLimits": {
        "limitId": "codex",
        "planType": "plus",
        "primary": {"usedPercent": 25, "windowDurationMins": 300, "resetsAt": 1795000000},
        "secondary": {"usedPercent": 61, "windowDurationMins": 10080, "resetsAt": 1795400000},
        "credits": {"note": CANARY},
    },
}


def test_codex_rate_limits_become_the_two_windows_and_nothing_else() -> None:
    from providers.usage_windows import windows_from_rate_limits

    parsed = windows_from_rate_limits(RATE_LIMITS)
    assert parsed["available"] is True
    assert parsed["fiveHour"] == {"usedPct": 25, "resetsAt": "2026-11-18T11:06:40+00:00"}
    assert parsed["weekly"]["usedPct"] == 61
    assert EMAIL not in str(parsed) and CANARY not in str(parsed) and "plus" not in str(parsed)


def test_codex_without_windows_is_unavailable_with_a_reason() -> None:
    from providers.usage_windows import windows_from_rate_limits

    for result in (None, {}, {"rateLimits": {"primary": {"usedPercent": "x", "windowDurationMins": 300}}}):
        assert windows_from_rate_limits(result) == {"available": False, "reason": "unreadable"}


def test_route_reads_codex_and_says_why_the_others_are_not_measured() -> None:
    app.state.usage_window_reader = None

    async def codex_reader() -> dict:
        return RATE_LIMITS

    app.state.codex_rate_reader = codex_reader
    try:
        with TestClient(app) as client:
            rows = {row["cli"]: row for row in client.get("/providers/usage-windows").json()["windows"]}
    finally:
        app.state.codex_rate_reader = None
    assert rows["codex"]["available"] is True and rows["codex"]["weekly"]["usedPct"] == 61
    assert rows["claude"] == {"cli": "claude", "provider": "anthropic", "available": False, "reason": "not-exposed"}
    assert rows["cursor"]["reason"] == "not-exposed"
    assert EMAIL not in str(rows)


# ── Deeply nested JSON is dropped, never a 500 ──

DEEP = "[" * 100000


def test_a_deeply_nested_json_text_is_unavailable_not_an_exception() -> None:
    assert parse_usage_windows('{"fiveHour": ' + DEEP, now=NOW) == {"available": False}


def test_the_route_survives_a_reader_that_returns_deeply_nested_json() -> None:
    app.state.usage_window_reader = lambda cli: '{"weekly": ' + DEEP
    try:
        with TestClient(app, raise_server_exceptions=False) as client:
            response = client.get("/providers/usage-windows")
    finally:
        app.state.usage_window_reader = None
    assert response.status_code == 200
    assert all(row["available"] is False for row in response.json()["windows"])


def test_reply_reader_drops_a_deeply_nested_line_and_keeps_reading() -> None:
    from providers.usage_windows import _reply_to_read

    async def scenario() -> dict | None:
        stream = asyncio.StreamReader(limit=1024 * 1024)
        stream.feed_data((DEEP + "\n").encode())
        stream.feed_data(b'{"id": 1, "result": {"rateLimits": {}}}\n')
        stream.feed_eof()
        return await _reply_to_read(stream)

    assert asyncio.run(scenario()) == {"rateLimits": {}}


# ── The real reader against a fake app-server ──
# The production call stays `create_subprocess_exec("codex", "app-server", ...)`. The test
# records that call and starts a Python fake with the very same keyword arguments, so the
# environment, the line limit and the working directory the fake sees are the production ones.

ENV_CANARY = "OH_USAGE_CANARY_7d1e"
REPLY = {"id": 1, "result": {"rateLimits": {"primary": {"usedPercent": 25, "windowDurationMins": 300}}}}

_FAKE = r'''
import json, os, sys, time
dump = {dump!r}
with open(dump, "w", encoding="utf-8") as fh:
    json.dump({{"argv": sys.argv[1:], "env": sorted(os.environ), "cwd": os.getcwd(), "pid": os.getpid()}}, fh)
for line in sys.stdin:
    if json.loads(line).get("id") == 1:
        break
for out in {before!r}:
    sys.stdout.write(out + "\n")
sys.stdout.flush()
if {silent!r}:
    time.sleep(120)
sys.stdout.write(json.dumps({reply!r}) + "\n")
sys.stdout.flush()
'''


class FakeServer(NamedTuple):
    calls: list[tuple[tuple[str, ...], dict]]
    procs: list[asyncio.subprocess.Process]
    dump: Path


def _fake_server(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, before: list[str] | None = None, silent: bool = False,
) -> FakeServer:
    import providers.usage_windows as uw

    dump = tmp_path / "seen.json"
    script = tmp_path / "fake_app_server.py"
    script.write_text(_FAKE.format(dump=str(dump), before=before or [], silent=silent, reply=REPLY), encoding="utf-8")
    calls: list[tuple[tuple[str, ...], dict]] = []
    procs: list[asyncio.subprocess.Process] = []
    real_exec = asyncio.create_subprocess_exec

    async def spy(*argv: str, **kwargs: object) -> asyncio.subprocess.Process:
        if argv[:1] != ("codex",):
            # The process-tree kill (`taskkill` on Windows) runs for real.
            return await real_exec(*argv, **kwargs)
        calls.append((argv, dict(kwargs)))
        proc = await real_exec(sys.executable, str(script), *argv[1:], **kwargs)
        procs.append(proc)
        return proc

    monkeypatch.setattr(uw, "find_cli", lambda name: f"/fake/bin/{name}")
    monkeypatch.setattr(uw.asyncio, "create_subprocess_exec", spy)
    monkeypatch.setenv(ENV_CANARY, CANARY)
    return FakeServer(calls, procs, dump)


def _seen(server: FakeServer) -> dict:
    return json.loads(server.dump.read_text(encoding="utf-8"))


def test_the_reader_runs_the_literal_app_server_with_the_cli_environment(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from adapters.cli_shared import default_cli_cwd
    from providers.usage_windows import read_codex_rate_limits

    server = _fake_server(tmp_path, monkeypatch)
    assert asyncio.run(read_codex_rate_limits(timeout=20)) == REPLY["result"]
    argv, kwargs = server.calls[0]
    assert argv == ("codex", "app-server")
    seen = _seen(server)
    assert seen["argv"] == ["app-server"]
    assert ENV_CANARY not in seen["env"] and ENV_CANARY.upper() not in seen["env"]
    assert set(kwargs["env"]) <= {k for k in os.environ if k.upper() in {
        "PATH", "PATHEXT", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "HOME", "APPDATA", "LOCALAPPDATA",
        "XDG_CONFIG_HOME", "XDG_DATA_HOME", "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "TEMP", "TMP",
        "COMSPEC", "USERNAME", "USER", "LANG", "LC_ALL"}}
    assert kwargs["stderr"] is asyncio.subprocess.DEVNULL
    assert kwargs["limit"] == 256 * 1024
    assert kwargs["cwd"] == str(default_cli_cwd())
    assert Path(seen["cwd"]).resolve() == default_cli_cwd().resolve()
    assert server.procs[0].returncode is not None


def test_the_reader_skips_garbage_and_deeply_nested_lines_before_the_reply(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from providers.usage_windows import read_codex_rate_limits

    noise = ["not json", f'{{"id": 2, "note": "{CANARY}"}}', "[" * 100000, '{"id": 1, "result": "x"']
    _fake_server(tmp_path, monkeypatch, before=noise)
    assert asyncio.run(read_codex_rate_limits(timeout=20)) == REPLY["result"]


def test_a_silent_app_server_times_out_and_is_killed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from providers.usage_windows import read_codex_rate_limits

    server = _fake_server(tmp_path, monkeypatch, silent=True)
    started = time.monotonic()
    assert asyncio.run(read_codex_rate_limits(timeout=1.5)) is None
    assert time.monotonic() - started < 15
    assert server.procs[0].returncode is not None


def test_a_line_longer_than_the_limit_ends_the_read_without_a_crash(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    from providers.usage_windows import read_codex_rate_limits

    server = _fake_server(tmp_path, monkeypatch, before=["x" * (300 * 1024)])
    assert asyncio.run(read_codex_rate_limits(timeout=20)) is None
    assert server.procs[0].returncode is not None


def test_the_reader_limits_stay_at_their_production_values() -> None:
    import inspect

    import providers.usage_windows as uw

    assert uw._MAX_LINE == 256 * 1024
    assert uw.CODEX_READ_TIMEOUT_S == 15.0
    assert inspect.signature(uw.read_codex_rate_limits).parameters["timeout"].default == 15.0
