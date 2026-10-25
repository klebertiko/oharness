"""
The chat composer's WorkspacePicker lets a person choose a Cowork project as
the folder Nilo/the harness works in; `ExecuteRequest.cwd` / `DirectRequest.cwd`
carry that choice to the sidecar as a raw path string.

That string is untrusted: the endpoint has no way to know the caller was the
app's own frontend rather than anything else on the machine that can reach
`127.0.0.1:8000`. `_validated_project_cwd()` (routers/execution.py) is the one
place that trust decision gets made — a `cwd` is only ever honored when it is
the exact `root_path` of a project still registered in `cowork_projects` *and*
still a real directory on disk. Anything else degrades to no cwd (the CLI
adapter's own app-owned scratch-dir fallback via `cli_shared.resolve_cwd`),
never an error and never the raw unvalidated string reaching an adapter.
"""
from __future__ import annotations

import json

import anyio
import pytest
from fastapi.testclient import TestClient

from adapters.base import AdapterConfig, AdapterResult, AgentAdapter
from database import SessionLocal
from main import app
from routers.execution import _validated_project_cwd
from secret_store.memory import MemorySecrets


class _EchoCwdAdapter(AgentAdapter):
    """Answers with the cwd/cwd_root it was actually handed, so a test can
    assert on the wiring without reaching into engine internals."""

    async def invoke(self, prompt: str, config: AdapterConfig) -> AdapterResult:
        return AdapterResult(content=self._echo(config), tokens_used=3)

    async def stream(self, prompt: str, config: AdapterConfig):
        yield self._echo(config)

    @staticmethod
    def _echo(config: AdapterConfig) -> str:
        return json.dumps({"cwd": config.extra.get("cwd"), "cwd_root": config.extra.get("cwd_root")})


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    store = MemorySecrets()
    store.put("oharness/anthropic", "sk-ant-REAL")
    connections = {
        "anthropic": {
            "id": "anthropic",
            "provider": "anthropic",
            "label": "Anthropic",
            "residence": "cloud",
            "endpoint": "https://api.anthropic.com",
            "enabled": True,
            "secretRef": "oharness/anthropic",  # gitleaks:allow
        }
    }
    # Two different `get_adapter` bindings: the graph walk resolves through
    # `providers.resolution`, the /execute/direct passthrough imports its own
    # name directly into `routers.execution` — both need the stub.
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: _EchoCwdAdapter())
    monkeypatch.setattr("routers.execution.get_adapter", lambda name: _EchoCwdAdapter())
    app.state.secrets_store = store
    app.state.provider_connections = connections
    with TestClient(app) as c:
        app.state.secrets_store = store
        app.state.provider_connections = connections
        yield c


def _sse_events(text: str) -> list[tuple[str, dict]]:
    events = []
    for block in text.split("\n\n"):
        if not block.strip():
            continue
        lines = block.splitlines()
        name = next((l.removeprefix("event: ") for l in lines if l.startswith("event: ")), None)
        data_line = next((l.removeprefix("data: ") for l in lines if l.startswith("data: ")), None)
        if name and data_line:
            events.append((name, json.loads(data_line)))
    return events


def _register_project(client: TestClient, root_path: str) -> None:
    resp = client.post("/cowork/projects", json={"name": "proj", "rootPath": root_path})
    assert resp.status_code == 201, resp.text


# ── _validated_project_cwd — unit level ─────────────────────────────────────


def test_validated_cwd_is_none_for_no_request(tmp_path) -> None:
    async def run() -> str | None:
        async with SessionLocal() as db:
            return await _validated_project_cwd(db, None)

    assert anyio.run(run) is None


def test_validated_cwd_is_none_for_an_unregistered_real_directory(tmp_path) -> None:
    # A real, existing directory that was simply never added as a Cowork
    # project must not be trusted just because it happens to exist on disk.
    async def run() -> str | None:
        async with SessionLocal() as db:
            return await _validated_project_cwd(db, str(tmp_path))

    assert anyio.run(run) is None


