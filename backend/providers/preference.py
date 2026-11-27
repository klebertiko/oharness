"""Preference order for several accounts. The engine walks this order."""
from __future__ import annotations

from typing import Any

# Why an account was passed over, as a closed class. Nothing a provider or CLI
# printed ever travels with it: the frontend turns the class into its own words.
REASON_CLASSES = ("usage_limit", "signin", "unavailable", "failed", "budget")

_BY_FAILURE = {
    "usage_limit": "usage_limit",
    "cli-signin": "signin",
    "authentication": "signin",
    "cli-missing": "unavailable",
}


def failover_reason_class(provider_failure: object) -> str:
    """The closed class for a `failure_details()` `provider_failure` value; anything else is `failed`."""
    return _BY_FAILURE.get(provider_failure, "failed") if isinstance(provider_failure, str) else "failed"


def order_for_failover(requested: list[str], preference: list[str]) -> list[str]:
    """`requested` ids in preference order. Ids missing from the preference keep their relative order at the end."""
    rank = {cid: index for index, cid in enumerate(preference)}
    tail = len(preference)
    return sorted(requested, key=lambda cid: (rank.get(cid, tail), requested.index(cid)))


def saved_order(connections: dict[str, dict[str, Any]] | None) -> list[str]:
    """The order saved on the Providers screen: connection ids by their `rank`. Unranked rows are left out."""
    ranked = [
        (row["rank"], cid)
        for cid, row in (connections or {}).items()
        if isinstance(row.get("rank"), int) and not isinstance(row.get("rank"), bool)
    ]
    return [cid for _, cid in sorted(ranked)]


def failover_chain(data: dict, connections: dict[str, dict[str, Any]] | None) -> list[str]:
    """`providerIds` in the order failover tries them: the request's own `preference` when it pins one, else the saved order."""
    provider_ids = [str(p) for p in (data.get("providerIds") or []) if p]
    preference = data.get("preference")
    if isinstance(preference, list):
        order = [str(item) for item in preference if item]
    else:
        order = saved_order(connections)
    return order_for_failover(provider_ids, order) if order and provider_ids else provider_ids
