"""Five-field cron (minute hour day-of-month month day-of-week) evaluated in a chosen time zone, with no external scheduler (ADR 0062).

Fields take ``*``, numbers, ``a-b`` ranges, ``*/n`` or ``a-b/n`` steps and comma lists. Day-of-week is 0-6 (Sunday 0; 7 also Sunday). As in
classic cron, when both day-of-month and day-of-week are restricted a day matches if EITHER does. During a repeated wall-clock hour (DST
fall-back) an expression can match twice; each match is a different instant and therefore a different occurrence.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

_RANGES = ((0, 59), (0, 23), (1, 31), (1, 12), (0, 7))
MAX_LOOKBACK = timedelta(days=31)


class CronError(ValueError):
    pass


def _field(text: str, low: int, high: int) -> frozenset[int]:
    values: set[int] = set()
    for part in text.split(","):
        base, _, step_text = part.partition("/")
        if step_text and not step_text.isdigit() or step_text == "0":
            raise CronError(f"bad step in {part!r}")
        step = int(step_text) if step_text else 1
        if base == "*":
            start, end = low, high
        elif "-" in base:
            a, _, b = base.partition("-")
            if not (a.isdigit() and b.isdigit()):
                raise CronError(f"bad range {part!r}")
            start, end = int(a), int(b)
        elif base.isdigit():
            start = int(base)
            end = high if step_text else start
        else:
            raise CronError(f"bad value {part!r}")
        if not (low <= start <= end <= high):
            raise CronError(f"{part!r} is outside {low}-{high}")
        values.update(range(start, end + 1, step))
    return frozenset(values)


@dataclass(frozen=True)
class Cron:
    minutes: frozenset[int]
    hours: frozenset[int]
    days: frozenset[int]
    months: frozenset[int]
    weekdays: frozenset[int]  # 0-6, Sunday 0
    dom_any: bool
    dow_any: bool
    zone: ZoneInfo | timezone

    def matches(self, instant: datetime) -> bool:
        local = instant.astimezone(self.zone)
        if local.minute not in self.minutes or local.hour not in self.hours or local.month not in self.months:
            return False
        dom, dow = local.day in self.days, (local.weekday() + 1) % 7 in self.weekdays
        return (dom or dow) if not (self.dom_any or self.dow_any) else (dom and dow)

    def latest(self, floor: datetime, now: datetime) -> datetime | None:
        """The most recent match in ``(floor, now]`` (whole minutes, UTC instants), looking back at most 31 days; None if there is none."""
        now = now.astimezone(timezone.utc).replace(second=0, microsecond=0)
        floor = max(floor.astimezone(timezone.utc), now - MAX_LOOKBACK)
        cursor = now
        while cursor > floor:
            if self.matches(cursor):
                return cursor
            cursor -= timedelta(minutes=1)
        return None


def parse_cron(expression: str, zone: str | None = None) -> Cron:
    parts = expression.split()
    if len(parts) != 5:
        raise CronError("a cron expression has 5 fields: minute hour day-of-month month day-of-week")
    fields = [_field(text, low, high) for text, (low, high) in zip(parts, _RANGES)]
    weekdays = frozenset(d % 7 for d in fields[4])
    try:
        tz = ZoneInfo(zone) if zone else (datetime.now().astimezone().tzinfo or timezone.utc)
    except Exception:
        raise CronError(f"unknown time zone {zone!r}") from None
    return Cron(fields[0], fields[1], fields[2], fields[3], weekdays, parts[2] == "*", parts[4] == "*", tz)
