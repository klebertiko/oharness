"""R-PRV-14 (#402): connections a person creates with their own id and endpoint
(an OpenAI-compatible server, or an Anthropic-style gateway). The subscription
path (I13) must not move: `anthropic`, `openai` and `cursor` stay kind=cli."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from adapters.anthropic_gateway import AnthropicGatewayAdapter
from adapters.base import AdapterConfig
from adapters.catalog import get_provider, list_catalog
from adapters.openai_compatible import OpenAICompatibleAdapter
from main import app
from providers.resolution import ProviderResolutionError, resolve_node_provider
from routers import providers as providers_router
from secret_store.memory import MemorySecrets

RAW_KEY = "sk-CUSTOM-TEST-SECRET-NEVER-LEAK-71c2"


@pytest.fixture()
def client():
    store = MemorySecrets()
    connections: dict = {}
    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as c:
        app.state.secrets_store = store
        app.state.provider_connections = connections
        yield c


def _create(client: TestClient, **over) -> httpx.Response:
    body = {
        "id": "my-vllm",
        "provider": "openai-compatible",
        "label": "My vLLM",
        "residence": "cloud",
        "endpoint": "https://llm.example.test/v1",
        "defaultModel": "qwen3.5-32b",
    }
    body.update(over)
    return client.post("/providers/connections", json=body)


# ── catalog ──────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("provider_id", ["openai-compatible", "anthropic-gateway"])
def test_catalog_offers_user_creatable_api_key_providers(client: TestClient, provider_id: str) -> None:
    ids = {p["id"] for p in client.get("/providers/catalog").json()["providers"]}
    assert provider_id in ids
    spec = get_provider(provider_id)
    assert spec is not None
    assert spec["credential"]["kind"] == "api-key"
    assert spec["endpoint"]["editable"] is True
    assert spec["billing"] == "metered"
    assert "chat" in spec["capabilities"]


@pytest.mark.parametrize("provider_id", ["anthropic", "openai", "cursor"])
def test_subscription_ids_stay_cli(provider_id: str) -> None:
    # I13: the catalog entries keep their CLI credential.
    assert get_provider(provider_id)["credential"]["kind"] == "cli"
    assert provider_id in {p["id"] for p in list_catalog()}


# ── create / list / delete ───────────────────────────────────────────────────

def test_create_list_delete_custom_connection_with_key_only_in_vault(client: TestClient) -> None:
    r = _create(client)
    assert r.status_code == 201, r.text
    assert r.json()["provider"] == "openai-compatible"

    put = client.post("/providers/my-vllm/secret", json={"key": RAW_KEY})
    assert put.status_code == 200
    ref = put.json()["secretRef"]
    assert app.state.secrets_store.get(ref) == RAW_KEY

    listed = client.get("/providers/connections").json()["connections"]
    assert [c["id"] for c in listed] == ["my-vllm"]
    assert RAW_KEY not in json.dumps(listed)
    assert RAW_KEY not in json.dumps(app.state.provider_connections)

    deleted = client.delete("/providers/connections/my-vllm")
    assert deleted.status_code == 204
    assert client.get("/providers/connections").json()["connections"] == []
    assert app.state.secrets_store.get(ref) in (None, "")


def test_custom_connection_survives_a_restart(client: TestClient) -> None:
    assert _create(client, id="gw-1", provider="anthropic-gateway", endpoint="https://gw.example.test").status_code == 201
    # A fresh lifespan reloads rows from the DB: the custom row must be there.
    with TestClient(app):
        reloaded = app.state.provider_connections
    assert reloaded["gw-1"]["provider"] == "anthropic-gateway"
    assert reloaded["gw-1"]["endpoint"] == "https://gw.example.test"


@pytest.mark.parametrize(
    "endpoint",
    [
        "",
        "ftp://llm.example.test/v1",
        "llm.example.test/v1",
        "https://",
        "https://user:pw@llm.example.test/v1",
        "https://token@llm.example.test/v1",
        "https://llm.example.test/v1?key=abc",
        "https://llm.example.test/v1#frag",
        "https://llm.example.test/v1 ",
        "javascript:alert(1)",
    ],
)
def test_custom_endpoint_is_validated_on_create(client: TestClient, endpoint: str) -> None:
    r = _create(client, endpoint=endpoint)
    assert r.status_code == 400, endpoint
    assert "pw" not in r.text and "abc" not in r.text  # the typed value is not echoed


@pytest.mark.parametrize("endpoint", ["http://127.0.0.1:8000/v1", "https://llm.example.test", "http://localhost:1234/v1/"])
def test_custom_endpoint_accepts_plain_http_or_https(client: TestClient, endpoint: str) -> None:
    assert _create(client, endpoint=endpoint).status_code == 201


def test_custom_endpoint_is_validated_on_update(client: TestClient) -> None:
    assert _create(client).status_code == 201
    r = client.put("/providers/connections/my-vllm", json={"endpoint": "https://a:b@llm.example.test/v1"})
    assert r.status_code == 400
    assert app.state.provider_connections["my-vllm"]["endpoint"] == "https://llm.example.test/v1"


def test_moving_a_keyed_custom_connection_to_another_host_is_refused(client: TestClient) -> None:
    # The stored key would otherwise go to a host the person never sent it to.
    assert _create(client).status_code == 201
    client.post("/providers/my-vllm/secret", json={"key": RAW_KEY})
    r = client.put("/providers/connections/my-vllm", json={"endpoint": "https://elsewhere.example.test/v1"})
    assert r.status_code == 409
    # Same host, another path: still the host the key was sent to.
    ok = client.put("/providers/connections/my-vllm", json={"endpoint": "https://llm.example.test/v2"})
    assert ok.status_code == 200


@pytest.mark.parametrize("reserved", ["anthropic", "openai", "cursor", "ollama-local", "ollama-cloud", "openrouter"])
def test_custom_connection_cannot_take_a_built_in_id(client: TestClient, reserved: str) -> None:
    r = _create(client, id=reserved)
    assert r.status_code == 400
    assert reserved not in app.state.provider_connections


@pytest.mark.parametrize("bad_id", ["", "My VLLM", "../etc", "a/b", "-lead", "x" * 65, "café"])
def test_custom_connection_id_is_a_slug(client: TestClient, bad_id: str) -> None:
    assert _create(client, id=bad_id).status_code in (400, 422)


def test_seed_rows_still_create_as_before(client: TestClient) -> None:
    # ensureBackendRow posts the seed rows with an empty endpoint; untouched.
    r = client.post(
        "/providers/connections",
        json={"id": "anthropic", "provider": "anthropic", "label": "Anthropic", "endpoint": ""},
    )
    assert r.status_code == 201


# ── resolution ───────────────────────────────────────────────────────────────

def _node(conn_id: str) -> dict:
    return {"providerIds": [conn_id]}


def test_custom_openai_compatible_resolves_to_the_http_adapter_with_its_endpoint_and_key() -> None:
    store = MemorySecrets()
    store.put("oharness/my-vllm", RAW_KEY)
    conns = {
        "my-vllm": {
            "id": "my-vllm", "provider": "openai-compatible", "label": "My vLLM", "residence": "cloud",
            "endpoint": "https://llm.example.test/v1", "enabled": True,
            "secretRef": "oharness/my-vllm", "defaultModel": "qwen3.5-32b",
        }
    }
    resolved = resolve_node_provider(_node("my-vllm"), "llm", "n", connections=conns, secrets_store=store)
    assert isinstance(resolved.adapter, OpenAICompatibleAdapter)
    assert resolved.config.endpoint == "https://llm.example.test/v1"
    assert resolved.config.api_key == RAW_KEY
    assert resolved.config.model == "qwen3.5-32b"


def test_custom_anthropic_gateway_resolves_to_the_gateway_adapter() -> None:
    store = MemorySecrets()
    store.put("oharness/gw", RAW_KEY)
    conns = {
        "gw": {
            "id": "gw", "provider": "anthropic-gateway", "label": "Gateway", "residence": "cloud",
            "endpoint": "https://gw.example.test", "enabled": True,
            "secretRef": "oharness/gw", "defaultModel": "claude-sonnet-5",
        }
    }
    resolved = resolve_node_provider(_node("gw"), "llm", "n", connections=conns, secrets_store=store)
    assert isinstance(resolved.adapter, AnthropicGatewayAdapter)
    assert resolved.config.endpoint == "https://gw.example.test"


@pytest.mark.parametrize("provider_id", ["openai-compatible", "anthropic-gateway"])
def test_custom_connection_without_a_model_is_an_honest_error(provider_id: str) -> None:
    store = MemorySecrets()
    store.put("oharness/c", RAW_KEY)
    conns = {"c": {"id": "c", "provider": provider_id, "label": "C", "residence": "cloud",
                   "endpoint": "https://x.example.test", "enabled": True, "secretRef": "oharness/c", "defaultModel": ""}}
    with pytest.raises(ProviderResolutionError, match="default model"):
        resolve_node_provider(_node("c"), "llm", "n", connections=conns, secrets_store=store)


# ── anthropic gateway adapter ────────────────────────────────────────────────

def _cfg(**over) -> AdapterConfig:
    base = dict(adapter="anthropic-gateway", model="claude-sonnet-5", endpoint="https://gw.example.test/", api_key=RAW_KEY)
    base.update(over)
    return AdapterConfig(**base)


def test_gateway_invoke_posts_messages_with_the_key_header() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={
            "model": "claude-sonnet-5",
            "content": [{"type": "text", "text": "hi"}],
            "usage": {"input_tokens": 3, "output_tokens": 2},
        })

    adapter = AnthropicGatewayAdapter(transport=httpx.MockTransport(handler))
    result = asyncio.run(adapter.invoke("hello", _cfg(system_prompt="be brief")))
    assert result.content == "hi"
    assert result.tokens_used == 5
    req = seen[0]
    assert str(req.url) == "https://gw.example.test/v1/messages"
    assert req.headers["x-api-key"] == RAW_KEY
    assert "anthropic-version" in req.headers
    body = json.loads(req.content)
    assert body["model"] == "claude-sonnet-5"
    assert body["system"] == "be brief"
    assert body["messages"] == [{"role": "user", "content": "hello"}]


def test_gateway_stream_events_report_text_and_usage() -> None:
    def handler(req: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}], "usage": {"input_tokens": 1, "output_tokens": 1}})

    adapter = AnthropicGatewayAdapter(transport=httpx.MockTransport(handler))
    async def collect():
        return [e async for e in adapter.stream_events("p", _cfg())]

    events = asyncio.run(collect())
    assert {"kind": "text", "text": "ok"} in events
    assert any(e["kind"] == "usage" and e["tokens"] == 2 for e in events)


def test_gateway_probe_lists_models_without_spending_tokens() -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"data": [{"id": "claude-sonnet-5"}, {"id": "claude-haiku-4-5"}]})

    adapter = AnthropicGatewayAdapter(transport=httpx.MockTransport(handler))
    result = asyncio.run(adapter.probe(_cfg(model="")))
    assert result.ok and result.health == "live"
    assert result.models == ["claude-sonnet-5", "claude-haiku-4-5"]
    assert seen[0].method == "GET"
    assert str(seen[0].url) == "https://gw.example.test/v1/models"


def test_gateway_probe_surfaces_a_bad_key_without_echoing_it() -> None:
    adapter = AnthropicGatewayAdapter(transport=httpx.MockTransport(lambda r: httpx.Response(401, json={"error": "nope"})))
    result = asyncio.run(adapter.probe(_cfg()))
    assert not result.ok
    assert RAW_KEY not in result.detail


def test_probe_route_attaches_the_key_to_a_custom_endpoint(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        return httpx.Response(200, json={"data": [{"id": "qwen3.5-32b"}]})

    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(providers_router, "get_adapter", lambda name: adapter)
    assert _create(client).status_code == 201
    client.post("/providers/my-vllm/secret", json={"key": RAW_KEY})
    r = client.post("/providers/my-vllm/probe")
    assert r.status_code == 200 and r.json()["ok"] is True
    assert str(seen[0].url) == "https://llm.example.test/v1/models"
    assert seen[0].headers["authorization"] == f"Bearer {RAW_KEY}"


# ── #507 review: typed values are validated on the way in ────────────────────

_BAD_MODELS = ["x" * 201, "qwen\n3.5", "qwen\x00", " qwen3.5", "qwen3.5 ", "qwen\t3.5"]


@pytest.mark.parametrize("provider_id", ["openai-compatible", "anthropic-gateway"])
@pytest.mark.parametrize("model", _BAD_MODELS)
def test_custom_connection_rejects_a_malformed_default_model_on_create(client: TestClient, provider_id: str, model: str) -> None:
    r = _create(client, provider=provider_id, defaultModel=model)
    assert r.status_code == 400
    assert model not in r.text  # the typed value is not echoed back
    assert "my-vllm" not in client.app.state.provider_connections


@pytest.mark.parametrize("model", _BAD_MODELS)
def test_custom_connection_rejects_a_malformed_default_model_on_update(client: TestClient, model: str) -> None:
    assert _create(client).status_code == 201
    r = client.put("/providers/connections/my-vllm", json={"defaultModel": model})
    assert r.status_code == 400
    assert client.app.state.provider_connections["my-vllm"]["defaultModel"] == "qwen3.5-32b"


def test_custom_connection_accepts_a_model_at_the_length_limit(client: TestClient) -> None:
    assert _create(client, defaultModel="m" * 200).status_code == 201


@pytest.mark.parametrize("provider_id", ["openai-compatible", "anthropic-gateway"])
@pytest.mark.parametrize("model", _BAD_MODELS)
def test_run_refuses_a_malformed_model_for_a_custom_connection(provider_id: str, model: str) -> None:
    store = MemorySecrets()
    store.put("oharness/c", RAW_KEY)
    conns = {"c": {"id": "c", "provider": provider_id, "label": "C", "residence": "cloud",
                   "endpoint": "https://x.example.test", "enabled": True, "secretRef": "oharness/c",
                   "defaultModel": "ok-model"}}
    with pytest.raises(ProviderResolutionError) as err:
        resolve_node_provider({"providerIds": ["c"], "model": model}, "llm", "n", connections=conns, secrets_store=store)
    assert model not in str(err.value)


@pytest.mark.parametrize("label", ["L" * 81, "My\nvLLM", "My\x1bvLLM"])
def test_connection_label_is_bounded_and_has_no_control_characters(client: TestClient, label: str) -> None:
    assert _create(client, label=label).status_code in (400, 422)
    assert _create(client, id="other", label="ok").status_code == 201
    assert client.put("/providers/connections/other", json={"label": label}).status_code in (400, 422)


def test_label_at_the_limit_is_accepted(client: TestClient) -> None:
    assert _create(client, label="L" * 80).status_code == 201


@pytest.mark.parametrize("key", ["sk-abc\ndef", "sk-abc\x00", "sk-\x7fabc"])
def test_secret_with_a_control_character_is_refused(client: TestClient, key: str) -> None:
    assert _create(client).status_code == 201
    r = client.post("/providers/my-vllm/secret", json={"key": key})
    assert r.status_code == 400
    assert key not in r.text
    assert client.app.state.secrets_store.get("oharness/my-vllm") is None


# ── #510: C1 and format (Cf) characters are spoofing, not text ───────────────

_INVISIBLE = ["​", "‮", "﻿", "\u0085", "\u009f"]


@pytest.mark.parametrize("ch", _INVISIBLE)
def test_label_with_a_c1_or_format_character_is_refused(client: TestClient, ch: str) -> None:
    assert _create(client, label=f"My{ch}vLLM").status_code in (400, 422)
    assert _create(client, id="other", label="ok").status_code == 201
    assert client.put("/providers/connections/other", json={"label": f"My{ch}vLLM"}).status_code in (400, 422)


@pytest.mark.parametrize("ch", _INVISIBLE)
def test_model_with_a_c1_or_format_character_is_refused(client: TestClient, ch: str) -> None:
    r = _create(client, defaultModel=f"qwen{ch}3.5")
    assert r.status_code == 400
    assert ch not in r.text


@pytest.mark.parametrize("ch", _INVISIBLE)
def test_secret_with_a_c1_or_format_character_is_refused(client: TestClient, ch: str) -> None:
    assert _create(client).status_code == 201
    r = client.post("/providers/my-vllm/secret", json={"key": f"sk-abc{ch}def"})
    assert r.status_code == 400
    assert client.app.state.secrets_store.get("oharness/my-vllm") is None


def test_ordinary_unicode_in_a_label_and_a_model_still_passes(client: TestClient) -> None:
    assert _create(client, label="Servidor da ação/β: v1.0", defaultModel="org/modelo:7b.q4").status_code == 201


# ── #511: the reserved ids come from the catalogue, not a second list ────────

def test_reserved_connection_ids_derive_from_the_catalogue() -> None:
    from adapters.catalog import PROVIDERS, RESERVED_CONNECTION_IDS

    assert set(PROVIDERS) <= RESERVED_CONNECTION_IDS
    assert {"ollama-local", "ollama-cloud"} <= RESERVED_CONNECTION_IDS
    assert RESERVED_CONNECTION_IDS == set(PROVIDERS) | {"ollama-local", "ollama-cloud"}


def test_router_uses_the_catalogue_reserved_ids() -> None:
    from adapters import catalog
    from routers import providers

    assert providers.RESERVED_CONNECTION_IDS is catalog.RESERVED_CONNECTION_IDS
