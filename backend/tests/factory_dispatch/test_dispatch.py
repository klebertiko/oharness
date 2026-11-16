"""The Forja runs a stage for real (ADR 0057, #440): worktree per run, secrets by reference, redacted journal, token ceiling, pool.

The agent is a fake: a function that drives the run through `StageRun` the way a model tool loop would. No network, no provider.
"""
from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import anyio
import pytest
from sqlalchemy import delete, select

from database import SessionLocal, init_db
from factory import dispatch, runner, service
from factory.models import WorkItemCreate
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory.secrets_orm import SecretIndex
from models import RunEvent
from secret_store.memory import MemorySecrets
from workspaces.service import WorkspaceService

VALUE = 'Zq9-' + 'k3Lm' * 4  # a secret value no pattern recognises
COMMIT = ['git', '-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-q', '--allow-empty', '-m', 'work']


def agent(role, secrets=None, mode='workspace_write'):
    return {'role': role, 'model': 'openai/gpt-4o', 'harness': None, 'enabled': True, 'permissions': {'mode': mode}, 'skills': [], 'mcp': [],
            'secrets': secrets or [], 'localSkills': {}, 'instructions': 'x', 'memory': {}}


def defn(limit=2):
    return {'name': 'payments', 'policy': {'requireSpec': False, 'specApproval': 'required', 'maxReviewReturns': 2, 'reviewIndependence': 'require',
                                           'maxPermissionMode': 'workspace_write'},
            'stages': {'review': {'required': True}}, 'tiers': {'deep': {'models': ['openai/gpt-4o']}},
            'ceilings': {'tokensPerRun': 100000, 'tokensPerWorkItem': 500000},
            'repositories': [{'id': 'app', 'path': '.', 'protectedBranches': ['main', 'release/*']}],
            'runners': {'main': {'type': 'local', 'maxConcurrentRuns': limit, 'credentialStrategy': 'forja'}},
            'agents': {'builder': agent('implement', ['forja/npm-token']), 'reviewer': agent('review', mode='read_only')}}


def assignment(max_tokens=1000):
    return {'agent': 'builder', 'model': 'openai/gpt-4o', 'harness': None, 'context': ['spec'], 'maxTokens': max_tokens}


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
    return git, repo


async def _reset():
    async with SessionLocal() as db:
        for table in (RunEvent, WorkItemEvent, WorkItemRun, WorkItemArtifact, WorkItem, SecretIndex):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def db_ready():
    anyio.run(init_db)
    yield
    anyio.run(_reset)


@pytest.fixture()
def store():
    s = MemorySecrets()
    s.put('forja/npm-token', VALUE)
    return s


async def _item_at_implement(db, ref='r1'):
    item, *_ = await service.create(db, WorkItemCreate(factory_id='payments', title='Fix login', source={'kind': 'manual', 'ref': ref},
                                                       origin_context={'text': 'It breaks.'}))
    await service.enter_stage(db, item, 'implement', ('system', None))
    await db.commit()
    return item


async def _journal(db, run_id):
    rows = await db.scalars(select(RunEvent).where(RunEvent.run_id == run_id).order_by(RunEvent.sequence))
    return [(e.event_type, json.loads(e.data_json)) for e in rows]


async def _everything_written(db, item, run_id):
    events = [e.data_json for e in await service.events(db, item.id, 0, 500)]
    arts = [str(a.ref) + str(a.label) for a in (await db.scalars(select(WorkItemArtifact).where(WorkItemArtifact.work_item_id == item.id))).all()]
    return json.dumps(await _journal(db, run_id)) + ''.join(events) + ''.join(arts)


def go(coro_fn):
    async def inner():
        async with SessionLocal() as db:
            return await coro_fn(db)
    return anyio.run(inner)


def test_an_implement_run_works_in_its_own_worktree_and_hands_the_branch_to_the_foreman(db_ready, store, tmp_path, monkeypatch):
    git, repo = _repo(tmp_path, monkeypatch)
    seen = {}

    async def fake_agent(run):
        seen['cwd'] = run.workspace['path']
        committed = await run.tool(COMMIT)
        assert committed['ok'], committed
        run.spend(300)

    async def case(db):
        item = await _item_at_implement(db)
        run_id = await dispatch.run_stage(db, item, defn(), 'implement', assignment(), fake_agent, store, runner.RunnerPool(2), repo)
        await db.refresh(item)
        links = (await db.scalars(select(WorkItemRun).where(WorkItemRun.work_item_id == item.id))).all()
        arts = (await db.scalars(select(WorkItemArtifact).where(WorkItemArtifact.work_item_id == item.id))).all()
        return item, run_id, links, arts, await _journal(db, run_id)

    item, run_id, links, arts, journal = go(case)
    branch = f'forja/{item.id}-{run_id}'
    assert [(link.run_id, link.stage, link.agent_id) for link in links] == [(run_id, 'implement', 'builder')]
    assert Path(seen['cwd']).resolve() != repo.resolve()
    assert git.run(repo, ['rev-parse', '--verify', f'refs/heads/{branch}']).text().strip()
    assert any(a.kind == 'diff' and branch in str(a.ref) for a in arts)
    assert item.stage == 'review' and item.cost_tokens == 300
    assert journal[-1][0] == 'harness_done' and journal[-1][1]['status'] == 'complete'


