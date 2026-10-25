"""
`execute_harness` in live/local mode must resolve a real provider per node
(node-pin/chip-fallback, both arriving as `data["providerIds"][0]`) and must
never silently swap in MockAdapter when that resolution fails — it stops the
run and names the node instead.

A stub adapter stands in for the real network-calling adapter classes here:
these tests are about the engine <-> resolver <-> adapter wiring, not about
actually reaching Anthropic/OpenRouter/etc.
"""
from __future__ import annotations

import asyncio
import json
from typing import AsyncIterator

import pytest

from adapters.base import AdapterConfig, AgentAdapter, AdapterResult
from engine import RunControl, execute_harness
from secret_store.memory import MemorySecrets


class _StubAdapter(AgentAdapter):
    """Records the config it was called with; never touches the network."""

    def __init__(self) -> None:
        self.calls: list[AdapterConfig] = []

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        self.calls.append(config)
        return AdapterResult(content="real output", tokens_used=3)

    async def stream(self, prompt: str, config: AdapterConfig) -> AsyncIterator[str]:
        self.calls.append(config)
        yield "real output"


def _events(chunks: list[str]) -> list[tuple[str, dict]]:
    out = []
    for c in chunks:
        if not c.startswith("event: "):
            continue
        name, _, rest = c.partition("\n")
        name = name.removeprefix("event: ").strip()
        data_line = rest.strip().removeprefix("data: ")
        out.append((name, json.loads(data_line)))
    return out


def _connections() -> dict[str, dict]:
    return {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "oharness/anthropic",  # gitleaks:allow
        },
        "openai-disabled": {
            "id": "openai-disabled",
            "provider": "openai",
            "label": "OpenAI (paused)",
            "residence": "cloud",
            "endpoint": "https://api.openai.com/v1",
            "enabled": False,
            "secretRef": "oharness/openai-disabled",
        },
        "cursor": {
            "id": "cursor",
            "provider": "cursor",
            "label": "Cursor",
            "residence": "cloud",
            "endpoint": "https://api.cursor.com",
            "enabled": True,
            "secretRef": "oharness/cursor",
        },
    }


def _run(graph: dict, connections: dict, secrets_store, monkeypatch, execution_mode="live"):
    stub = _StubAdapter()
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: stub)

    async def collect() -> list[str]:
        control = RunControl("t")
        chunks = []
        async for chunk in execute_harness(
            graph,
            execution_mode=execution_mode,
            control=control,
            connections=connections,
            secrets_store=secrets_store,
        ):
            chunks.append(chunk)
        return chunks

    return _events(asyncio.run(collect())), stub


def _one_llm_node_graph(node_data: dict) -> dict:
    return {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", **node_data}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }


def test_pinned_provider_id_resolves_to_real_adapter_not_mock(monkeypatch) -> None:
    graph = _one_llm_node_graph({"providerIds": ["anthropic"], "model": "claude-sonnet-5"})
    store = MemorySecrets()
    store.put("oharness/anthropic", "sk-ant-REAL")

    events, stub = _run(graph, _connections(), store, monkeypatch)

    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert node_start["adapter"] == "claude"
    assert node_start["adapter"] != "mock"

    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    assert node_done["output"] == "real output"
    assert not any(n == "node_error" for n, _ in events)

    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"

    # Anthropic rides the `claude` CLI's own subscription login (catalog
    # credential.kind: "cli") — the vault-stored secret above is deliberately
    # never read for this provider; api_key stays empty even though a secret
    # exists, which is the whole point of the CLI-adapter model.
    assert stub.calls[0].api_key == ""
    assert stub.calls[0].model == "claude-sonnet-5"


def test_missing_provider_ids_is_honest_error_stops_run(monkeypatch) -> None:
    graph = _one_llm_node_graph({})  # no providerIds at all

    events, stub = _run(graph, _connections(), MemorySecrets(), monkeypatch)

    assert stub.calls == []  # never reached the adapter
    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert "provider" in node_error["error"].lower()

    assert not any(n == "node_done" and d["node_id"] == "draft" for n, d in events)
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "error"


def test_disabled_connection_is_honest_error_names_the_connection(monkeypatch) -> None:
    graph = _one_llm_node_graph({"providerIds": ["openai-disabled"]})

    events, stub = _run(graph, _connections(), MemorySecrets(), monkeypatch)

    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert "OpenAI (paused)" in node_error["error"]
    assert stub.calls == []


def test_cursor_pinned_to_llm_node_is_honest_error(monkeypatch) -> None:
    graph = _one_llm_node_graph({"providerIds": ["cursor"]})
    store = MemorySecrets()
    store.put("oharness/cursor", "crsr_x")

    events, stub = _run(graph, _connections(), store, monkeypatch)

    node_error = next(d for n, d in events if n == "node_error" and d["node_id"] == "draft")
    assert "Cursor" in node_error["error"]
    assert stub.calls == []


def test_mock_mode_never_consults_provider_resolution(monkeypatch) -> None:
    """Explicit mock mode is a real user choice, not the honest-error path."""
    graph = _one_llm_node_graph({})  # would be an honest error in live mode

    events, stub = _run(
        graph, connections={}, secrets_store=None, monkeypatch=monkeypatch, execution_mode="mock"
    )

    assert stub.calls == []  # mock mode uses MockAdapter, not the stub at all
    node_start = next(d for n, d in events if n == "node_start" and d["node_id"] == "draft")
    assert node_start["adapter"] == "mock"
    assert not any(n == "node_error" for n, _ in events)
    harness_done = next(d for n, d in events if n == "harness_done")
    assert harness_done["status"] == "complete"
