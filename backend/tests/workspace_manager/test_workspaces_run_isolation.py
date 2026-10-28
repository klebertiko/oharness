"""A run asked to isolate itself works in its own managed worktree; the main checkout is never written, and ending the run removes it."""
from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request

from database import SessionLocal
from main import app
from models import CoworkProject
from routers import execution
from routers.execution import ExecuteRequest, run_harness


@pytest.fixture
def engine_that_writes(monkeypatch):
    """A stand-in for the engine: writes one file into the cwd it is handed, then finishes. Records every cwd."""
    seen: list[str] = []

    async def fake(graph, execution_mode="mock", control=None, run_id="", cwd=None, **kwargs):
        seen.append(cwd)
        if cwd:
            Path(cwd, f"{run_id}.txt").write_text("written by the run\n", encoding="utf-8")
        yield 'event: run_start\ndata: {"run_id": "%s", "mode": "mock", "order": []}\n\n' % run_id
        yield 'event: harness_done\ndata: {"status": "complete", "total_tokens": 0, "tokens_estimated": false, "elapsed_ms": 0, "nodes_run": 0}\n\n'

    monkeypatch.setattr(execution, "execute_harness", fake)
    return seen


async def register(path) -> None:
    async with SessionLocal() as db:
        db.add(CoworkProject(name="p", root_path=str(path)))
        await db.commit()


async def start(path, worktree=True):
    async with SessionLocal() as db:
        return await run_harness(ExecuteRequest(graph_json={"nodes": [], "edges": []}, cwd=str(path), worktree=worktree),
                                 Request({"type": "http", "app": app}), db)


def worktrees(repo):
    return [line.split(" ", 1)[1] for line in repo.out("worktree", "list", "--porcelain").splitlines() if line.startswith("worktree ")]


def test_two_simultaneous_runs_write_to_distinct_worktrees_and_leave_the_checkout_alone(repo, oh_env, engine_that_writes):
    with TestClient(app) as client:
        client.portal.call(register, repo.path)
        first = client.portal.call(start, repo.path)
        second = client.portal.call(start, repo.path)
        for live in (first, second):  # worktree_ready, then the engine's first event: both runs are now live
            client.portal.call(anext, live.body_iterator)
            client.portal.call(anext, live.body_iterator)

        a, b = engine_that_writes
        assert a != b and Path(a) != repo.path and Path(b) != repo.path
        assert len(worktrees(repo)) == 3  # the main checkout and one worktree per run
        assert sorted(p.name for p in Path(a).glob("*.txt")) != sorted(p.name for p in Path(b).glob("*.txt"))
        assert repo.out("status", "--porcelain").strip() == ""  # the main checkout was not touched
        assert not list(repo.path.glob("*.txt"))

        for response in (first, second):
            async def drain(it=response.body_iterator):
                async for _ in it:
                    pass
            client.portal.call(drain)
        assert len(worktrees(repo)) == 1  # ending the runs removed both worktrees
        assert not any(Path(p).exists() for p in (a, b))
        assert repo.out("status", "--porcelain").strip() == ""
        for response in (first, second):  # what the run wrote is kept on a rescue ref, and the journal says which
            events = client.get(f"/execute/logs/{response.headers['X-Execution-Id']}/events?limit=50").json()["events"]
            closed = next(e for e in events if e["event"] == "worktree_closed")["data"]
            assert closed["rescue_ref"].startswith("refs/openharness/rescue/")
            assert "path" not in closed and all(e["event"] != "worktree_ready" or "path" not in e["data"] for e in events)


def test_a_run_that_is_cut_off_still_removes_its_worktree(repo, oh_env, engine_that_writes):
    with TestClient(app) as client:
        client.portal.call(register, repo.path)
        response = client.portal.call(start, repo.path)
        client.portal.call(anext, response.body_iterator)
        assert len(worktrees(repo)) == 2
        client.portal.call(response.body_iterator.aclose)
        assert len(worktrees(repo)) == 1


def test_without_the_flag_the_run_uses_the_checkout_as_before(repo, oh_env, engine_that_writes):
    with TestClient(app) as client:
        client.portal.call(register, repo.path)
        response = client.portal.call(start, repo.path, False)

        async def drain():
            async for _ in response.body_iterator:
                pass
        client.portal.call(drain)
        assert engine_that_writes == [str(repo.path.resolve())] and len(worktrees(repo)) == 1


def test_a_run_cannot_be_isolated_without_a_registered_workspace(repo, oh_env, engine_that_writes):
    from fastapi import HTTPException

    with TestClient(app) as client:  # the repository is not a registered project: its cwd is not honoured
        with pytest.raises(HTTPException) as caught:
            client.portal.call(start, repo.path)
        assert caught.value.status_code == 400 and caught.value.detail["code"] == "worktree_needs_workspace"
        assert engine_that_writes == []


def test_a_folder_that_is_not_a_repository_fails_the_run_with_an_error_event(oh_env, tmp_path, engine_that_writes):
    plain = tmp_path / "not-a-repo"
    plain.mkdir()
    with TestClient(app) as client:
        client.portal.call(register, plain)
        response = client.portal.call(start, plain)
        chunks = []

        async def drain():
            async for chunk in response.body_iterator:
                chunks.append(chunk)
        client.portal.call(drain)
        assert any("event: error" in c and "worktree" in c for c in chunks) and engine_that_writes == []
