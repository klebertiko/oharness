"""Providers API — catalog + connection metadata CRUD; secrets via SecretsStore.

Responses never include raw API keys. POST /providers/{id}/secret accepts a key
once, stores it, and returns only ``{secretRef}``.
"""

from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from adapters import AdapterConfig, get_adapter
from adapters.catalog import get_provider, list_catalog
from database import get_db
from providers import store as connection_store
from providers.resolution import ADAPTER_BY_PROVIDER
from secret_store.base import SecretsStore

router = APIRouter(prefix="/providers", tags=["providers"])

Residence = Literal["local", "cloud"]


class ConnectionCreate(BaseModel):
    id: str
    provider: str
    label: str
    residence: Residence = "cloud"
    endpoint: str = ""
    enabled: bool = False
    # HTTP-based providers (Ollama/OpenRouter/OpenAI-compatible) reject a
    # request with no model — "model is required" — unlike the CLI adapters,
    # which fall back to their own default when a node pins none. A graph
    # node's own `model` still wins when it has one; this is only the
    # fallback (see resolve_node_provider in providers/resolution.py).
    defaultModel: str = ""


class ConnectionUpdate(BaseModel):
    label: str | None = None
    residence: Residence | None = None
    endpoint: str | None = None
    enabled: bool | None = None
    defaultModel: str | None = None


class SecretBody(BaseModel):
    key: str = Field(..., min_length=1)


def get_secrets_store(request: Request) -> SecretsStore:
    store = getattr(request.app.state, "secrets_store", None)
    if store is None:
        raise HTTPException(503, "SecretsStore not configured")
    return store


def get_connections(request: Request) -> dict[str, dict[str, Any]]:
    conns = getattr(request.app.state, "provider_connections", None)
    if conns is None:
        raise HTTPException(503, "Provider connections store not configured")
    return conns


def _public_connection(row: dict[str, Any]) -> dict[str, Any]:
    """Strip anything that could be raw credential material."""
    return {
        "id": row["id"],
        "provider": row["provider"],
        "label": row["label"],
        "residence": row["residence"],
        "endpoint": row["endpoint"],
        "enabled": row.get("enabled", False),
        "secretRef": row.get("secretRef"),
        "defaultModel": row.get("defaultModel", ""),
    }


def _ensure_endpoint_allowed(provider: str, endpoint: str | None, *unchanged: str) -> None:
    """Reject a caller-chosen endpoint for a provider whose catalog endpoint is
    not editable. A stored key is attached to probes/runs against the row's
    endpoint, so it must never be pointed at an arbitrary host. ``unchanged``
    lists the values that are not a change (the current endpoint on update;
    empty or the catalog default on create). Providers absent from the catalog
    never get a key attached (probe checks the spec), so they stay editable."""
    if endpoint is None or endpoint in unchanged:
        return
    spec = get_provider(provider)
    if spec is not None and not spec["endpoint"]["editable"]:
        raise HTTPException(400, "This provider's endpoint is fixed and cannot be changed.")


@router.get("/catalog")
async def get_catalog():
    return {"providers": list_catalog()}


@router.get("/connections")
async def list_connections(connections: dict = Depends(get_connections)):
    return {"connections": [_public_connection(c) for c in connections.values()]}


@router.post("/connections", status_code=201)
async def create_connection(
    body: ConnectionCreate,
    connections: dict = Depends(get_connections),
    db: AsyncSession = Depends(get_db),
):
    if body.id in connections:
        raise HTTPException(409, f"Connection '{body.id}' already exists")
    spec = get_provider(body.provider)
    default_endpoint = spec["endpoint"]["default"] if spec is not None else ""
    _ensure_endpoint_allowed(body.provider, body.endpoint, "", default_endpoint)
    row = {
        "id": body.id,
        "provider": body.provider,
        "label": body.label,
        "residence": body.residence,
        "endpoint": body.endpoint,
        "enabled": body.enabled,
        "secretRef": None,
        "defaultModel": body.defaultModel,
    }
    # Commit first so a failing DB write leaves memory without a ghost row.
    await connection_store.upsert(db, row)
    connections[body.id] = row
    return _public_connection(row)


@router.get("/connections/{connection_id}")
async def get_connection(
    connection_id: str,
    connections: dict = Depends(get_connections),
):
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")
    return _public_connection(row)


