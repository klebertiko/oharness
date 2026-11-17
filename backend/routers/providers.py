"""Providers API — catalog + connection metadata CRUD; secrets via SecretsStore.

Responses never include raw API keys. POST /providers/{id}/secret accepts a key
once, stores it, and returns only ``{secretRef}``.
"""

from __future__ import annotations

import re
from typing import Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from adapters import AdapterConfig, get_adapter
from adapters.catalog import (
    CUSTOM_PROVIDER_IDS,
    endpoint_for_connection,
    endpoint_origin,
    get_provider,
    has_control_characters,
    is_custom_provider,
    list_catalog,
    spec_for_connection,
    validate_custom_endpoint,
    validate_custom_model,
)
from adapters.cli_shared import INVALID_CLI_MODEL, run_cli, valid_cli_model
from database import get_db
from providers import store as connection_store
from providers.diagnostics import build_report
from providers.resolution import ADAPTER_BY_PROVIDER
from runtime.cli_detect import detect_clis
from secret_store.base import SecretsStore

router = APIRouter(prefix="/providers", tags=["providers"])

Residence = Literal["local", "cloud"]


MAX_LABEL_LEN = 80


def _plain_label(value: str | None) -> str | None:
    if value is not None and has_control_characters(value):
        raise ValueError("The name cannot contain control characters.")
    return value


class ConnectionCreate(BaseModel):
    id: str
    provider: str
    label: str = Field(..., max_length=MAX_LABEL_LEN)
    residence: Residence = "cloud"
    endpoint: str = ""
    enabled: bool = False
    # HTTP-based providers (Ollama/OpenRouter/OpenAI-compatible) reject a
    # request with no model — "model is required" — unlike the CLI adapters,
    # which fall back to their own default when a node pins none. A graph
    # node's own `model` still wins when it has one; this is only the
    # fallback (see resolve_node_provider in providers/resolution.py).
    defaultModel: str = ""

    _label = field_validator("label")(_plain_label)


class ConnectionUpdate(BaseModel):
    label: str | None = Field(None, max_length=MAX_LABEL_LEN)
    residence: Residence | None = None
    endpoint: str | None = None
    enabled: bool | None = None
    defaultModel: str | None = None

    _label = field_validator("label")(_plain_label)


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


def _effective_endpoint(row: dict[str, Any]) -> str:
    """Where this connection's calls really go. A fixed endpoint is the catalog
    default (a row saved before that default changed, #503, still shows the
    host the run uses); an editable one stays as stored, empty included."""
    spec = spec_for_connection(row)
    if spec and not spec.get("endpoint", {}).get("editable", True):
        return endpoint_for_connection(row, spec)
    return row.get("endpoint", "")


def _public_connection(row: dict[str, Any]) -> dict[str, Any]:
    """Strip anything that could be raw credential material."""
    return {
        "id": row["id"],
        "provider": row["provider"],
        "label": row["label"],
        "residence": row["residence"],
        "endpoint": _effective_endpoint(row),
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


# The ids the app ships with (frontend seed rows + base providers). A connection
# a person creates never takes one: hydrate merges sidecar rows onto the seed by
# id, so a custom row named `anthropic` would wear the subscription's spec (I13).
RESERVED_CONNECTION_IDS = frozenset(
    {"anthropic", "cursor", "openai", "ollama", "ollama-local", "ollama-cloud", "openrouter",
     *CUSTOM_PROVIDER_IDS}
)
# The id is also the vault reference (`oharness/{id}`), so keep it a plain slug.
_CUSTOM_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def _ensure_custom_connection_allowed(connection_id: str, endpoint: str) -> None:
    if connection_id in RESERVED_CONNECTION_IDS:
        raise HTTPException(400, "That id belongs to a built-in connection. Choose another id.")
    if not _CUSTOM_ID.fullmatch(connection_id):
        raise HTTPException(400, "Use lowercase letters, digits and dashes for the id (up to 64).")
    _ensure_custom_endpoint_valid(endpoint)


def _ensure_custom_endpoint_valid(endpoint: str) -> None:
    reason = validate_custom_endpoint(endpoint)
    if reason:
        raise HTTPException(400, reason)


def _ensure_custom_model_valid(provider: str, model: str | None) -> None:
    if model and is_custom_provider(provider):
        reason = validate_custom_model(model)
        if reason:
            raise HTTPException(400, reason)


def _ensure_cli_model_allowed(spec: dict | None, model: str | None) -> None:
    """A subscription connection's model becomes the CLI's `--model` value, so it
    is validated before it is stored (fixed text: the typed value is not echoed)."""
    if spec is not None and spec["credential"]["kind"] == "cli" and model and not valid_cli_model(model):
        raise HTTPException(400, INVALID_CLI_MODEL)


@router.get("/catalog")
async def get_catalog():
    return {"providers": list_catalog()}


@router.get("/clis")
async def detect_subscription_clis(request: Request):
    """Which subscription CLIs (Claude, Codex, Cursor) are installed and signed in.

    Asks each CLI only for its version and its own status command — never a prompt,
    never a credential, so it spends no tokens. The runner is injectable through
    ``app.state.cli_runner`` for tests."""
    runner = getattr(request.app.state, "cli_runner", None) or run_cli
    return {"clis": await detect_clis(runner)}


@router.get("/diagnostics")
async def diagnostics(request: Request, connections: dict = Depends(get_connections)):
    """Secret-free doctor report (R-PRV-07); contract in providers/diagnostics.py and issue #390."""
    runner = getattr(request.app.state, "cli_runner", None) or run_cli
    return await build_report(connections, runner, request.app.version)


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
    if is_custom_provider(body.provider):
        _ensure_custom_connection_allowed(body.id, body.endpoint)
    spec = get_provider(body.provider)
    _ensure_cli_model_allowed(spec, body.defaultModel)
    _ensure_custom_model_valid(body.provider, body.defaultModel)
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
    if is_custom_provider(row["provider"]) and body.endpoint is not None:
        _ensure_custom_endpoint_valid(body.endpoint)
        # A stored key was sent to this host only; another host needs the key
        # removed (and typed again) first, so it never follows a URL edit.
        if row.get("secretRef") and endpoint_origin(body.endpoint) != endpoint_origin(row.get("endpoint", "")):
            raise HTTPException(409, "Remove the saved key before pointing this connection at another host.")
    _ensure_cli_model_allowed(get_provider(row["provider"]), body.defaultModel)
    _ensure_custom_model_valid(row["provider"], body.defaultModel)
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
    spec = spec_for_connection(row)
    # A fixed endpoint is the catalog default; an editable one stays as stored
    # (empty still means the adapter's own default, as before).
    endpoint = _effective_endpoint(row)
    if spec and spec.get("credential", {}).get("kind") == "api-key" and row.get("secretRef"):
        api_key = store.get(row["secretRef"]) or ""

    config = AdapterConfig(adapter=adapter_name, model="", endpoint=endpoint, api_key=api_key)
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
    if has_control_characters(value):
        # Fixed text: the typed key is never echoed.
        raise HTTPException(400, "The key cannot contain control characters.")
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
