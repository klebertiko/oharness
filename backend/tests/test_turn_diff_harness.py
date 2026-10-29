"""#163 (round 2): harness runs get a turn diff too, and the recorded state survives for history."""
import shutil

from test_turn_diff import _Editor, _sse, env, write  # noqa: F401 -- `env` is a fixture


def _graph():
    return {"nodes": [{"id": "in", "type": "input", "data": {"prompt": "hi"}},
                      {"id": "a", "type": "llm", "data": {"label": "a", "providerIds": ["local"], "model": "m"}}],
            "edges": [{"source": "in", "target": "a"}]}


def run_harness(client, root, **extra):
    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "live", "instruction": "edit", "cwd": str(root), **extra})
    assert resp.status_code == 200
    return resp, _sse(resp.text)


def test_harness_run_lists_the_files_it_changed_before_harness_done(env):
    client, root = env
    resp, events = run_harness(client, root)
    names = [n for n, _ in events]
    diff = dict(events)["turn_diff"]
    assert {f["path"] for f in diff["files"]} == {"a.txt", "b.txt"}
    assert names.index("turn_diff") < names.index("harness_done")
    rows = client.get(f"/execute/logs/{resp.headers['X-Execution-Id']}/events").json()
    rows = rows["events"] if isinstance(rows, dict) else rows
    assert any(r["event"] == "turn_diff" for r in rows)


def test_harness_run_revert_restores_one_file(env):
    client, root = env
    resp, _ = run_harness(client, root)
    run_id = resp.headers["X-Execution-Id"]
    assert client.post(f"/execute/{run_id}/turn-diff/revert", json={"path": "b.txt"}).status_code == 200
    assert (root / "b.txt").read_text() == "B0\n" and (root / "a.txt").read_text() == "A1\n"


def test_state_endpoint_reports_what_was_reverted(env):
    client, root = env
    resp, _ = run_harness(client, root)
    run_id = resp.headers["X-Execution-Id"]
    before = client.get(f"/execute/{run_id}/turn-diff").json()
    assert {f["path"]: f["reverted"] for f in before["files"]} == {"a.txt": False, "b.txt": False}
    client.post(f"/execute/{run_id}/turn-diff/revert", json={"path": "a.txt"})
    after = client.get(f"/execute/{run_id}/turn-diff").json()
    assert {f["path"]: f["reverted"] for f in after["files"]} == {"a.txt": True, "b.txt": False}
    assert client.get("/execute/no-such-run/turn-diff").json() == {"files": []}


def test_revert_says_so_when_the_workspace_is_gone(env):
    client, root = env
    resp, _ = run_harness(client, root)
    run_id = resp.headers["X-Execution-Id"]
    shutil.rmtree(root)
    r = client.post(f"/execute/{run_id}/turn-diff/revert", json={"path": "a.txt"})
    assert r.status_code == 409 and r.json() == {"error": "workspace_gone"}


def test_mock_runs_never_snapshot_the_folder(env):
    client, root = env
    resp = client.post("/execute/", json={"graph_json": _graph(), "mode": "mock", "instruction": "edit", "cwd": str(root)})
    assert "turn_diff" not in dict(_sse(resp.text))


def test_a_run_whose_node_fails_after_editing_still_lists_the_edit(env, monkeypatch):
    client, root = env

    class Failing(_Editor):
        async def stream_events(self, prompt, config):
            write(self.root, "a.txt", "A1\n")
            raise RuntimeError("provider fell over")
            yield  # pragma: no cover
    adapter = Failing()
    adapter.root = root
    monkeypatch.setattr("providers.resolution.get_adapter", lambda name: adapter)
    _, events = run_harness(client, root)
    assert [f["path"] for f in dict(events)["turn_diff"]["files"]] == ["a.txt"]
