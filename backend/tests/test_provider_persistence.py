"""Provider connections survive a sidecar restart.

Surfaced live, 2026-09-12: `app.state.provider_connections` was in-memory
only. Every restart silently forgot every connection while the frontend kept
showing a stale green "connected" dot for them — the next real send then
failed honestly ("Connection 'openai' was not found") against a backend that
had quietly lost what the UI still claimed existed. `providers/store.py` is
the fix: these tests prove a write survives a fresh `load_all()` — the same
call `main.py`'s lifespan makes on every real startup — not just that the
in-memory dict looks right immediately after a call.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from database import SessionLocal
from main import app
from providers.store import load_all
from secret_store.memory import MemorySecrets


@pytest.fixture()
def client():
    app.state.secrets_store = MemorySecrets()
    app.state.provider_connections = {}
    with TestClient(app) as c:
        yield c


async def _reload_from_db() -> dict:
    """What a fresh process does on startup — a brand new dict, hydrated
    only from the database, nothing carried over from the old app.state."""
    async with SessionLocal() as session:
        return await load_all(session)


def test_a_created_connection_survives_a_simulated_restart(client: TestClient) -> None:
    resp = client.post(
        "/providers/connections",
        json={
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
        },
    )
    assert resp.status_code == 201

    import anyio

    reloaded = anyio.run(_reload_from_db)
    assert "anthropic" in reloaded
    assert reloaded["anthropic"]["enabled"] is True
    assert reloaded["anthropic"]["label"] == "Anthropic"


def test_a_stored_secret_and_enabled_flag_survive_a_simulated_restart(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={"id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "endpoint": "https://openrouter.ai/api/v1"},
    )
    resp = client.post("/providers/openrouter/secret", json={"key": "sk-or-TEST"})
    assert resp.status_code == 200

    import anyio

    reloaded = anyio.run(_reload_from_db)
    assert reloaded["openrouter"]["enabled"] is True
    assert reloaded["openrouter"]["secretRef"] == "oharness/openrouter"


def test_an_update_survives_a_simulated_restart(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={"id": "ollama-local", "provider": "ollama", "label": "Ollama local", "residence": "local", "endpoint": "http://127.0.0.1:11434/v1"},
    )
    resp = client.put("/providers/connections/ollama-local", json={"defaultModel": "qwen3.8:27b", "enabled": True})
    assert resp.status_code == 200

    import anyio

    reloaded = anyio.run(_reload_from_db)
    assert reloaded["ollama-local"]["defaultModel"] == "qwen3.8:27b"
    assert reloaded["ollama-local"]["enabled"] is True


def test_a_deleted_connection_stays_gone_after_a_simulated_restart(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={"id": "openai", "provider": "openai", "label": "OpenAI", "endpoint": "https://api.openai.com/v1"},
    )
    resp = client.delete("/providers/connections/openai")
    assert resp.status_code == 204

    import anyio

    reloaded = anyio.run(_reload_from_db)
    assert "openai" not in reloaded
