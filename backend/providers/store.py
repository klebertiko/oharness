"""Durable persistence for provider connections — read/write helpers around
`models.ProviderConnection`. Call sites throughout the app (resolve_node_
provider, probe_connection, the execution router) already expect
`app.state.provider_connections` to be a plain `dict[str, dict]`; this module
keeps that shape and adds the DB round-trip, rather than threading a
SQLAlchemy session through every one of those (mostly read-only, hot-path)
call sites.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import ProviderConnection


def _to_dict(row: ProviderConnection) -> dict[str, Any]:
    return {
        "id": row.id,
        "provider": row.provider,
        "label": row.label,
        "residence": row.residence,
        "endpoint": row.endpoint,
        "enabled": row.enabled,
        "secretRef": row.secret_ref,
        "defaultModel": row.default_model,
        "rank": row.rank,
    }


async def load_all(db: AsyncSession) -> dict[str, dict[str, Any]]:
    """Hydrate the runtime dict from the database — called once at startup
    (`main.py`'s lifespan), so a restarted sidecar remembers every connection
    a person already set up instead of showing them as freshly disconnected."""
    result = await db.execute(select(ProviderConnection))
    return {row.id: _to_dict(row) for row in result.scalars().all()}


async def _apply(db: AsyncSession, conn: dict[str, Any]) -> None:
    existing = await db.get(ProviderConnection, conn["id"])
    if existing is None:
        existing = ProviderConnection(id=conn["id"])
        db.add(existing)
    existing.provider = conn["provider"]
    existing.label = conn["label"]
    existing.residence = conn["residence"]
    existing.endpoint = conn.get("endpoint", "")
    existing.enabled = bool(conn.get("enabled", False))
    existing.secret_ref = conn.get("secretRef")
    existing.default_model = conn.get("defaultModel", "")
    existing.rank = conn.get("rank")


async def upsert(db: AsyncSession, conn: dict[str, Any]) -> None:
    """Write the full row through, matching whatever the in-memory dict
    holds after a create/update/secret call — the DB is a mirror, not a
    separate source of partial truth to reconcile."""
    await _apply(db, conn)
    await db.commit()


async def upsert_many(db: AsyncSession, conns: list[dict[str, Any]]) -> None:
    """Write several full rows in one commit (the saved failover order touches every row), so it is never half saved."""
    for conn in conns:
        await _apply(db, conn)
    await db.commit()


async def delete(db: AsyncSession, connection_id: str) -> None:
    await db.execute(sa_delete(ProviderConnection).where(ProviderConnection.id == connection_id))
    await db.commit()
