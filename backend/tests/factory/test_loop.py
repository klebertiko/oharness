"""The production loop starts a stage run: its own worktree, a slot in the pool, and a stop or a steer while it is going."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from database import SessionLocal, init_db
from factory import loop, service
from factory.models import WorkItemCreate
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory.secrets_orm import SecretIndex
from main import app
from models import RunEvent
from secret_store.memory import MemorySecrets
from workspaces.service import WorkspaceService

VALUE = 'Zq9-' + 'k3Lm' * 4
HUMAN = {'x-oharness-human': 'human-secret'}


def agent(role, secrets=None):
    return {'role': role, 'model': 'openai/gpt-4o', 'harness': 'local', 'engine': None, 'enabled': True,
            'permissions': {'mode': 'workspace_write'}, 'skills': [], 'mcp': [], 'secrets': secrets or [],
            'localSkills': {}, 'instructions': 'x', 'memory': {}}


def defn(limit=2):
    return {'name': 'payments', 'policy': {'requireSpec': False, 'specApproval': 'required', 'maxReviewReturns': 2,
                                           'reviewIndependence': 'require', 'maxPermissionMode': 'workspace_write'},
            'stages': {'review': {'required': True}}, 'tiers': {'deep': {'models': ['openai/gpt-4o']}},
            'ceilings': {'tokensPerRun': 100000, 'tokensPerWorkItem': 500000},
            'repositories': [{'id': 'app', 'path': '.', 'protectedBranches': ['main']}],
            'runners': {'main': {'type': 'local', 'maxConcurrentRuns': limit, 'credentialStrategy': 'forja'}},
            'agents': {'builder': agent('implement', ['forja/npm-token']), 'reader': agent('review') | {'permissions': {'mode': 'read_only'}, 'engine': 'studio-reader'}}}


def _repo(tmp_path: Path, monkeypatch):
    for key in ('HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME'):
        monkeypatch.setenv(key, str(tmp_path / 'home'))
    (tmp_path / 'home').mkdir()
    monkeypatch.setenv('OH_WORKSPACES_HOME', str(tmp_path / 'oh-data'))
    git = WorkspaceService().runner
    repo = tmp_path / 'repo'
    repo.mkdir()
    git.run(repo, ['init', '-q', '-b', 'main'])
    git.run(repo, ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'base'])
    return repo


async def _reset():
    async with SessionLocal() as db:
        for table in (RunEvent, WorkItemEvent, WorkItemRun, WorkItemArtifact, WorkItem, SecretIndex):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def ready():
    anyio.run(init_db)
    loop.BOARD.reset()
    yield
    loop.BOARD.reset()
    anyio.run(_reset)


@pytest.fixture()
def store():
    kept = MemorySecrets()
    kept.put('forja/npm-token', VALUE)
    return kept


async def _item(db, ref='r1'):
    item, *_ = await service.create(db, WorkItemCreate(factory_id='payments', title='Fix login', source={'kind': 'manual', 'ref': ref},
                                                       origin_context={'text': 'It breaks.'}))
    await service.enter_stage(db, item, 'implement', ('system', None))
    await db.commit()
    return item


async def _journal(run_id):
    async with SessionLocal() as db:
        rows = await db.scalars(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.sequence))
        return [(row.event_type, json.loads(row.data_json)) for row in rows]


def test_the_default_driver_finishes_the_stage_in_its_worktree(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        run_id = await loop.start(item_id, defn(), repo, store)
        row = loop.BOARD.get(run_id)
        async with SessionLocal() as db:
            item = await service.get(db, item_id)
        return item, row, await _journal(run_id)

    item, row, journal = anyio.run(case)
    assert item.stage != 'implement'
    assert row is not None and row.status == 'complete' and row.workspace and Path(row.workspace).is_dir()
    assert any(kind == 'agent_note' and 'worktree' in str(data.get('text')) for kind, data in journal)
    assert any(kind == 'harness_done' and data.get('status') == 'complete' for kind, data in journal)


def test_a_started_run_uses_its_own_worktree_and_a_nested_run(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)

    async def parent(run):
        await run.open_child('lint')
        run.spend(1)

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        run_id = await loop.start(item_id, defn(), repo, store, driver=parent)
        row = loop.BOARD.get(run_id)
        async with SessionLocal() as db:
            item = await service.get(db, item_id)
            links = (await db.scalars(select(WorkItemRun).where(WorkItemRun.work_item_id == item_id))).all()
        return item, run_id, row, links, await _journal(run_id)

    item, run_id, row, links, journal = anyio.run(case)
    assert item.stage != 'implement'
    assert [(link.run_id, link.agent_id) for link in links] == [(run_id, 'builder')]
    assert row is not None and row.workspace and Path(row.workspace).resolve() != repo.resolve()
    assert Path(row.workspace).is_dir()
    assert row.children == [{'run_id': row.children[0]['run_id'], 'label': 'lint', 'status': 'running'}]
    assert any(kind == 'child_run' and data.get('label') == 'lint' for kind, data in journal)
    assert loop.snapshot()['runs'][0]['children'][0]['label'] == 'lint'


def test_the_pool_from_the_definition_lets_one_run_through_at_a_time(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    seen = []

    async def slow(run):
        seen.append(loop.BOARD.running_for(defn(1)))
        await asyncio.sleep(0.05)
        run.spend(1)

    async def case():
        async with SessionLocal() as db:
            one, two = (await _item(db, 'a')).id, (await _item(db, 'b')).id
        await asyncio.gather(loop.start(one, defn(1), repo, store, driver=slow), loop.start(two, defn(1), repo, store, driver=slow))

    anyio.run(case)
    assert seen == [1, 1]


def test_stopping_keeps_the_worktree_and_a_steer_is_redacted(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    started = asyncio.Event()

    async def blocker(run):
        started.set()
        heard = []
        for _ in range(100):
            heard.extend(run.pull_steering())
            if heard and run.stopped():
                await run.note(heard[0])
                from factory.dispatch import RunStopped
                raise RunStopped('stopped')
            await asyncio.sleep(0.01)
        raise AssertionError('the run was not stopped')

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        task = asyncio.create_task(loop.start(item_id, defn(), repo, store, driver=blocker))
        await started.wait()
        run_id = loop.BOARD.active_for_item(item_id).run_id
        loop.steer(run_id, f'look at {VALUE}')
        await asyncio.sleep(0.03)
        loop.stop(run_id)
        finished = await task
        row = loop.BOARD.get(finished)
        async with SessionLocal() as db:
            item = await service.get(db, item_id)
            events = await service.events(db, item_id, 0, 100)
        return item, row, events, await _journal(finished)

    item, row, events, journal = anyio.run(case)
    assert item.status == 'queued' and item.stage == 'implement'
    assert any(event.type == 'run_stopped' for event in events)
    assert row.workspace and Path(row.workspace).is_dir()
    dumped = json.dumps(journal)
    assert 'look at' in dumped and VALUE not in dumped


def test_routes_list_runs_and_refuse_a_stranger(ready, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as client:
        listed = client.get('/factory/runs')
        assert listed.status_code == 200
        assert listed.json()['running'] == 0 and listed.json()['limit'] >= 1 and listed.json()['runs'] == []
        assert client.post('/factory/runs/missing/stop').status_code == 403
        assert client.post('/factory/runs/missing/steer', json={'text': 'hi'}).status_code == 403
        missing = client.post('/factory/runs/missing/stop', headers=HUMAN)
        assert missing.status_code == 404
        unknown = client.post('/factory/work-items/nope/run', json={'repo': '/tmp/nope'}, headers=HUMAN)
        assert unknown.status_code == 404
