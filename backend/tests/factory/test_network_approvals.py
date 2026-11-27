"""Integration coverage for durable human network consent and MCP launch gates."""
from __future__ import annotations

import asyncio
import copy
import json
import os
import uuid

import anyio
import httpx
import pytest
from sqlalchemy import delete, select

from database import SessionLocal, init_db
from factory import agent_mcp, auth, foreman, network_approvals, network_supervision, service
from factory.models import ActionBody, WorkItemCreate
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory.runner import RunnerError
from main import app

CURL = ['curl', '--disable', 'https://example.test/file']


def definition():
    return {'networkPolicy': {'allowedHosts': ['example.test'], 'deniedHosts': ['blocked.test']},
            'agents': {'builder': {'mcp': ['server']}, 'reader': {}},
            'mcp': {'server': {'command': 'python', 'args': ['server.py']}}}


async def reset():
    async with SessionLocal() as db:
        for table in (WorkItemEvent, WorkItemRun, WorkItemArtifact, WorkItem):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def ready(monkeypatch):
    anyio.run(init_db)
    anyio.run(reset)
    monkeypatch.setattr(auth, '_held', 'network-test-human')
    monkeypatch.delenv('OH_FACTORY_DEV_HUMAN', raising=False)
    agent_mcp.clear()
    yield
    agent_mcp.clear()
    assert not network_supervision._pending
    anyio.run(reset)


async def item(db, factory='network-test'):
    row, *_ = await service.create(db, WorkItemCreate(factory_id=factory, title='Network test',
        source={'kind': 'manual', 'ref': str(uuid.uuid4())}, origin_context={'text': 'test'}))
    await service.enter_stage(db, row, 'implement', ('system', None))
    row.status = 'running'
    await db.commit()
    return row


async def supervisor(db, row, defn=None, agent='builder'):
    journal = []
    checkpoint = asyncio.Event()

    async def record(kind, data):
        journal.append((kind, data))
        checkpoint.set()

    result = await network_approvals.make_supervisor(db, row, str(uuid.uuid4()),
        defn or definition(), agent, asyncio.Event(), lambda value: value, record)
    return result, checkpoint, journal


async def request(supervised, checkpoint, argv=CURL, kind='command'):
    checkpoint.clear()
    task = asyncio.create_task(supervised.authorize(argv, kind=kind))
    try:
        await asyncio.wait_for(checkpoint.wait(), 3)
    except BaseException:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        raise
    return task, network_supervision.item_network(supervised.item_id)['pending']


def test_http_human_once_replay_and_checkpoint_audit(ready):
    async def case():
        headers = {'Authorization': f"Bearer {os.environ['OH_SIDECAR_TOKEN']}"}
        async with SessionLocal() as db, httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                base_url='http://test', headers=headers) as client:
            row = await item(db)
            supervised, checkpoint, journal = await supervisor(db, row)
            task, pending = await request(supervised, checkpoint)
            url = f'/factory/work-items/{row.id}/network-approvals'
            body = {'request_id': pending['id'], 'decision': 'once'}
            try:
                snapshot = (await client.get(f'/factory/work-items/{row.id}')).json()
                assert snapshot['status'] == 'awaiting_human'
                assert snapshot['network']['isolation'] == 'none'
                assert snapshot['network']['pending']['argv'] == CURL
                denied = await client.post(url, json=body)
                assert denied.status_code == 403
                assert not task.done()
                accepted = await client.post(url, json=body, headers={'x-oharness-human': 'network-test-human'})
                assert accepted.status_code == 200, accepted.text
                assert await asyncio.wait_for(task, 3) is True
                replay = await client.post(url, json=body, headers={'x-oharness-human': 'network-test-human'})
                assert replay.status_code == 409
                stale = await client.post(url, json=body | {'request_id': 'expired'},
                    headers={'x-oharness-human': 'network-test-human'})
                assert stale.status_code == 409
                second, next_request = await request(supervised, checkpoint)
                assert next_request['id'] != pending['id']
                assert not second.done()  # once does not authorize the next identical invocation
                await network_approvals.decide(db, row.id, next_request['id'], 'deny', ('human', 'tester'))
                assert await asyncio.wait_for(second, 3) is False
                rows = (await db.scalars(select(WorkItemEvent).where(WorkItemEvent.work_item_id == row.id))).all()
                approvals = [json.loads(event.data_json) for event in rows if event.type == 'network_approved']
                assert len(approvals) == 1
                assert approvals[0]['decision'] == 'once'
                assert approvals[0]['isolation'] == 'none'
                assert journal[0][0] == 'network_checkpoint'
                assert journal[0][1]['isolation'] == 'none'
            finally:
                supervised.cancel.set()
                await asyncio.gather(task, return_exceptions=True)
    anyio.run(case)


