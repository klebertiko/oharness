"""#393 / R-PRV-12: an Ollama Cloud connection sends its stored key.

Ollama Cloud is the ``ollama`` provider with ``residence="cloud"`` (the frontend's
``specForConnection``). Its credential is an API key; "subscription" is only how
ollama.com bills it, never a CLI credential. Probe and run must send the key as a
bearer to ollama.com, and the key must never show in a log, a response or the
diagnostics report.

#503: the OpenAI-compatible surface lives under ``/v1`` (checked against the real
server: ``POST https://ollama.com/chat/completions`` answers 404,
``POST https://ollama.com/v1/chat/completions`` answers 401 without a key). The
fake below answers only the real paths, so a run that misses ``/v1`` fails here.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from adapters.catalog import spec_for_connection
from adapters.openai_compatible import OpenAICompatibleAdapter
from main import app
from providers.resolution import resolve_node_provider
from secret_store.memory import MemorySecrets

KEY = "olc-" + "canary" + "-7e21"  # built at run time: not a key-shaped literal
REF = "oharness/ollama-cloud"
CLOUD = {
    "id": "ollama-cloud",
    "provider": "ollama",
    "label": "Ollama Cloud",
    "residence": "cloud",
    "endpoint": "https://ollama.com/v1",
    "enabled": True,
    "secretRef": REF,
    "defaultModel": "gpt-oss:120b",
}


class Recorder:
    """A fake ollama.com: records every request, answers only the real paths."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path == "/api/version":
            return httpx.Response(200, json={"version": "0.0.0"})
        if request.url.path == "/api/tags":
            return httpx.Response(200, json={"models": [{"name": "gpt-oss:120b"}]})
        if request.url.path == "/v1/chat/completions":
            body = 'data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n'
            return httpx.Response(200, text=body, headers={"content-type": "text/event-stream"})
        return httpx.Response(404)


def _store() -> MemorySecrets:
    store = MemorySecrets()
    store.put(REF, KEY)
    return store


def test_ollama_cloud_spec_is_an_api_key_connection_billed_as_subscription() -> None:
    spec = spec_for_connection(CLOUD)
    assert spec is not None
    assert spec["credential"]["kind"] == "api-key"
    assert spec["billing"] == "subscription"
    assert spec["endpoint"] == {"default": "https://ollama.com/v1", "editable": False}
    local = spec_for_connection({**CLOUD, "residence": "local"})
    assert local is not None and local["credential"]["kind"] == "none"


def test_run_sends_the_stored_key_as_a_bearer(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    resolved = resolve_node_provider(
        {"providerIds": ["ollama-cloud"]}, "llm", "Draft",
        connections={"ollama-cloud": dict(CLOUD)}, secrets_store=_store(),
    )
    assert resolved.config.api_key == KEY
    recorder = Recorder()
    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(recorder))

    async def _run() -> list[dict]:
        return [e async for e in adapter.stream_events("hi", resolved.config)]

    events = asyncio.run(_run())
    assert {"kind": "text", "text": "ok"} in events
    (request,) = recorder.requests
    assert request.url.host == "ollama.com"
    assert request.url.path == "/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert KEY not in caplog.text


def test_a_row_saved_before_v1_still_runs_on_the_compatible_surface() -> None:
    # Rows seeded before #503 stored the bare host. The endpoint is fixed, so the
    # run takes the catalog default and never the stale stored value.
    row = {**CLOUD, "endpoint": "https://ollama.com"}
    resolved = resolve_node_provider(
        {"providerIds": ["ollama-cloud"]}, "llm", "Draft",
        connections={"ollama-cloud": row}, secrets_store=_store(),
    )
    assert resolved.config.endpoint == "https://ollama.com/v1"


def test_run_never_sends_the_key_to_an_edited_endpoint() -> None:
    # The endpoint is fixed for Ollama Cloud: a row that carries another host
    # (an old seed, a hand-edited database) still sends the key to ollama.com only.
    row = {**CLOUD, "endpoint": "https://elsewhere.example"}
    resolved = resolve_node_provider(
        {"providerIds": ["ollama-cloud"]}, "llm", "Draft",
        connections={"ollama-cloud": row}, secrets_store=_store(),
    )
    assert resolved.config.endpoint == "https://ollama.com/v1"


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    for module in ("adapters.cli_claude", "adapters.cli_codex", "adapters.cli_cursor"):
        monkeypatch.setattr(f"{module}.find_cli", lambda name: None)
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: Path("/home/someone")))
    with TestClient(app) as c:
        app.state.secrets_store = _store()
        app.state.provider_connections = {"ollama-cloud": dict(CLOUD)}
        yield c


def test_probe_sends_the_stored_key_and_never_echoes_it(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    import routers.providers as providers_router

    caplog.set_level(logging.DEBUG)
    recorder = Recorder()
    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(recorder))
    monkeypatch.setattr(providers_router, "get_adapter", lambda name: adapter)
    response = client.post("/providers/ollama-cloud/probe")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert recorder.requests, "the probe never reached ollama.com"
    # The probe speaks Ollama's native surface on the origin: /v1 is stripped.
    assert "/api/tags" in {r.url.path for r in recorder.requests}
    for request in recorder.requests:
        assert request.url.host == "ollama.com"
        assert request.url.path in {"/api/version", "/api/tags"}
        assert request.headers["authorization"] == f"Bearer {KEY}"
    assert KEY not in response.text
    assert KEY not in caplog.text


def test_diagnostics_reports_an_api_key_and_carries_no_key(client: TestClient) -> None:
    response = client.get("/providers/diagnostics")
    assert response.status_code == 200
    assert KEY not in response.text
    (row,) = [r for r in response.json()["connections"] if r["id"] == "ollama-cloud"]
    assert row["credentialKind"] == "api-key"
    assert row.get("cli") is None


def test_listing_reports_the_effective_endpoint_of_a_row_saved_before_v1(client: TestClient) -> None:
    # The UI hydrates `endpoint` from this listing: a pre-#503 row must show the
    # host the run really uses, not the stale bare host it was saved with.
    app.state.provider_connections["ollama-cloud"]["endpoint"] = "https://ollama.com"
    response = client.get("/providers/connections")
    assert response.status_code == 200
    (row,) = [r for r in response.json()["connections"] if r["id"] == "ollama-cloud"]
    assert row["endpoint"] == "https://ollama.com/v1"
    one = client.get("/providers/connections/ollama-cloud")
    assert one.json()["endpoint"] == "https://ollama.com/v1"


def test_probe_tolerates_a_spec_without_endpoint_or_credential(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    # P3 (#503): probe_connection read spec["endpoint"]["editable"] and
    # spec["credential"]["kind"] by index; a partial spec must not turn into a 500.
    import routers.providers as providers_router

    recorder = Recorder()
    adapter = OpenAICompatibleAdapter(transport=httpx.MockTransport(recorder))
    monkeypatch.setattr(providers_router, "get_adapter", lambda name: adapter)
    monkeypatch.setattr(providers_router, "spec_for_connection", lambda row: {"id": "ollama"})
    response = client.post("/providers/ollama-cloud/probe")
    assert response.status_code == 200
    for request in recorder.requests:
        assert "authorization" not in request.headers
