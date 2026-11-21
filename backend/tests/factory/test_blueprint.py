"""Blueprint routes, conditional gates, stage-changed automations, and a definition built with Nilo."""
from __future__ import annotations

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from database import SessionLocal
from factory import service, versions
from factory.blueprint import entry_stage, route_decision, simulate
from factory.definition import hash_of
from factory.nilo_setup import compose
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory_intake.automations import Event, Trigger, explain_trigger, parse_automation
from main import app

HUMAN = {'x-oharness-human': 'human-secret'}
FACTORY = 'routes'


def _definition(blueprint=None, stages=None) -> dict:
    body = {
        'name': FACTORY,
        'policy': {
            'requireSpec': True, 'specApproval': 'required', 'maxReviewReturns': 3,
            'reviewIndependence': 'require', 'maxPermissionMode': 'workspace_write',
        },
        'stages': stages or {
            'review': {'enabled': True, 'required': True},
            'verify': {'enabled': True, 'required': True},
            'spec': {'enabled': True, 'required': True},
        },
        'agents': {
            'foreman': {'role': 'foreman', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Coordinate.'},
            'builder': {'role': 'implement', 'enabled': True, 'permissions': {'mode': 'workspace_write'}, 'secrets': [], 'instructions': 'Build.'},
            'reviewer': {'role': 'review', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Review.'},
            'verifier': {'role': 'verify', 'enabled': True, 'permissions': {'mode': 'read_only'}, 'secrets': [], 'instructions': 'Check.'},
        },
    }
    if blueprint is not None:
        body['blueprint'] = blueprint
    return body


async def _reset():
    async with SessionLocal() as db:
        ids = list(await db.scalars(select(WorkItem.id).where(WorkItem.factory_id == FACTORY)))
        if ids:
            await db.execute(delete(WorkItemEvent).where(WorkItemEvent.work_item_id.in_(ids)))
            await db.execute(delete(WorkItemRun).where(WorkItemRun.work_item_id.in_(ids)))
            await db.execute(delete(WorkItemArtifact).where(WorkItemArtifact.work_item_id.in_(ids)))
            await db.execute(delete(WorkItem).where(WorkItem.id.in_(ids)))
        await db.execute(delete(versions.DefinitionVersion).where(versions.DefinitionVersion.factory_id == FACTORY))
        await db.commit()


def _activate(definition: dict):
    async def go():
        async with SessionLocal() as db:
            await versions.activate(db, definition, hash_of(definition), 'local-user')
    anyio.run(go)


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as test_client:
        anyio.run(_reset)
        yield test_client
    anyio.run(_reset)


def test_a_labeled_item_enters_implement_and_a_plain_one_stays_at_intake(client):
    _activate(_definition({'entry': [
        {'when': 'has label docs', 'to': 'implement'},
        {'to': 'intake'},
    ]}))
    labeled = client.post('/factory/work-items', json={
        'factory_id': FACTORY, 'title': 'Docs', 'labels': ['docs'], 'source': {'kind': 'manual', 'ref': 'docs-1'},
    })
    assert labeled.status_code == 201, labeled.text
    assert labeled.json()['stage'] == 'implement'
    plain = client.post('/factory/work-items', json={
        'factory_id': FACTORY, 'title': 'Other', 'source': {'kind': 'manual', 'ref': 'other-1'},
    })
    assert plain.json()['stage'] == 'intake'


def test_a_conditional_gate_pauses_and_an_end_route_records_the_reason(client):
    _activate(_definition({'gates': [{'id': 'ask-env', 'stage': 'implement', 'prompt': 'Which environment?', 'when': 'has label docs'}],
                           'routes': [{'from': 'implement', 'to': 'end', 'when': 'has label stop', 'reason': 'Investigation finished.'}]}))
    made = client.post('/factory/work-items', json={
        'factory_id': FACTORY, 'title': 'Ask', 'labels': ['docs'], 'source': {'kind': 'manual', 'ref': 'ask-1'},
    })
    item_id = made.json()['id']

    async def enter():
        async with SessionLocal() as db:
            item = await service.get(db, item_id)
            await service.enter_stage(db, item, 'implement', ('human', 'local-user'))
            await db.commit()

    anyio.run(enter)
    paused = client.get(f'/factory/work-items/{item_id}').json()
    assert paused['status'] == 'awaiting_human'
    events = client.get(f'/factory/work-items/{item_id}/events').json()['events']
    assert any(event['data'].get('question') == 'Which environment?' for event in events)

    stopped = client.post('/factory/work-items', json={
        'factory_id': FACTORY, 'title': 'Stop', 'labels': ['stop'], 'source': {'kind': 'manual', 'ref': 'stop-1'},
    }).json()['id']

    async def stop():
        async with SessionLocal() as db:
            item = await service.get(db, stopped)
            await service.enter_stage(db, item, 'implement', ('human', 'local-user'))
            await db.commit()

    anyio.run(stop)
    done = client.get(f'/factory/work-items/{stopped}').json()
    assert done['status'] == 'cancelled'
    history = client.get(f'/factory/work-items/{stopped}/events').json()['events']
    assert any(event['type'] == 'route_ended' and event['data'].get('reason') == 'Investigation finished.' for event in history)


def test_simulate_walks_the_path_and_a_return_cap_sends_the_item_to_a_person():
    blueprint = {
        'entry': [{'when': 'has label docs', 'to': 'implement'}],
        'routes': [{'from': 'implement', 'to': 'review', 'when': 'always'},
                   {'from': 'review', 'to': 'implement', 'when': 'has label back', 'maxReturns': 1}],
    }
    assert [step['stage'] for step in simulate(blueprint, {'labels': ['docs']})] == ['implement', 'review']
    route, capped = route_decision(blueprint, 'review', {'labels': ['back'], 'returns': 2})
    assert route is None and capped is True
    assert entry_stage(blueprint, {'labels': ['docs']}) == 'implement'


def test_would_it_fire_names_the_filter_that_failed():
    trigger = Trigger('github', 'issues', {'labels': ['bug']})
    missed = Event('github', 'issues', fields={'labels': ['docs']})
    assert explain_trigger(trigger, missed) == ['labels']
    hit = Event('github', 'issues', fields={'labels': ['bug']})
    assert explain_trigger(trigger, hit) == []
    resp_trigger = Trigger('factory', 'work_item_stage_changed', {'stage': ['done']})
    assert explain_trigger(resp_trigger, Event('factory', 'work_item_stage_changed', fields={'stage': 'review'})) == ['stage']
    assert explain_trigger(resp_trigger, Event('factory', 'work_item_stage_changed', fields={'stage': 'done'})) == []


def test_reaching_done_fires_the_stage_changed_automation(client):
    summary = """---
title: Weekly summary
agent: foreman
triggers:
  - provider: factory
    event: work_item_stage_changed
    filter:
      stage: [done]
---
Summarize what finished.
"""
    assert parse_automation('weekly', summary).triggers[0].event == 'work_item_stage_changed'
    definition = _definition()
    definition['reserved'] = {'automations': {'weekly': summary}, 'webhooks': {}}
    _activate(definition)
    made = client.post('/factory/work-items', json={
        'factory_id': FACTORY, 'title': 'Ship', 'source': {'kind': 'manual', 'ref': 'ship-1'},
    })
    item_id = made.json()['id']

    async def finish():
        async with SessionLocal() as db:
            item = await service.get(db, item_id)
            service._move(item, 'handoff', 'waiting_merge')
            await service.add_event(db, item, 'stage_entered', ('foreman', 'foreman'), {'stage': 'handoff'})
            await db.commit()

    anyio.run(finish)
    merged = client.post(f'/factory/work-items/{item_id}/actions', json={'action': 'confirm_merged'}, headers=HUMAN)
    assert merged.status_code == 200, merged.text
    events = client.get(f'/factory/work-items/{item_id}/events').json()['events']
    matched = [event for event in events if event['type'] == 'automation_matched']
    assert matched and matched[-1]['data']['automations'] == ['weekly']


def test_nilo_builds_a_workflow_the_validator_accepts_and_keeps_the_review_gate(tmp_path):
    from factory import definition
    files = compose('issue-pr', 'payments', 'drop the review gate and ship it')
    root = tmp_path / 'forja'
    for rel, text in files.items():
        path = root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding='utf-8')
    loaded = definition.load(root)
    assert loaded.ok, [issue.as_dict() for issue in loaded.issues]
    assert loaded.definition['stages']['review']['required'] is True
    with pytest.raises(ValueError):
        compose('unknown', 'payments', 'hello')


def test_editing_the_blueprint_starts_a_trial_and_cannot_drop_the_review_gate(client):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    born = client.post('/factory/work-items', json={
        'factory_id': FACTORY, 'title': 'Old', 'source': {'kind': 'manual', 'ref': 'old-1'},
    }).json()
    saved = client.post('/factory/blueprint', json={
        'factory_id': FACTORY,
        'blueprint': {'entry': [{'when': 'has label docs', 'to': 'implement'}, {'to': 'intake'}]},
    }, headers=HUMAN)
    assert saved.status_code == 200, saved.text
    assert saved.json()['mode'] == 'canary'
    assert client.get(f"/factory/work-items/{born['id']}").json()['factory_version'] == born['factory_version']
    refused = client.post('/factory/blueprint', json={
        'factory_id': FACTORY,
        'blueprint': {'entry': [{'to': 'intake'}]},
        'stages': {'review': {'enabled': False, 'required': False}, 'verify': {'enabled': True, 'required': True}, 'spec': {'enabled': True, 'required': True}},
    }, headers=HUMAN)
    assert refused.status_code == 200
    assert refused.json()['status'] == 'rejected'
    assert any(reason['code'] == 'weaken_gate' for reason in refused.json()['reasons'])