def test_host_consent_survives_new_supervisor_but_is_scoped_and_scripts_need_consent(ready):
    async def case():
        async with SessionLocal() as db:
            row = await item(db)
            supervised, checkpoint, _ = await supervisor(db, row)
            task, pending = await request(supervised, checkpoint)
            await network_approvals.decide(db, row.id, pending['id'], 'host', ('human', 'tester'))
            assert await task
            next_row = await item(db)
            remembered, checkpoint, access_journal = await supervisor(db, next_row)
            assert await asyncio.wait_for(remembered.authorize(CURL), 1)
            assert await asyncio.wait_for(remembered.authorize(CURL), 1)
            assert [kind for kind, _ in access_journal] == ['network_access_approved'] * 2
            for _, access in access_journal:
                assert access['source'] == 'host-grant'
                assert access['isolation'] == 'none'
                assert access['argv'] == CURL
                assert access['run_id'] == remembered.run_id
                assert access['policy_key'] == remembered.key
            script, pending = await request(remembered, checkpoint, ['python', 'fetch.py'])
            assert pending['can_remember'] is False
            with pytest.raises(service.FactoryError) as exc:
                await network_approvals.decide(db, next_row.id, pending['id'], 'host', ('human', 'tester'))
            assert exc.value.status == 422
            await network_approvals.decide(db, next_row.id, pending['id'], 'deny', ('human', 'tester'))
            assert await script is False
            changed = copy.deepcopy(definition())
            changed['name'] = 'changed-definition'
            cases = [(await item(db, 'other-factory'), definition(), 'builder'),
                     (await item(db), definition(), 'reader'), (await item(db), changed, 'builder')]
            for scoped_row, defn, agent in cases:
                scoped, event, _ = await supervisor(db, scoped_row, defn, agent)
                assert not scoped.grants
                task, pending = await request(scoped, event)
                await network_approvals.decide(db, scoped_row.id, pending['id'], 'deny', ('human', 'tester'))
                assert await task is False
    anyio.run(case)


def test_mcp_without_supervisor_never_opens_a_process(ready, monkeypatch):
    opened = []
    monkeypatch.setattr(agent_mcp, '_open', lambda server: opened.append(server))
    async def case():
        with pytest.raises(RunnerError, match='human network approval'):
            await agent_mcp.tools_for(definition(), 'builder')
        assert opened == []
    anyio.run(case)


def test_mcp_requires_fresh_consent_and_network_deny_prevents_launch(ready, monkeypatch):
    opened = []
    transport = agent_mcp.MemoryTransport(lambda method, params: {'result':
        {'tools': [{'name': 'read'}]} if method == 'tools/list' else {}})
    def open_transport(server):
        opened.append(server)
        return transport
    monkeypatch.setattr(agent_mcp, '_open', open_transport)

    async def case():
        async with SessionLocal() as db:
            row = await item(db)
            supervised, checkpoint, _ = await supervisor(db, row)
            task = asyncio.create_task(agent_mcp.tools_for(definition(), 'builder', supervisor=supervised))
            await asyncio.wait_for(checkpoint.wait(), 3)
            pending = network_supervision.item_network(row.id)['pending']
            assert not pending['can_remember']
            assert opened == []
            await network_approvals.decide(db, row.id, pending['id'], 'once', ('human', 'tester'))
            assert await asyncio.wait_for(task, 3) == ['read']
            assert len(opened) == 1
            checkpoint.clear()
            second = asyncio.create_task(agent_mcp.tools_for(definition(), 'builder', supervisor=supervised))
            await asyncio.wait_for(checkpoint.wait(), 3)
            next_request = network_supervision.item_network(row.id)['pending']
            assert next_request['id'] != pending['id']
            assert len(opened) == 1
            await network_approvals.decide(db, row.id, next_request['id'], 'deny', ('human', 'tester'))
            with pytest.raises(RunnerError, match='human network approval'):
                await asyncio.wait_for(second, 3)
            assert len(opened) == 1
            denied = definition()
            denied['mcp']['server']['args'] = ['https://blocked.test/server.py']
            blocked, _, journal = await supervisor(db, await item(db), denied)
            with pytest.raises(RunnerError, match='human network approval'):
                await agent_mcp.tools_for(denied, 'builder', supervisor=blocked)
            assert len(opened) == 1
            assert journal == []
    anyio.run(case)


def test_cancelled_live_request_cannot_be_approved_or_remembered(ready):
    async def case():
        async with SessionLocal() as db:
            row = await item(db)
            supervised, checkpoint, _ = await supervisor(db, row)
            task, pending = await request(supervised, checkpoint)
            item_id = row.id
            network_supervision.cancel_for_item(item_id)
            assert await asyncio.wait_for(task, 3) is False
            with pytest.raises(service.FactoryError) as exc:
                await network_approvals.decide(db, item_id, pending['id'], 'host', ('human', 'tester'))
            assert exc.value.status == 409
            assert await asyncio.wait_for(task, 3) is False
            assert supervised.grants == set()
            events = (await db.scalars(select(WorkItemEvent).where(
                WorkItemEvent.work_item_id == item_id, WorkItemEvent.type == 'network_approved'))).all()
            assert events == []
    anyio.run(case)