@router.put("/connections/{connection_id}")
async def update_connection(
    connection_id: str,
    body: ConnectionUpdate,
    connections: dict = Depends(get_connections),
    db: AsyncSession = Depends(get_db),
):
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")
    _ensure_endpoint_allowed(row["provider"], body.endpoint, row.get("endpoint", ""))
    # Commit a copy first; swap it into memory only once the DB accepted it, so
    # a failing write leaves memory and DB in agreement.
    updated = dict(row)
    if body.label is not None:
        updated["label"] = body.label
    if body.residence is not None:
        updated["residence"] = body.residence
    if body.endpoint is not None:
        updated["endpoint"] = body.endpoint
    if body.enabled is not None:
        updated["enabled"] = body.enabled
    if body.defaultModel is not None:
        updated["defaultModel"] = body.defaultModel
    await connection_store.upsert(db, updated)
    connections[connection_id] = updated
    return _public_connection(updated)


@router.delete("/connections/{connection_id}", status_code=204)
async def delete_connection(
    connection_id: str,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
    db: AsyncSession = Depends(get_db),
):
    row = connections.pop(connection_id, None)
    if not row:
        raise HTTPException(404, "Connection not found")
    ref = row.get("secretRef")
    if ref:
        store.delete(ref)
    await connection_store.delete(db, connection_id)
    return None


@router.post("/{connection_id}/probe")
async def probe_connection(
    connection_id: str,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
):
    """
    Reachability + credential check — never spends tokens (`ProbeResult`'s own
    contract, `backend/adapters/base.py`). For a CLI-backed connection
    (anthropic, cursor) this runs the vendor CLI's own lightweight auth-status
    command; there is no key to validate. For an api-key connection this hits
    the vendor's own no-cost `GET /models`, with the stored key attached so a
    bad or missing credential surfaces as a real 401 rather than looking live.
    """
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")

    # Same translation resolve_node_provider() applies for a run: get_adapter()
    # is keyed by CLI/wire-protocol name ("claude"), not connection.provider
    # ("anthropic") — skipping it silently probes MockAdapter instead of the
    # real adapter and reports a false "not implemented".
    adapter_name = ADAPTER_BY_PROVIDER.get(row["provider"], row["provider"])
    adapter = get_adapter(adapter_name)

    api_key = ""
    spec = get_provider(row["provider"]) or {}
    if spec.get("credential", {}).get("kind") == "api-key" and row.get("secretRef"):
        api_key = store.get(row["secretRef"]) or ""

    config = AdapterConfig(adapter=adapter_name, model="", endpoint=row.get("endpoint", ""), api_key=api_key)
    result = await adapter.probe(config)
    return {
        "ok": result.ok,
        "health": result.health,
        "detail": result.detail,
        "latencyMs": result.latency_ms,
        "facts": [{"k": k, "v": v, "tone": tone} for k, v, tone in result.facts],
        "models": list(result.models),
    }


@router.post("/{connection_id}/secret")
async def put_secret(
    connection_id: str,
    body: SecretBody,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
    db: AsyncSession = Depends(get_db),
):
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")
    value = body.key.strip()
    if not value:
        raise HTTPException(400, "empty credential")
    ref = f"oharness/{connection_id}"
    store.put(ref, value)
    row["secretRef"] = ref
    row["enabled"] = True
    await connection_store.upsert(db, row)
    return {"secretRef": ref}


@router.delete("/{connection_id}/secret", status_code=204)
async def delete_secret(
    connection_id: str,
    connections: dict = Depends(get_connections),
    store: SecretsStore = Depends(get_secrets_store),
    db: AsyncSession = Depends(get_db),
):
    """Remove just the credential: the key leaves the SecretsStore and the
    connection is switched off; its endpoint and default model are kept.
    Before this route, "Remove key" only forgot the renderer's reference
    while the sidecar kept the key."""
    row = connections.get(connection_id)
    if not row:
        raise HTTPException(404, "Connection not found")
    ref = row.get("secretRef")
    # Commit the row first, on a copy: if the DB write raises, memory and the
    # SecretsStore are still untouched and agree with the DB.
    updated = {**row, "secretRef": None, "enabled": False}
    await connection_store.upsert(db, updated)
    connections[connection_id] = updated
    if ref:
        store.delete(ref)
    return None
