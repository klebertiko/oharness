"""The Workspace Manager's own state file: atomic, corruption-tolerant, safe under concurrent writers."""
from __future__ import annotations

import json
import os
import threading

import pytest

from workspaces.store import StateStore


WS_A = "ws-00000000000000aa"
SELECTED = {"repo": "R:/repo", "repo_key": "r", "id": WS_A}


def ws_id(n: int) -> str:
    return f"ws-{n:016x}"


def record(ident: str) -> dict:
    return {"id": ident, "path": os.path.abspath(os.sep + ident), "branch": None}


def test_a_missing_file_reads_as_empty_state(tmp_path):
    state = StateStore(tmp_path / "state.json").read()
    assert state == {"version": 1, "workspaces": {}, "selected": None}


def test_updates_persist_across_instances(tmp_path):
    path = tmp_path / "data" / "state.json"
    StateStore(path).mutate(lambda s: s["workspaces"].setdefault("repo1", {}).update({WS_A: record(WS_A)}))
    assert StateStore(path).read()["workspaces"]["repo1"][WS_A] == record(WS_A)


def test_a_failing_mutation_writes_nothing(tmp_path):
    store = StateStore(tmp_path / "state.json")
    store.mutate(lambda s: s.update(selected=SELECTED))

    def boom(state):
        state["selected"] = None
        raise RuntimeError("no")

    with pytest.raises(RuntimeError):
        store.mutate(boom)
    assert store.read()["selected"] == SELECTED


def test_a_failed_write_keeps_the_previous_file_and_leaves_no_temp(tmp_path, monkeypatch):
    path = tmp_path / "state.json"
    store = StateStore(path)
    store.mutate(lambda s: s.update(selected=SELECTED))
    before = path.read_bytes()

    def broken_replace(src, dst):
        raise OSError("disk full")

    monkeypatch.setattr(os, "replace", broken_replace)
    with pytest.raises(OSError):
        store.mutate(lambda s: s.update(selected=None))
    monkeypatch.undo()
    assert path.read_bytes() == before
    assert [p.name for p in tmp_path.iterdir()] == ["state.json"]


def test_a_corrupt_file_is_set_aside_and_state_restarts_empty(tmp_path):
    path = tmp_path / "state.json"
    path.write_text("{ not json", encoding="utf-8")
    assert StateStore(path).read()["workspaces"] == {}
    assert any(p.name.startswith("state.json.corrupt") for p in tmp_path.iterdir())


@pytest.mark.parametrize("payload", ["[]", '{"version": 99}', '{"version": 1, "workspaces": []}'])
def test_a_file_with_the_wrong_shape_is_treated_as_corrupt(tmp_path, payload):
    path = tmp_path / "state.json"
    path.write_text(payload, encoding="utf-8")
    assert StateStore(path).read() == {"version": 1, "workspaces": {}, "selected": None}


def test_concurrent_writers_do_not_lose_updates(tmp_path):
    store = StateStore(tmp_path / "state.json")

    def register(n):
        store.mutate(lambda s: s["workspaces"].setdefault("repo", {}).update({ws_id(n): record(ws_id(n))}))

    threads = [threading.Thread(target=register, args=(n,)) for n in range(25)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert len(json.loads((tmp_path / "state.json").read_text(encoding="utf-8"))["workspaces"]["repo"]) == 25


@pytest.mark.parametrize("quarantine", ["text", 5, {"a": 1}, None])
def test_a_quarantine_that_is_not_a_list_reads_as_empty(tmp_path, quarantine):
    path = tmp_path / "state.json"
    path.write_text(json.dumps({"version": 1, "workspaces": {"k": {"bad": {"id": "x"}}}, "selected": None, "quarantine": quarantine}), encoding="utf-8")
    state = StateStore(path).read()
    assert state["workspaces"] == {"k": {}} and len(state["quarantine"]) == 1
    StateStore(path).mutate(lambda s: s)  # and a write after it works
    assert not list(tmp_path.glob("state.json.corrupt-*"))


@pytest.mark.parametrize("selected", ["text", 5, ["a"], True])
def test_a_selection_of_the_wrong_type_drops_only_the_selection(tmp_path, selected):
    path = tmp_path / "state.json"
    kept = {ws_id(1): record(ws_id(1))}
    path.write_text(json.dumps({"version": 1, "workspaces": {"k": kept}, "selected": selected}), encoding="utf-8")
    state = StateStore(path).read()
    assert state["selected"] is None and state["workspaces"] == {"k": kept} and state["quarantine"] == [{"selected": selected}]
    assert not list(tmp_path.glob("state.json.corrupt-*")) and path.exists()


@pytest.mark.parametrize("payload", [
    pytest.param(b'{"version": 1, "workspaces": {}, "selected": null, "x": "\xff\xfe"}', id="invalid-utf8"),
    pytest.param(b'{"version": 1, "workspaces": {}, "x": ' + b"[" * 100000 + b"]" * 100000 + b"}", id="nested-100000"),
])
def test_a_poisoned_file_is_set_aside_and_reads_as_empty(tmp_path, payload):
    path = tmp_path / "state.json"
    path.write_bytes(payload)
    store = StateStore(path)
    assert store.read() == {"version": 1, "workspaces": {}, "selected": None}
    assert list(tmp_path.glob("state.json.corrupt-*"))
    store.mutate(lambda s: s.update(selected=SELECTED))  # and the store is usable again
    assert store.read()["selected"] == SELECTED


def test_a_selection_holding_a_lone_surrogate_is_dropped(tmp_path):
    path = tmp_path / "state.json"
    path.write_text(json.dumps({"version": 1, "workspaces": {}, "selected": {"repo": "\ud800", "repo_key": "r", "id": WS_A}}), encoding="utf-8")
    assert StateStore(path).read()["selected"] is None
