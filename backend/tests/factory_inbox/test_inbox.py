"""Inbox of human decisions: derived from the work items, so an entry leaves by itself when it stops being true (ADR 0058)."""
from __future__ import annotations

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from database import SessionLocal
from factory import service
from factory.inbox_orm import InboxDismissal
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from main import app

HUMAN = {'x-oharness-human': 'human-secret'}


async def _reset():
    async with SessionLocal() as db:
        for table in (InboxDismissal, WorkItemEvent, WorkItemRun, WorkItemArtifact, WorkItem):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as c:
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


def make(client, ref='r1', factory='payments'):
    resp = client.post('/factory/work-items', json={'factory_id': factory, 'title': f'Item {ref}', 'source': {'kind': 'manual', 'ref': ref}})
    assert resp.status_code == 201, resp.text
    return resp.json()['id']


def drive(item_id, fn):
    async def go():
        async with SessionLocal() as db:
            item = await service.get(db, item_id)
            await fn(db, item)
            await db.commit()
    anyio.run(go)


def inbox(client, **params):
    return client.get('/factory/inbox', params=params).json()


def kinds(client, **params):
    return sorted(e['type'] for e in inbox(client, **params)['entries'])


async def ask(db, item, text='Which environment?'):
    await service.enter_stage(db, item, 'triage', ('foreman', 'foreman'))
    await service.request_checkpoint(db, item, ('foreman', 'foreman'), 'question', text)


async def spec_ready(db, item):
    await service.enter_stage(db, item, 'spec', ('foreman', 'foreman'))
    item.spec_text, item.spec_revision = 'Do X.', 1
    await service.request_checkpoint(db, item, ('foreman', 'foreman'), 'spec')


async def handoff(db, item):
    service._move(item, 'handoff', 'waiting_merge')
    await service.add_event(db, item, 'checkpoint_requested', ('foreman', 'foreman'), {'kind': 'handoff'})


def test_an_empty_inbox_has_a_zero_count(client):
    assert inbox(client) == {'entries': [], 'count': 0}


def test_each_kind_of_wait_is_one_entry_with_what_to_do(client):
    q, s, h = make(client, 'q'), make(client, 's'), make(client, 'h')
    drive(q, ask)
    drive(s, spec_ready)
    drive(h, handoff)
    body = inbox(client)
    by_item = {e['work_item_id']: e for e in body['entries']}
    assert body['count'] == 3
    assert by_item[q]['type'] == 'question' and by_item[q]['summary'] == 'Which environment?' and by_item[q]['actions'] == ['answer']
    assert by_item[s]['type'] == 'spec_review' and set(by_item[s]['actions']) == {'approve_spec', 'edit_spec'}
    assert by_item[h]['type'] == 'handoff_ready' and set(by_item[h]['actions']) == {'confirm_merged', 'request_changes'}
    assert all(e['title'].startswith('Item ') and e['since'] for e in body['entries'])


def test_an_entry_leaves_by_itself_when_it_stops_being_true(client):
    q = make(client)
    drive(q, ask)
    assert kinds(client) == ['question']
    client.post(f'/factory/work-items/{q}/actions', json={'action': 'answer', 'text': 'staging'}, headers=HUMAN)
    assert 'question' not in kinds(client)  # answered: no longer waiting
    client.post(f'/factory/work-items/{q}/actions', json={'action': 'cancel'}, headers=HUMAN)
    assert kinds(client) == []


def test_an_answer_given_elsewhere_is_shown_once_as_information(client):
    q = make(client)
    drive(q, ask)
    client.post(f'/factory/work-items/{q}/actions', json={'action': 'answer', 'text': 'staging'}, headers=HUMAN)
    assert kinds(client, include_info='true') == ['question_answered']
    drive(q, lambda db, item: service.enter_stage(db, item, 'spec', ('foreman', 'foreman')))  # the work moved on
    assert kinds(client, include_info='true') == []


def test_blocked_and_failed_show_only_when_nothing_else_waits(client):
    stuck, failed, asking = make(client, 'stuck'), make(client, 'failed'), make(client, 'asking')

    async def block(db, item):
        service._move(item, 'implement', 'awaiting_human')

    async def fail(db, item):
        service._move(item, 'verify', 'failed')
        await service.add_event(db, item, 'failed', ('foreman', 'foreman'), {'reason': 'x'})
    drive(stuck, block)
    drive(failed, fail)
    drive(asking, ask)
    entries = {e['work_item_id']: e['type'] for e in inbox(client)['entries']}
    assert entries == {stuck: 'blocked', failed: 'failed', asking: 'question'}  # the question item is a question, not also blocked


def test_manual_resolve_hides_the_entry_and_undo_brings_it_back(client):
    q = make(client)
    drive(q, ask)
    entry = inbox(client)['entries'][0]
    assert client.post(f"/factory/inbox/{entry['id']}/resolve").status_code == 403  # a personal queue: the human credential
    assert client.post(f"/factory/inbox/{entry['id']}/resolve", headers=HUMAN).status_code == 204
    assert kinds(client) == [] and inbox(client)['count'] == 0
    assert kinds(client, include_resolved='true') == ['question']
    assert client.delete(f"/factory/inbox/{entry['id']}/resolve", headers=HUMAN).status_code == 204  # undo
    assert kinds(client) == ['question']
    assert client.post('/factory/inbox/question:nope:1/resolve', headers=HUMAN).status_code == 404


def test_a_new_question_on_the_same_item_is_a_new_entry(client):
    q = make(client)
    drive(q, ask)
    first = inbox(client)['entries'][0]
    client.post(f"/factory/inbox/{first['id']}/resolve", headers=HUMAN)
    client.post(f'/factory/work-items/{q}/actions', json={'action': 'answer', 'text': 'staging'}, headers=HUMAN)

    async def again(db, item):
        await service.request_checkpoint(db, item, ('foreman', 'foreman'), 'question', 'And the region?')
    drive(q, again)
    entries = inbox(client)['entries']
    assert [e['summary'] for e in entries] == ['And the region?'] and entries[0]['id'] != first['id']


def test_the_inbox_filters_by_factory_and_orders_newest_first(client):
    a, b, c = make(client, 'a'), make(client, 'b'), make(client, 'c', factory='billing')
    for item in (a, b, c):
        drive(item, ask)
    ordered = [e['work_item_id'] for e in inbox(client, factory_id='payments')['entries']]
    assert ordered == [b, a] and inbox(client)['count'] == 3
    assert [e['work_item_id'] for e in inbox(client, factory_id='billing')['entries']] == [c]


def test_the_inbox_only_reads_it_never_decides(client):
    q = make(client)
    drive(q, ask)
    before = client.get(f'/factory/work-items/{q}').json()['status']
    inbox(client)
    assert client.get(f'/factory/work-items/{q}').json()['status'] == before == 'awaiting_human'
