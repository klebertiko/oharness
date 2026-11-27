"""A work item created from the command line shows up, moves when a checkpoint advances, and groups in the inbox."""
from __future__ import annotations

import argparse

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from database import SessionLocal
from factory import service
from factory.inbox import group_entries
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory.port_adapter import ForjaPort
from factory_intake import factory_cli
from main import app

HUMAN = {'x-oharness-human': 'human-secret'}
REF = 'p1-cli-flow'


async def _reset():
    async with SessionLocal() as db:
        ids = list(await db.scalars(select(WorkItem.id).where(WorkItem.source_ref == f'cli:{REF}')))
        if ids:
            await db.execute(delete(WorkItemEvent).where(WorkItemEvent.work_item_id.in_(ids)))
            await db.execute(delete(WorkItemRun).where(WorkItemRun.work_item_id.in_(ids)))
            await db.execute(delete(WorkItemArtifact).where(WorkItemArtifact.work_item_id.in_(ids)))
            await db.execute(delete(WorkItem).where(WorkItem.id.in_(ids)))
            await db.commit()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as test_client:
        anyio.run(_reset)
        yield test_client
    anyio.run(_reset)


def test_cli_item_lands_in_intake_moves_on_advance_and_groups_in_the_inbox(client, capsys):
    port = ForjaPort('payments')
    try:
        code = factory_cli.run(argparse.Namespace(factory_cmd='submit', json=True, title='From the command line', note='a note', ref=REF), port)
        assert code == 0
    finally:
        port.close()
    items = client.get('/factory/work-items').json()['items']
    item = next(row for row in items if row['source']['ref'] == f'cli:{REF}')
    assert item['source']['kind'] == 'cli' and item['stage'] == 'intake'
    for _ in range(2):
        moved = client.post(f"/factory/work-items/{item['id']}/actions", json={'action': 'advance'}, headers=HUMAN)
        assert moved.status_code == 200, moved.text
    assert moved.json()['stage'] == 'spec'

    async def ask():
        async with SessionLocal() as db:
            row = await service.get(db, item['id'])
            await service.request_checkpoint(db, row, ('foreman', 'foreman'), 'question', 'Which environment?')
            await db.commit()

    anyio.run(ask)
    body = client.get('/factory/inbox').json()
    groups = group_entries([entry for entry in body['entries'] if entry['work_item_id'] == item['id']])
    assert len(groups) == 1 and groups[0]['title'] == 'From the command line'
    assert {entry['type'] for entry in groups[0]['entries']} == {'question'}
    entry_id = groups[0]['entries'][0]['id']
    resolved = client.post(f'/factory/inbox/{entry_id}/resolve', headers=HUMAN)
    assert resolved.status_code == 204
    hidden = client.get('/factory/inbox').json()['entries']
    assert all(entry['id'] != entry_id for entry in hidden)
    undone = client.delete(f'/factory/inbox/{entry_id}/resolve', headers=HUMAN)
    assert undone.status_code == 204
    restored = client.get('/factory/inbox').json()['entries']
    assert any(entry['id'] == entry_id and entry['resolved'] is False for entry in restored)
