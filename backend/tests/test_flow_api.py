"""GET/PUT /flow/config -- the global default of the Flow switch (off until turned on)."""
from __future__ import annotations

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from database import SessionLocal
from main import app
from models import FlowConfig
from routers.execution import ExecuteRequest, resolve_flow_switch


async def _reset() -> None:
    async with SessionLocal() as db:
        await db.execute(delete(FlowConfig))
        await db.commit()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


def test_flow_is_off_by_default(client: TestClient) -> None:
    resp = client.get("/flow/config")
    assert resp.status_code == 200
    assert resp.json() == {"enabled": False}


def test_put_round_trips_and_can_turn_it_off_again(client: TestClient) -> None:
    assert client.put("/flow/config", json={"enabled": True}).json() == {"enabled": True}
    assert client.get("/flow/config").json() == {"enabled": True}
    assert client.put("/flow/config", json={"enabled": False}).json() == {"enabled": False}


def test_put_rejects_anything_but_a_boolean(client: TestClient) -> None:
    assert client.put("/flow/config", json={"enabled": "yes"}).status_code == 422
    assert client.put("/flow/config", json={}).status_code == 422


def test_run_setting_wins_over_the_global_default() -> None:
    assert resolve_flow_switch(None, False) is False
    assert resolve_flow_switch(None, True) is True
    assert resolve_flow_switch(False, True) is False
    assert resolve_flow_switch(True, False) is True


def test_execute_request_flow_is_optional() -> None:
    assert ExecuteRequest().flow is None
    assert ExecuteRequest(flow=True).flow is True


def _events_of(text: str) -> list[str]:
    return [line.removeprefix("event: ").strip() for line in text.splitlines() if line.startswith("event: ")]


_GRAPH = {
    "nodes": [
        {"id": "in", "type": "input", "data": {"label": "In", "prompt": "go"}},
        {"id": "out", "type": "output", "data": {"label": "Out"}},
    ],
    "edges": [{"source": "in", "target": "out"}],
}


def _execute(client: TestClient, **extra) -> list[str]:
    resp = client.post("/execute/", json={"graph_json": _GRAPH, "mode": "mock", **extra})
    assert resp.status_code == 200
    return _events_of(resp.text)


def test_a_run_has_no_flow_advice_until_the_switch_is_on(client: TestClient) -> None:
    assert "flow_advice" not in _execute(client)


def test_the_run_setting_turns_flow_on_for_one_run(client: TestClient) -> None:
    assert _execute(client, flow=True).count("flow_advice") == 2
    assert "flow_advice" not in _execute(client)  # the global default stayed off


def test_the_global_default_applies_unless_the_run_overrides_it(client: TestClient) -> None:
    client.put("/flow/config", json={"enabled": True})
    assert _execute(client).count("flow_advice") == 2
    assert "flow_advice" not in _execute(client, flow=False)


def test_flow_config_needs_the_sidecar_token() -> None:
    import httpx
    from starlette.testclient import TestClient as RawClient

    raw = RawClient(app)
    raw.request = httpx.Client.request.__get__(raw, RawClient)  # bypass the suite's auto-auth patch
    assert raw.get("/flow/config").status_code == 401
    assert raw.put("/flow/config", json={"enabled": True}).status_code == 401
