"""Providers API — catalog + connection CRUD; secrets never leak on GET."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from main import app
from secret_store.memory import MemorySecrets

RAW_KEY = "sk-ant-TEST-SECRET-VALUE-NEVER-LEAK-9f3a"


@pytest.fixture()
def client():
    store = MemorySecrets()
    connections: dict = {}
    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as c:
        # Re-apply after lifespan so tests always use MemorySecrets.
        app.state.secrets_store = store
        app.state.provider_connections = connections
        yield c


def _assert_no_raw_key(payload: object) -> None:
    blob = json.dumps(payload)
    assert RAW_KEY not in blob
    assert "NEVER-LEAK" not in blob


def test_catalog_lists_providers_including_openrouter(client: TestClient) -> None:
    r = client.get("/providers/catalog")
    assert r.status_code == 200
    body = r.json()
    ids = {p["id"] for p in body["providers"]}
    assert ids >= {"anthropic", "cursor", "openai", "ollama", "openrouter"}
    openrouter = next(p for p in body["providers"] if p["id"] == "openrouter")
    assert openrouter["vendor"] == "OpenRouter"
    assert openrouter["credential"]["kind"] == "api-key"


def test_create_list_get_update_delete_connection_metadata(client: TestClient) -> None:
    create = client.post(
        "/providers/connections",
        json={
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
        },
    )
    assert create.status_code == 201
    created = create.json()
    assert created["id"] == "anthropic"
    assert created.get("secretRef") is None
    _assert_no_raw_key(created)

    listed = client.get("/providers/connections")
    assert listed.status_code == 200
    assert any(c["id"] == "anthropic" for c in listed.json()["connections"])
    _assert_no_raw_key(listed.json())

    got = client.get("/providers/connections/anthropic")
    assert got.status_code == 200
    assert got.json()["provider"] == "anthropic"
    _assert_no_raw_key(got.json())

    updated = client.put(
        "/providers/connections/anthropic",
        json={"label": "Anthropic workspace", "enabled": True},
    )
    assert updated.status_code == 200
    assert updated.json()["label"] == "Anthropic workspace"
    assert updated.json()["enabled"] is True
    _assert_no_raw_key(updated.json())

    deleted = client.delete("/providers/connections/anthropic")
    assert deleted.status_code == 204
    assert client.get("/providers/connections/anthropic").status_code == 404


def test_post_secret_stores_via_secrets_store_returns_ref(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={
            "id": "openai",
            "provider": "openai",
            "label": "OpenAI",
            "residence": "cloud",
            "endpoint": "https://api.openai.com/v1",
        },
    )
    r = client.post("/providers/openai/secret", json={"key": RAW_KEY})
    assert r.status_code == 200
    body = r.json()
    assert "secretRef" in body
    assert body["secretRef"] == "oharness/openai"
    assert RAW_KEY not in json.dumps(body)

    store: MemorySecrets = app.state.secrets_store
    assert store.exists("oharness/openai")
    assert store.get("oharness/openai") == RAW_KEY


def test_get_connections_never_contains_sk_material(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={
            "id": "openai",
            "provider": "openai",
            "label": "OpenAI",
            "residence": "cloud",
            "endpoint": "https://api.openai.com/v1",
        },
    )
    client.post("/providers/openai/secret", json={"key": RAW_KEY})

    for path in ("/providers/connections", "/providers/connections/openai"):
        r = client.get(path)
        assert r.status_code == 200
        blob = json.dumps(r.json())
        assert RAW_KEY not in blob
        assert "sk-" not in blob
        meta = r.json()["connections"][0] if "connections" in r.json() else r.json()
        assert meta.get("secretRef") == "oharness/openai"
        for banned in ("key", "apiKey", "api_key", "secret", "plaintext"):
            assert banned not in meta or meta[banned] is None


def test_post_secret_unknown_connection_404(client: TestClient) -> None:
    r = client.post("/providers/missing/secret", json={"key": RAW_KEY})
    assert r.status_code == 404


def test_probe_unknown_connection_404(client: TestClient) -> None:
    r = client.post("/providers/missing/probe")
    assert r.status_code == 404


def test_probe_reports_fault_when_the_endpoint_is_unreachable(client: TestClient) -> None:
    # ollama's adapter probes a real GET /models — point it at a port nothing
    # listens on and confirm an honest "unreachable" fault, never a
    # fabricated success and never a hang (it must still be fast + tokenless).
    client.post(
        "/providers/connections",
        json={
            "id": "ollama-local",
            "provider": "ollama",
            "label": "Ollama local",
            "residence": "local",
            "endpoint": "http://127.0.0.1:1",
        },
    )
    r = client.post("/providers/ollama-local/probe")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["health"] == "fault"


def test_probe_returns_honest_not_implemented_for_an_adapter_without_one(client: TestClient) -> None:
    # A provider this backend has no adapter mapping for at all still gets an
    # honest "we do not know" rather than a fabricated success or a 500.
    client.post(
        "/providers/connections",
        json={
            "id": "mystery",
            "provider": "mystery-vendor",
            "label": "Mystery vendor",
            "residence": "cloud",
            "endpoint": "",
        },
    )
    r = client.post("/providers/mystery/probe")
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is False
    assert body["health"] == "setup"
    assert "mystery-vendor" in body["detail"]


def test_delete_secret_removes_it_from_the_store_and_disables_the_connection(client: TestClient) -> None:
    # "Remove key" must actually remove the key — not just forget the
    # renderer's reference while the sidecar keeps it (providers-recovery F10).
    client.post(
        "/providers/connections",
        json={"id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "residence": "cloud"},
    )
    client.post("/providers/openrouter/secret", json={"key": RAW_KEY})
    store: MemorySecrets = app.state.secrets_store
    assert store.exists("oharness/openrouter")

    r = client.delete("/providers/openrouter/secret")
    assert r.status_code == 204
    assert not store.exists("oharness/openrouter")
    row = client.get("/providers/connections/openrouter").json()
    assert row["secretRef"] is None
    assert row["enabled"] is False


def test_delete_secret_unknown_connection_404(client: TestClient) -> None:
    r = client.delete("/providers/missing/secret")
    assert r.status_code == 404


def test_probe_returns_the_model_ids_the_endpoint_serves(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    # The dossier must list what the daemon really serves, not a seed list
    # (providers-recovery F4). Model ids only — never the raw upstream body.
    from adapters.base import ProbeResult
    import routers.providers as providers_router

    class FakeAdapter:
        async def probe(self, config):  # noqa: ANN001
            return ProbeResult(ok=True, health="live", detail="2 models available.", models=["gemma4:26b", "nomic-embed-text:latest"])

    monkeypatch.setattr(providers_router, "get_adapter", lambda name: FakeAdapter())
    client.post(
        "/providers/connections",
        json={"id": "ollama-local", "provider": "ollama", "label": "Ollama local", "residence": "local"},
    )
    body = client.post("/providers/ollama-local/probe").json()
    assert body["models"] == ["gemma4:26b", "nomic-embed-text:latest"]


def test_put_connection_rejects_an_endpoint_change_for_a_non_editable_provider(client: TestClient) -> None:
    # SEC follow-up: a stored key must never be sent to a caller-chosen host.
    client.post(
        "/providers/connections",
        json={"id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "endpoint": "https://openrouter.ai/api/v1"},
    )
    r = client.put("/providers/connections/openrouter", json={"endpoint": "https://evil.example/v1"})
    assert r.status_code == 400
    assert r.json()["detail"] == "This provider's endpoint is fixed and cannot be changed."
    assert client.get("/providers/connections/openrouter").json()["endpoint"] == "https://openrouter.ai/api/v1"

    # Re-sending the current endpoint (or other fields) is not a change.
    ok = client.put(
        "/providers/connections/openrouter",
        json={"endpoint": "https://openrouter.ai/api/v1", "label": "Routed"},
    )
    assert ok.status_code == 200
    assert ok.json()["label"] == "Routed"


def test_put_connection_allows_an_endpoint_change_for_an_editable_provider(client: TestClient) -> None:
    client.post(
        "/providers/connections",
        json={"id": "ollama-local", "provider": "ollama", "label": "Ollama", "residence": "local"},
    )
    r = client.put("/providers/connections/ollama-local", json={"endpoint": "http://127.0.0.1:1234/v1"})
    assert r.status_code == 200
    assert r.json()["endpoint"] == "http://127.0.0.1:1234/v1"


def test_delete_secret_keeps_db_and_memory_consistent_when_the_commit_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import routers.providers as providers_router

    client.post(
        "/providers/connections",
        json={"id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "residence": "cloud"},
    )
    client.post("/providers/openrouter/secret", json={"key": RAW_KEY})
    store: MemorySecrets = app.state.secrets_store

    async def boom(db, conn):  # noqa: ANN001
        raise RuntimeError("db down")

    monkeypatch.setattr(providers_router.connection_store, "upsert", boom)
    with pytest.raises(RuntimeError):
        client.delete("/providers/openrouter/secret")

    # Nothing changed: the key is still stored and the row still points at it.
    assert store.exists("oharness/openrouter")
    row = app.state.provider_connections["openrouter"]
    assert row["secretRef"] == "oharness/openrouter"
    assert row["enabled"] is True


def test_post_connection_rejects_a_non_default_endpoint_for_a_non_editable_provider(client: TestClient) -> None:
    # Same SEC class as PUT: a key stored later must not be sendable to a host
    # the caller picked at create time.
    r = client.post(
        "/providers/connections",
        json={"id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "endpoint": "https://evil.example/v1"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "This provider's endpoint is fixed and cannot be changed."
    assert "openrouter" not in app.state.provider_connections


def test_post_connection_accepts_the_default_or_empty_endpoint_for_a_non_editable_provider(client: TestClient) -> None:
    default = client.post(
        "/providers/connections",
        json={"id": "openrouter", "provider": "openrouter", "label": "OpenRouter", "endpoint": "https://openrouter.ai/api/v1"},
    )
    assert default.status_code == 201
    empty = client.post(
        "/providers/connections",
        json={"id": "anthropic", "provider": "anthropic", "label": "Anthropic"},
    )
    assert empty.status_code == 201


def test_post_connection_allows_any_endpoint_for_an_editable_provider(client: TestClient) -> None:
    r = client.post(
        "/providers/connections",
        json={"id": "ollama-lan", "provider": "ollama", "label": "Ollama", "endpoint": "http://10.0.0.5:11434/v1"},
    )
    assert r.status_code == 201
    assert r.json()["endpoint"] == "http://10.0.0.5:11434/v1"


def test_put_connection_keeps_memory_unchanged_when_the_commit_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import routers.providers as providers_router

    client.post(
        "/providers/connections",
        json={"id": "ollama-local", "provider": "ollama", "label": "Ollama", "residence": "local", "endpoint": "http://127.0.0.1:11434/v1"},
    )

    async def boom(db, conn):  # noqa: ANN001
        raise RuntimeError("db down")

    monkeypatch.setattr(providers_router.connection_store, "upsert", boom)
    with pytest.raises(RuntimeError):
        client.put(
            "/providers/connections/ollama-local",
            json={"label": "Changed", "endpoint": "http://127.0.0.1:9/v1", "enabled": True, "defaultModel": "m"},
        )

    row = app.state.provider_connections["ollama-local"]
    assert row["label"] == "Ollama"
    assert row["endpoint"] == "http://127.0.0.1:11434/v1"
    assert row["enabled"] is False
    assert row["defaultModel"] == ""


def test_post_connection_leaves_no_ghost_row_when_the_commit_fails(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    import routers.providers as providers_router

    async def boom(db, conn):  # noqa: ANN001
        raise RuntimeError("db down")

    monkeypatch.setattr(providers_router.connection_store, "upsert", boom)
    with pytest.raises(RuntimeError):
        client.post("/providers/connections", json={"id": "x", "provider": "ollama", "label": "X"})
    assert "x" not in app.state.provider_connections
