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
        assert client.post('/factory/runs/00000000-0000-0000-0000-000000000000/stop').status_code == 403
        assert client.post('/factory/runs/00000000-0000-0000-0000-000000000000/steer', json={'text': 'hi'}).status_code == 403
        missing = client.post('/factory/runs/00000000-0000-0000-0000-000000000000/stop', headers=HUMAN)
        assert missing.status_code == 404
        unknown = client.post('/factory/work-items/nope/run', json={'repo': '/tmp/nope'}, headers=HUMAN)
        assert unknown.status_code == 404


# ------------------------------------------------------------------------------------------------------- one run per item, bounded

def test_an_item_that_is_already_running_cannot_start_a_second_run(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    gate = asyncio.Event()

    async def slow(run):
        await gate.wait()

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        first = asyncio.create_task(loop.start(item_id, defn(), repo, store, driver=slow))
        for _ in range(200):
            if loop.BOARD.active_for_item(item_id):
                break
            await asyncio.sleep(0.01)
        try:
            with pytest.raises(loop.dispatch.DispatchError):
                await asyncio.wait_for(loop.start(item_id, defn(), repo, store, driver=slow), timeout=10)
        finally:
            gate.set()
            await asyncio.wait_for(first, timeout=30)

    anyio.run(case)


def test_steering_is_bounded_and_refuses_a_credential():
    loop.BOARD.reset()
    row = loop.BOARD.open(loop.LiveRun(run_id='r', item_id='i', title='t', stage='implement', agent_id='a', status='running',
                                       engine=None, harness=None, cancel=asyncio.Event(), steering=[]))
    for index in range(loop.MAX_STEERING):
        loop.steer('r', f'note {index}')
    with pytest.raises(loop.SteeringFull):
        loop.steer('r', 'one more')
    row.steering.clear()
    with pytest.raises(ValueError):
        loop.steer('r', 'use ghp_' + 'a' * 36)
    loop.BOARD.reset()


def test_the_board_keeps_only_the_latest_finished_runs():
    loop.BOARD.reset()
    for index in range(loop.MAX_FINISHED + 20):
        loop.BOARD.open(loop.LiveRun(run_id=f'r{index}', item_id=f'i{index}', title='t', stage='implement', agent_id='a',
                                     status='complete', engine=None, harness=None, cancel=asyncio.Event(), steering=[]))
    assert len(loop.BOARD.runs) == loop.MAX_FINISHED
    assert 'r0' not in loop.BOARD.runs and f'r{loop.MAX_FINISHED + 19}' in loop.BOARD.runs
    loop.BOARD.reset()


def test_run_and_item_ids_in_the_path_are_checked(ready, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as client:
        assert client.post('/factory/runs/not a run/stop', headers=HUMAN).status_code == 422
        assert client.post('/factory/runs/x' * 3 + '/steer', json={'text': 'hi'}, headers=HUMAN).status_code in (404, 422)
        assert client.post('/factory/runs/00000000-0000-0000-0000-000000000000/steer', json={'text': 'hi', 'extra': 1}, headers=HUMAN).status_code == 422


# ------------------------------------------------------------------------------- a run that ends badly still frees the item and the board

async def _status(item_id):
    async with SessionLocal() as db:
        return (await service.get(db, item_id)).status


def test_a_crash_outside_the_stage_frees_the_item_and_the_board(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)

    async def broken(*_args, **_kwargs):
        raise RuntimeError('the database went away')
    monkeypatch.setattr(loop.dispatch.service, 'link_run', broken)

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        before = await _status(item_id)
        with pytest.raises(RuntimeError):
            await loop.start(item_id, defn(), repo, store)
        return item_id, before

    item_id, before = anyio.run(case)
    assert loop.BOARD.active_for_item(item_id) is None
    assert [row.status for row in loop.BOARD.runs.values()] == ['error']
    assert anyio.run(_status, item_id) == before


def test_a_cancelled_run_frees_the_item_and_the_board(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    started = asyncio.Event()

    async def forever(run):
        started.set()
        await asyncio.Event().wait()

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        before = await _status(item_id)
        task = asyncio.create_task(loop.start(item_id, defn(), repo, store, driver=forever))
        await asyncio.wait_for(started.wait(), timeout=30)
        assert await _status(item_id) == 'running'
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return item_id, before

    item_id, before = anyio.run(case)
    assert loop.BOARD.active_for_item(item_id) is None
    assert [row.status for row in loop.BOARD.runs.values()] == ['stopped']
    assert anyio.run(_status, item_id) == before


def test_a_stop_after_the_point_of_no_return_is_refused(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    seen = {}
    original = loop.dispatch.foreman.implement_done

    async def finishing(db, item, *args, **kwargs):
        run_id = next(iter(loop.BOARD.runs))
        try:
            loop.stop(run_id)
            seen['stop'] = 'accepted'
        except loop.TooLate:
            seen['stop'] = 'too_late'
        return await original(db, item, *args, **kwargs)
    monkeypatch.setattr(loop.dispatch.foreman, 'implement_done', finishing)

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        return await loop.start(item_id, defn(), repo, store)

    run_id = anyio.run(case)
    assert seen == {'stop': 'too_late'}
    assert loop.BOARD.get(run_id).status == 'complete'


def test_a_run_still_starting_counts_as_the_items_run(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db)).id
        loop.BOARD.open(loop.LiveRun(run_id='other', item_id=item_id, title='t', stage='implement', agent_id='builder', status='starting',
                                     engine=None, harness=None, cancel=asyncio.Event(), steering=[]))
        with pytest.raises(loop.dispatch.DispatchError):
            await loop.start(item_id, defn(), repo, store)

    anyio.run(case)


def test_the_routes_answer_a_full_queue_a_credential_a_finishing_run_and_a_bad_item_id(ready, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    run_id = '00000000-0000-0000-0000-00000000000a'
    late_id = '00000000-0000-0000-0000-00000000000b'
    row = loop.BOARD.open(loop.LiveRun(run_id=run_id, item_id='i', title='t', stage='implement', agent_id='a', status='running',
                                       engine=None, harness=None, cancel=asyncio.Event(), steering=[]))
    loop.BOARD.open(loop.LiveRun(run_id=late_id, item_id='j', title='t', stage='implement', agent_id='a', status='finishing',
                                 engine=None, harness=None, cancel=asyncio.Event(), steering=[]))
    with TestClient(app) as client:
        secret = client.post(f'/factory/runs/{run_id}/steer', json={'text': 'use ghp_' + 'a' * 36}, headers=HUMAN)
        assert secret.status_code == 422 and secret.json()['detail']['code'] == 'looks_secret'
        row.steering.extend(['x'] * loop.MAX_STEERING)
        full = client.post(f'/factory/runs/{run_id}/steer', json={'text': 'hi'}, headers=HUMAN)
        assert full.status_code == 429 and full.json()['detail']['code'] == 'steering_full'
        for action, body in (('stop', None), ('steer', {'text': 'hi'})):
            late = client.post(f'/factory/runs/{late_id}/{action}', json=body, headers=HUMAN)
            assert late.status_code == 409 and late.json()['detail']['code'] == 'too_late', action
        assert client.post('/factory/work-items/bad id!/run', json={'repo': '/tmp/x'}, headers=HUMAN).status_code == 422
        assert client.post('/factory/work-items/' + 'a' * 201 + '/run', json={'repo': '/tmp/x'}, headers=HUMAN).status_code == 422


# ------------------------------------------------------------------------------------- the run goes to the repository of the item's Forja

def _forja_project(root: Path, name: str) -> Path:
    import sys as _sys
    _sys.path.insert(0, str(Path(__file__).parents[1] / 'factory_definition'))
    from factory_definition_files import FILES
    for rel, text in FILES.items():
        target = root / '.oharness' / 'forja' / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(text.replace('name: payments', f'name: {name}', 1) if rel == 'forja.yaml' else text, encoding='utf-8')
    return root


def test_the_run_goes_only_to_a_project_of_the_items_forja(ready, monkeypatch, tmp_path):
    from models import CoworkProject
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    mine = _forja_project(tmp_path / 'mine', 'payments')
    theirs = _forja_project(tmp_path / 'theirs', 'other')
    (tmp_path / 'plain').mkdir()

    async def register():
        async with SessionLocal() as db:
            for folder in (mine, theirs, tmp_path / 'plain'):
                db.add(CoworkProject(name=folder.name, root_path=str(folder)))
            await db.commit()
            return (await _item(db, 'repo-1')).id

    async def unregister():
        async with SessionLocal() as db:
            await db.execute(delete(CoworkProject).where(CoworkProject.root_path.in_([str(mine), str(theirs), str(tmp_path / 'plain')])))
            await db.commit()

    item_id = anyio.run(register)
    try:
        with TestClient(app) as client:
            assert client.get(f'/factory/work-items/{item_id}/repositories').status_code == 403
            listed = client.get(f'/factory/work-items/{item_id}/repositories', headers=HUMAN)
            assert listed.status_code == 200, listed.text
            assert [row['root_path'] for row in listed.json()['repositories']] == [str(mine)]
            for folder in (theirs, tmp_path / 'plain'):
                wrong = client.post(f'/factory/work-items/{item_id}/run', json={'repo': str(folder)}, headers=HUMAN)
                assert wrong.status_code == 409 and wrong.json()['detail']['code'] == 'wrong_repository', folder
    finally:
        anyio.run(unregister)


def test_when_the_error_handler_itself_fails_the_item_still_gets_its_status_back(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)

    async def boom(run):
        raise ValueError('the agent broke')

    async def handler_breaks(*_args, **_kwargs):
        raise RuntimeError('the checkpoint could not be written')
    monkeypatch.setattr(loop.dispatch.service, 'request_checkpoint', handler_breaks)

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db, 'handler-1')).id
        before = await _status(item_id)
        with pytest.raises(RuntimeError):
            await loop.start(item_id, defn(), repo, store, driver=boom)
        return item_id, before

    item_id, before = anyio.run(case)
    assert before != 'running' and anyio.run(_status, item_id) == before
    assert loop.BOARD.active_for_item(item_id) is None


def test_a_cancel_before_the_stage_body_still_gives_the_item_its_status_back(ready, store, tmp_path, monkeypatch):
    repo = _repo(tmp_path, monkeypatch)
    reached = asyncio.Event()
    original = loop.dispatch.service.link_run

    async def link_then_hang(db, item, *args, **kwargs):
        await original(db, item, *args, **kwargs)
        item.status = 'running'
        await db.commit()
        reached.set()
        await asyncio.Event().wait()
    monkeypatch.setattr(loop.dispatch.service, 'link_run', link_then_hang)

    async def case():
        async with SessionLocal() as db:
            item_id = (await _item(db, 'cancel-early')).id
        before = await _status(item_id)
        task = asyncio.create_task(loop.start(item_id, defn(), repo, store))
        await asyncio.wait_for(reached.wait(), timeout=30)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        return item_id, before

    item_id, before = anyio.run(case)
    assert anyio.run(_status, item_id) == before
    assert loop.BOARD.active_for_item(item_id) is None


def test_the_forja_of_a_project_is_read_again_only_when_its_file_changes(tmp_path, monkeypatch):
    from factory import runs_router
    root = _forja_project(tmp_path / 'cached', 'payments')
    runs_router._FORJA_NAMES.clear()
    calls = []
    original = runs_router.definition_files.load

    def counted(folder):
        calls.append(folder)
        return original(folder)
    monkeypatch.setattr(runs_router.definition_files, 'load', counted)
    assert runs_router._forja_of(str(root)) == 'payments'
    assert runs_router._forja_of(str(root)) == 'payments'
    assert len(calls) == 1
    forja = root / '.oharness' / 'forja' / 'forja.yaml'
    forja.write_text(forja.read_text(encoding='utf-8').replace('name: payments', 'name: billing', 1) + '\n', encoding='utf-8')
    assert runs_router._forja_of(str(root)) == 'billing'
    assert len(calls) == 2
