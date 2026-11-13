"""#393 / R-PRV-12: an Ollama Cloud connection sends its stored key.

Ollama Cloud is the ``ollama`` provider with ``residence="cloud"`` (the frontend's
``specForConnection``). Its credential is an API key; "subscription" is only how
ollama.com bills it, never a CLI credential. Probe and run must send the key as a
bearer to ollama.com, and the key must never show in a log, a response or the
diagnostics report.
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
    "endpoint": "https://ollama.com",
    "enabled": True,
    "secretRef": REF,
    "defaultModel": "gpt-oss:120b",
}


class Recorder:
    """A fake ollama.com: records every request, answers like the real surface."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if request.url.path.endswith("/api/tags"):
            return httpx.Response(200, json={"models": [{"name": "gpt-oss:120b"}]})
        if request.url.path.endswith("/chat/completions"):
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
    assert spec["endpoint"] == {"default": "https://ollama.com", "editable": False}
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
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert KEY not in caplog.text


def test_run_never_sends_the_key_to_an_edited_endpoint() -> None:
    # The endpoint is fixed for Ollama Cloud: a row that carries another host
    # (an old seed, a hand-edited database) still sends the key to ollama.com only.
    row = {**CLOUD, "endpoint": "https://elsewhere.example"}
    resolved = resolve_node_provider(
        {"providerIds": ["ollama-cloud"]}, "llm", "Draft",
        connections={"ollama-cloud": row}, secrets_store=_store(),
    )
    assert resolved.config.endpoint == "https://ollama.com"


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
    for request in recorder.requests:
        assert request.url.host == "ollama.com"
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
