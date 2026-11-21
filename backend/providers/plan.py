"""A subscription plan is one of a fixed set of words. An address is never a plan."""
from __future__ import annotations

_PLANS = {
    "pro": "Pro",
    "max": "Max",
    "plus": "Plus",
    "team": "Team",
    "free": "Free",
    "enterprise": "Enterprise",
    "business": "Business",
    "ultra": "Ultra",
}


def enumerated_plan(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    return _PLANS.get(value.strip().lower())