def test_validated_cwd_resolves_a_registered_project(client: TestClient, tmp_path) -> None:
    _register_project(client, str(tmp_path))

    async def run() -> str | None:
        async with SessionLocal() as db:
            return await _validated_project_cwd(db, str(tmp_path))

    assert anyio.run(run) == str(tmp_path.resolve())


def test_validated_cwd_is_none_when_the_registered_folder_is_gone(client: TestClient, tmp_path) -> None:
    # Registered once, then deleted (renamed project, cleaned-up checkout,
    # ...) -- the DB row alone is not enough, the directory must still exist.
    missing = tmp_path / "deleted-since"
    _register_project(client, str(missing))

    async def run() -> str | None:
        async with SessionLocal() as db:
            return await _validated_project_cwd(db, str(missing))

    assert anyio.run(run) is None


# ── end-to-end wiring — /execute/ and /execute/direct ───────────────────────


def test_run_harness_threads_a_registered_project_cwd_into_the_node(
    client: TestClient, tmp_path
) -> None:
    _register_project(client, str(tmp_path))
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic"]}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }
    resp = client.post(
        "/execute/", json={"graph_json": graph, "mode": "live", "cwd": str(tmp_path)}
    )
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    seen = json.loads(node_done["output"])
    assert seen == {"cwd": str(tmp_path.resolve()), "cwd_root": str(tmp_path.resolve())}


def test_run_harness_threads_cwd_into_the_routed_direct_reply_too(
    client: TestClient, tmp_path
) -> None:
    # A chat message plain enough to route to a single reply (no full graph,
    # no HITL) still deserves to run in the chosen folder — the intake call
    # is a real adapter turn like any other, not exempt from this.
    _register_project(client, str(tmp_path))
    graph = {
        "nodes": [
            {"id": "PO", "type": "agent", "data": {"label": "PO", "providerIds": ["anthropic"]}},
        ],
        "edges": [],
    }
    resp = client.post(
        "/execute/",
        json={"graph_json": graph, "mode": "live", "instruction": "oi", "cwd": str(tmp_path)},
    )
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    run_start = next(d for n, d in events if n == "run_start")
    assert [step["node_id"] for step in run_start["order"]] == ["reply"]
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "reply")
    seen = json.loads(node_done["output"])
    assert seen == {"cwd": str(tmp_path.resolve()), "cwd_root": str(tmp_path.resolve())}


def test_run_harness_ignores_an_unregistered_cwd(client: TestClient, tmp_path) -> None:
    graph = {
        "nodes": [
            {"id": "in", "type": "input", "data": {"prompt": "hi"}},
            {"id": "draft", "type": "llm", "data": {"label": "Draft", "providerIds": ["anthropic"]}},
        ],
        "edges": [{"source": "in", "target": "draft"}],
    }
    resp = client.post(
        "/execute/", json={"graph_json": graph, "mode": "live", "cwd": str(tmp_path)}
    )
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_done = next(d for n, d in events if n == "node_done" and d["node_id"] == "draft")
    seen = json.loads(node_done["output"])
    assert seen == {"cwd": None, "cwd_root": None}


def test_run_direct_threads_a_registered_project_cwd(client: TestClient, tmp_path) -> None:
    _register_project(client, str(tmp_path))
    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "anthropic", "cwd": str(tmp_path)},
    )
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_done = next(d for n, d in events if n == "node_done")
    seen = json.loads(node_done["output"])
    assert seen == {"cwd": str(tmp_path.resolve()), "cwd_root": str(tmp_path.resolve())}


def test_run_direct_ignores_an_unregistered_cwd(client: TestClient, tmp_path) -> None:
    resp = client.post(
        "/execute/direct",
        json={"instruction": "hi", "mode": "live", "connection_id": "anthropic", "cwd": str(tmp_path)},
    )
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    node_done = next(d for n, d in events if n == "node_done")
    seen = json.loads(node_done["output"])
    assert seen == {"cwd": None, "cwd_root": None}
