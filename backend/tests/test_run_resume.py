"""Continue a run for real: the nodes the parent finished are restored from its journal, the rest are executed, and starting twice is refused."""
import json

from fastapi.testclient import TestClient
from starlette.requests import Request

from database import SessionLocal
from main import app
from routers.execution import ExecuteRequest, run_harness

GRAPH = {
    "nodes": [
        {"id": "in", "type": "input", "data": {"prompt": "plan the sprint"}},
        {"id": "a", "type": "llm", "data": {"label": "A"}},
        {"id": "b", "type": "llm", "data": {"label": "B"}},
        {"id": "out", "type": "output", "data": {}},
    ],
    "edges": [{"id": "e1", "source": "in", "target": "a"}, {"id": "e2", "source": "a", "target": "b"}, {"id": "e3", "source": "b", "target": "out"}],
}


async def begin(graph=None):
    async with SessionLocal() as db:
        return await run_harness(ExecuteRequest(graph_json=graph or GRAPH, mode="mock"), Request({"type": "http", "app": app}), db)


def parse(chunk):
    event, _, rest = chunk.partition("\n")
    return event.removeprefix("event: "), json.loads(rest.removeprefix("data: ").strip())


def run_until_node_a_is_done_then_cut(client):
    """A parent run that is cut off right after node `a` finished: partial coverage, `a` done, `b` never started."""
    response = client.portal.call(begin)

    async def pump():
        async for chunk in response.body_iterator:
            event, data = parse(chunk)
            if event == "node_done" and data["node_id"] == "a":
                return
    client.portal.call(pump)
    client.portal.call(response.body_iterator.aclose)
    return response.headers["X-Execution-Id"]


def journal(client, run_id):
    return client.get(f"/execute/logs/{run_id}/events?limit=500").json()["events"]


def stream_start(client, run_id):
    response = client.post(f"/execute/logs/{run_id}/start")
    assert response.status_code == 200, response.text
    return [parse(block + "\n\n") for block in response.text.split("\n\n") if block.strip()]


def test_a_continued_run_restores_the_finished_nodes_and_executes_only_the_rest():
    parent = None
    with TestClient(app) as client:
        parent = run_until_node_a_is_done_then_cut(client)
    with TestClient(app) as client:  # the sidecar restarted
        before = journal(client, parent)
        parent_output_a = next(e["data"]["output"] for e in before if e["event"] == "node_done" and e["data"]["node_id"] == "a")
        child = client.post(f"/execute/logs/{parent}/continue").json()["id"]
        events = stream_start(client, child)

        restored = {d["node_id"]: d["output"] for e, d in events if e == "node_restored"}
        assert set(restored) == {"in", "a"} and restored["a"] == parent_output_a
        started = [d["node_id"] for e, d in events if e == "node_start"]
        assert started == ["b", "out"]  # a and in were not executed again
        done = [d for e, d in events if e == "harness_done"][0]
        assert done["status"] == "complete"

        detail = client.get(f"/execute/logs/{child}").json()
        assert detail["status"] == "complete" and detail["coverage"] == "complete" and detail["continued_from"] == parent
        assert [e["event"] for e in journal(client, child)][0] == "run_continued"
        assert journal(client, parent) == before  # the parent's journal was only read


def test_starting_a_continued_run_twice_is_refused_and_runs_nothing_again():
    with TestClient(app) as client:
        parent = run_until_node_a_is_done_then_cut(client)
    with TestClient(app) as client:
        child = client.post(f"/execute/logs/{parent}/continue").json()["id"]
        stream_start(client, child)
        sequences = len(journal(client, child))
        again = client.post(f"/execute/logs/{child}/start")
        assert again.status_code == 409 and again.json()["detail"]["code"] == "not_startable"
        assert len(journal(client, child)) == sequences


def test_only_a_pending_continuation_can_be_started():
    with TestClient(app) as client:
        parent = run_until_node_a_is_done_then_cut(client)
    with TestClient(app) as client:
        assert client.post(f"/execute/logs/{parent}/start").status_code == 409  # not a continuation
        assert client.post("/execute/logs/does-not-exist/start").status_code == 404


def test_a_restored_output_feeds_the_nodes_that_run_after_it():
    with TestClient(app) as client:
        parent = run_until_node_a_is_done_then_cut(client)
    with TestClient(app) as client:
        child = client.post(f"/execute/logs/{parent}/continue").json()["id"]
        events = stream_start(client, child)
        finished = {d["node_id"]: d["output"] for e, d in events if e == "node_done"}
        assert finished["out"]  # the output node assembled something from b, which ran on a's restored output


def test_a_continuation_whose_parent_kept_no_inputs_is_refused_and_stays_startable():
    import anyio
    from sqlalchemy import delete

    from models import ExecutionLog, RunInput

    with TestClient(app) as client:
        parent = run_until_node_a_is_done_then_cut(client)
    with TestClient(app) as client:
        child = client.post(f"/execute/logs/{parent}/continue").json()["id"]

        async def forget():
            async with SessionLocal() as db:
                await db.execute(delete(RunInput).where(RunInput.run_id == child))
                await db.commit()

        anyio.run(forget)
        refused = client.post(f"/execute/logs/{child}/start")
        assert refused.status_code == 409 and refused.json()["detail"]["code"] == "inputs_unavailable"
        assert client.get(f"/execute/logs/{child}").json()["status"] == "pending"  # not left half-started


def seed_journal(run_id, events):
    """Write a run's journal by hand: (event, data) pairs, sequence from 1."""
    import anyio

    from models import ExecutionLog, RunEvent, RunLink, RunRecord

    async def go():
        async with SessionLocal() as db:
            db.add(ExecutionLog(id=run_id, harness_id="adhoc", harness_name="H", status="interrupted"))
            db.add(RunRecord(id=run_id, source="harness", last_sequence=len(events)))
            await db.flush()
            for n, (event, data) in enumerate(events, 1):
                db.add(RunEvent(run_id=run_id, sequence=n, event_type=event, data_json=json.dumps(data)))
            await db.commit()

    anyio.run(go)


def link(child, parent):
    import anyio

    from models import RunLink

    async def go():
        async with SessionLocal() as db:
            db.add(RunLink(child_id=child, parent_id=parent, parent_sequence=1))
            await db.commit()

    anyio.run(go)


def test_a_gate_that_sent_the_run_back_is_not_restored_and_nothing_after_it_is_read():
    from run_store import resume_seed

    seed_journal("gate-run", [
        ("node_done", {"node_id": "a", "output": "draft"}),
        ("node_done", {"node_id": "g", "output": "FAIL"}),
        ("gate_retry", {"node_id": "g", "attempt": 1, "cap": 3, "target": "a"}),
        ("node_done", {"node_id": "a", "output": "second draft"}),
    ])
    import anyio

    async def go():
        async with SessionLocal() as db:
            return await resume_seed(db, "gate-run")

    with TestClient(app):
        assert anyio.run(go) == {"a": "draft"}  # the failed check runs again; the retry's own work was not finished


def test_a_continuation_that_stopped_early_still_hands_down_what_its_parents_finished():
    import anyio

    from run_store import resume_seed

    seed_journal("grand", [("node_done", {"node_id": "a", "output": "A1"}), ("node_done", {"node_id": "b", "output": "B1"})])
    seed_journal("child", [("node_restored", {"node_id": "a", "output": "A1"})])
    link("child", "grand")

    async def go():
        async with SessionLocal() as db:
            return await resume_seed(db, "child")

    with TestClient(app):
        assert anyio.run(go) == {"a": "A1", "b": "B1"}
