"""#164 (round 2): the per-run token ceiling also stops a harness run between nodes."""
from __future__ import annotations

from test_execution_budget_enforcement import _sse_events, client  # noqa: F401 -- fixture


def _two_node_graph():
    node = lambda nid: {"id": nid, "type": "llm", "data": {"label": nid, "providerIds": ["anthropic"], "model": "claude-sonnet-5"}}
    return {"nodes": [{"id": "in", "type": "input", "data": {"prompt": "hi"}}, node("a"), node("b")],
            "edges": [{"source": "in", "target": "a"}, {"source": "a", "target": "b"}]}


def _run(client, **extra):
    return client.post("/execute/", json={"graph_json": _two_node_graph(), "mode": "live", "instruction": "work", **extra})


def test_ceiling_stops_the_run_after_the_node_that_crosses_it(client):
    resp = _run(client, max_tokens=500)
    assert resp.status_code == 200
    events = _sse_events(resp.text)
    names = [name for name, _ in events]
    done = dict(events)
    assert done["budget_exceeded"]["max_tokens"] == 500 and done["budget_exceeded"]["used_tokens"] == 100_000
    assert done["harness_done"]["status"] == "budget_exceeded"
    ran = [data["node_id"] for name, data in events if name == "node_done"]
    assert "a" in ran and "b" not in ran  # node b never ran
    detail = client.get(f"/execute/logs/{resp.headers['X-Execution-Id']}").json()
    assert detail["status"] == "budget_exceeded"


def test_a_ceiling_nobody_reaches_changes_nothing(client):
    done = dict(_sse_events(_run(client, max_tokens=10_000_000).text))
    assert "budget_exceeded" not in done and done["harness_done"]["status"] == "complete"


def test_invalid_ceiling_is_refused_for_harness_runs_too(client):
    assert _run(client, max_tokens=5).status_code == 400
