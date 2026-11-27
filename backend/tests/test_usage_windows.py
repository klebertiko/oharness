"""A subscription window keeps a percent and a reset instant, never the source text."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

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