@pytest.mark.parametrize('parked', [False, True])
def test_stop_expiration_closes_only_the_matching_run_and_allows_queued_resume(ready, parked):
    async def case():
        async with SessionLocal() as db:
            row = await item(db)
            supervised, checkpoint, _ = await supervisor(db, row)
            task, pending = await request(supervised, checkpoint)
            try:
                if parked:
                    await service.apply_action(db, row, ActionBody(action='park'), ('human', 'tester'))
                    await db.commit()
                assert not await network_approvals.expire(db, row, 'different-run')
                assert await service._open_question(db, row) is not None
                network_supervision.cancel_for_item(row.id)
                assert await asyncio.wait_for(task, 3) is False
                assert await network_approvals.expire(db, row, supervised.run_id)
                await db.commit()
                assert await service._open_question(db, row) is None
                if parked:
                    assert row.status == 'parked'
                    assert row.parked_from == 'queued'
                    await service.apply_action(db, row, ActionBody(action='resume'), ('human', 'tester'))
                    await db.commit()
                assert row.status == 'queued'
                assert not await network_approvals.expire(db, row, supervised.run_id)
                with pytest.raises(service.FactoryError) as exc:
                    await network_approvals.decide(db, row.id, pending['id'], 'once', ('human', 'tester'))
                assert exc.value.status == 409
                assert not supervised.grants
            finally:
                supervised.cancel.set()
                await asyncio.gather(task, return_exceptions=True)
    anyio.run(case)


@pytest.mark.parametrize('parked', [False, True])
def test_restart_recovery_expires_network_question_and_never_reuses_approval(ready, parked):
    async def case():
        async with SessionLocal() as db:
            row = await item(db)
            supervised, checkpoint, _ = await supervisor(db, row)
            task, pending = await request(supervised, checkpoint)
            # Losing the live coroutine leaves its committed checkpoint behind on restart.
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            assert network_supervision.item_network(row.id)['pending'] is None
            if parked:
                await service.apply_action(db, row, ActionBody(action='park'), ('human', 'tester'))
                await db.commit()
            item_id = row.id
        async with SessionLocal() as recovered_db:
            assert await foreman.recover_items(recovered_db) == 1
            recovered = await service.get(recovered_db, item_id)
            if parked:
                assert recovered.status == 'parked'
                assert recovered.parked_from == 'queued'
                assert await service._open_question(recovered_db, recovered) is None
                await service.apply_action(recovered_db, recovered, ActionBody(action='resume'), ('human', 'tester'))
            else:
                assert recovered.status == 'awaiting_human'
                question = await service._open_question(recovered_db, recovered)
                question_data = json.loads(question.data_json)
                assert 'network_request' not in question_data
                assert question_data['question_id'] != pending['id']
                await service.apply_action(recovered_db, recovered,
                    ActionBody(action='answer', text='Start a new run', question_id=question_data['question_id']),
                    ('human', 'tester'))
            await recovered_db.commit()
            assert recovered.status == 'queued'
            with pytest.raises(service.FactoryError) as exc:
                await network_approvals.decide(recovered_db, item_id, pending['id'], 'host', ('human', 'tester'))
            assert exc.value.status == 409
            assert await foreman.recover_items(recovered_db) == 0
            assert recovered.status == 'queued'
            replacement, _, _ = await supervisor(recovered_db, recovered)
            assert replacement.grants == set()
            events = (await recovered_db.scalars(select(WorkItemEvent).where(
                WorkItemEvent.work_item_id == item_id, WorkItemEvent.type == 'checkpoint_resolved'))).all()
            expired = [json.loads(event.data_json) for event in events if json.loads(event.data_json).get('expired')]
            assert len(expired) == 1
            assert expired[0]['question_id'] == pending['id']
    anyio.run(case)


@pytest.mark.parametrize('action', ['cancel', 'park'])
def test_service_action_directly_wakes_pending_supervisor_without_router(ready, action):
    async def case():
        async with SessionLocal() as db:
            row = await item(db)
            item_id = row.id
            supervised, checkpoint, journal = await supervisor(db, row)
            task, pending = await request(supervised, checkpoint)
            try:
                await service.apply_action(db, row, ActionBody(action=action), ('human', 'tester'))
                assert await asyncio.wait_for(task, 3) is False
                assert supervised.cancel.is_set()
                assert network_supervision.item_network(item_id)['pending'] is None
                assert supervised.grants == set()
                with pytest.raises(service.FactoryError) as exc:
                    await network_approvals.decide(db, item_id, pending['id'], 'host', ('human', 'tester'))
                assert exc.value.status == 409
                persisted = await service.get(db, item_id)
                assert persisted.status == ('cancelled' if action == 'cancel' else 'parked')
                events = (await db.scalars(select(WorkItemEvent).where(
                    WorkItemEvent.work_item_id == item_id, WorkItemEvent.type == 'network_approved'))).all()
                assert events == []
                assert not any(kind == 'network_access_approved' for kind, _ in journal)
            finally:
                supervised.cancel.set()
                await asyncio.gather(task, return_exceptions=True)
    anyio.run(case)
