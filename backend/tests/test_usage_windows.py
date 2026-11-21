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