def test_secrets_reach_the_agent_only_by_reference_and_never_the_journal_events_or_artifacts(db_ready, store, tmp_path, monkeypatch):
    _, repo = _repo(tmp_path, monkeypatch)

    async def fake_agent(run):
        shown = await run.tool([sys.executable, '-c', 'import os;print(os.environ["FORJA_SECRET_NPM_TOKEN"])'])
        assert '[redacted' in shown['result'] and VALUE not in shown['result']
        await run.note(f'the token is {VALUE}')
        await run.tool(COMMIT)

    async def case(db):
        item = await _item_at_implement(db)
        run_id = await dispatch.run_stage(db, item, defn(), 'implement', assignment(), fake_agent, store, runner.RunnerPool(1), repo)
        return await _everything_written(db, item, run_id)

    written = go(case)
    assert 'FORJA_SECRET_NPM_TOKEN' in written or 'redacted' in written  # the run did happen and was journaled
    assert VALUE not in written


def test_a_run_over_its_token_ceiling_stops_and_the_item_waits_for_a_person(db_ready, store, tmp_path, monkeypatch):
    _, repo = _repo(tmp_path, monkeypatch)

    async def greedy(run):
        run.spend(600)
        run.spend(600)  # 1200 > maxTokens 1000
        await run.tool(COMMIT)  # never reached

    async def case(db):
        item = await _item_at_implement(db)
        run_id = await dispatch.run_stage(db, item, defn(), 'implement', assignment(1000), greedy, store, runner.RunnerPool(1), repo)
        await db.refresh(item)
        return item, await _journal(db, run_id), [e.type for e in await service.events(db, item.id, 0, 500)]

    item, journal, types = go(case)
    assert item.stage == 'implement' and item.status == 'awaiting_human'
    assert 'checkpoint_requested' in types and 'artifact_added' not in types
    assert journal[-1][0] == 'harness_done' and journal[-1][1]['status'] == 'error'
    assert item.cost_tokens >= 600


def test_a_crashing_agent_fails_the_run_without_leaking_the_error_secret(db_ready, store, tmp_path, monkeypatch):
    _, repo = _repo(tmp_path, monkeypatch)

    async def crash(run):
        raise RuntimeError(f'boom {VALUE}')

    async def case(db):
        item = await _item_at_implement(db)
        run_id = await dispatch.run_stage(db, item, defn(), 'implement', assignment(), crash, store, runner.RunnerPool(1), repo)
        await db.refresh(item)
        return item, await _everything_written(db, item, run_id)

    item, written = go(case)
    assert item.status == 'awaiting_human' and VALUE not in written


def test_the_push_guard_is_built_in_and_the_definition_cannot_turn_it_off(db_ready, store, tmp_path, monkeypatch):
    _, repo = _repo(tmp_path, monkeypatch)
    results = {}

    async def pushy(run):
        results['push'] = await run.tool(['git', 'push', 'origin', 'main'])
        results['merge'] = await run.tool(['gh', 'pr', 'merge', '1'])
        await run.tool(COMMIT)

    definition = defn()
    definition['policy']['pushGuard'] = 'off'  # a definition that tries to disable it

    async def case(db):
        item = await _item_at_implement(db)
        return await _journal(db, await dispatch.run_stage(db, item, definition, 'implement', assignment(), pushy, store, runner.RunnerPool(1), repo))

    journal = go(case)
    assert results['push']['ok'] is False and results['merge']['ok'] is False
    assert any(kind == 'tool_result' and data.get('ok') is False for kind, data in journal)


def test_the_pool_comes_from_the_definition_and_a_run_waits_for_its_slot(db_ready, store, tmp_path, monkeypatch):
    _, repo = _repo(tmp_path, monkeypatch)
    pool = dispatch.pool_for(defn(limit=1))
    assert isinstance(pool, runner.RunnerPool)
    live = []

    async def slow(run):
        live.append(pool.running)
        await asyncio.sleep(0.05)
        await run.tool(COMMIT)

    async def case():
        async with SessionLocal() as db1, SessionLocal() as db2:
            one, two = await _item_at_implement(db1, 'a'), await _item_at_implement(db2, 'b')
            await asyncio.gather(dispatch.run_stage(db1, one, defn(), 'implement', assignment(), slow, store, pool, repo),
                                 dispatch.run_stage(db2, two, defn(), 'implement', assignment(), slow, store, pool, repo))

    anyio.run(case)
    assert live == [1, 1]  # never two at once with maxConcurrentRuns 1


def test_a_stage_the_item_is_not_at_is_refused_before_anything_is_created(db_ready, store, tmp_path, monkeypatch):
    _, repo = _repo(tmp_path, monkeypatch)

    async def never(run):
        raise AssertionError('must not run')

    async def case(db):
        item = await _item_at_implement(db)
        with pytest.raises(dispatch.DispatchError):
            await dispatch.run_stage(db, item, defn(), 'review', assignment(), never, store, runner.RunnerPool(1), repo)
        return len((await db.scalars(select(WorkItemRun))).all())

    assert go(case) == 0
