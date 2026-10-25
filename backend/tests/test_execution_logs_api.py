"""Runs history: GET /execute/logs and GET /execute/logs/{id}."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from database import SessionLocal
from main import app
from models import ExecutionLog


@pytest.fixture()
def client() -> TestClient:
    with TestClient(app) as c:
        yield c


async def _seed(**kw) -> str:
    async with SessionLocal() as db:
        row = ExecutionLog(
            harness_id=kw.get("harness_id", "h1"),
            harness_name=kw.get("harness_name", "OHarness Agile"),
            status=kw.get("status", "complete"),
            result_json=kw.get("result_json", json.dumps({"output": "the plan ran"})),
        )
        db.add(row)
        await db.commit()
        await db.refresh(row)
        return row.id


def test_list_and_detail_round_trip(client: TestClient) -> None:
    import anyio

    log_id = anyio.run(_seed)

    listed = client.get("/execute/logs")
    assert listed.status_code == 200
    ids = [row["id"] for row in listed.json()]
    assert log_id in ids
    summary = next(row for row in listed.json() if row["id"] == log_id)
    assert summary["harness_name"] == "OHarness Agile"
    assert "result" not in summary  # list stays lightweight

    detail = client.get(f"/execute/logs/{log_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["id"] == log_id
    assert body["result"] == {"output": "the plan ran"}
    assert body["coverage"] == "legacy_unknown"
    assert body["last_sequence"] is None
    assert body["artifacts"] == []


def test_detail_404_for_unknown_run(client: TestClient) -> None:
    assert client.get("/execute/logs/does-not-exist").status_code == 404
