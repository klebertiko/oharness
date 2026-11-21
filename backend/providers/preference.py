"""Preference order for several accounts of one provider. The engine walks this order."""
from __future__ import annotations


def order_for_failover(requested: list[str], preference: list[str]) -> list[str]:
    """`requested` ids in preference order. Ids missing from the preference keep their relative order at the end."""
    rank = {cid: index for index, cid in enumerate(preference)}
    tail = len(preference)
    return sorted(requested, key=lambda cid: (rank.get(cid, tail), requested.index(cid)))
