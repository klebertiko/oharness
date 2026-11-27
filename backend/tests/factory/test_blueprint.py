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

from forja_improvement_defs import HUMAN, definition  # noqa: E402
FACTORY = 'routes'


def _definition(blueprint=None, stages=None, require_spec: bool = True) -> dict:
    """A complete, valid definition: the blueprint is saved through the full validator."""
    body = definition(name=FACTORY)
    body['policy']['requireSpec'] = require_spec
    if stages is not None:
        body['stages'] = stages
    elif not require_spec:
        body['stages']['spec'] = {'enabled': True, 'required': False}
    if blueprint is not None:
        body['blueprint'] = blueprint
    return body


def _state():
    async def go():
        async with SessionLocal() as db:
            return await versions.state(db, FACTORY)
    return anyio.run(go)


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


def _base() -> str:
    return _state().stable.hash


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
    ]}, require_spec=False))
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
    _activate(_definition({'entry': [{'to': 'intake'}]}, require_spec=False))
    born = client.post('/factory/work-items', json={
        'factory_id': FACTORY, 'title': 'Old', 'source': {'kind': 'manual', 'ref': 'old-1'},
    }).json()
    saved = client.post('/factory/blueprint', json={
        'factory_id': FACTORY, 'base_hash': _base(),
        'blueprint': {'entry': [{'when': 'has label docs', 'to': 'implement'}, {'to': 'intake'}]},
    }, headers=HUMAN)
    assert saved.status_code == 200, saved.text
    assert saved.json()['mode'] == 'canary'
    assert client.get(f"/factory/work-items/{born['id']}").json()['factory_version'] == born['factory_version']
    refused = client.post('/factory/blueprint', json={
        'factory_id': FACTORY, 'base_hash': _base(),
        'blueprint': {'entry': [{'to': 'intake'}]},
        'stages': {'review': {'enabled': False, 'required': False}, 'verify': {'enabled': True, 'required': True}, 'spec': {'enabled': True, 'required': False}},
    }, headers=HUMAN)
    assert refused.status_code == 200
    assert refused.json()['status'] == 'rejected'
    assert any(reason['code'] == 'weaken_gate' for reason in refused.json()['reasons'])


# ------------------------------------------------------------------------------------------------ a route never skips a required gate

def test_a_blueprint_that_skips_a_required_stage_is_refused(client):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    for blueprint in ({'entry': [{'when': 'has label docs', 'to': 'implement'}]},
                      {'routes': [{'from': 'review', 'to': 'handoff', 'when': 'always'}]}):
        resp = client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': _base(), 'blueprint': blueprint}, headers=HUMAN)
        assert resp.status_code == 200 and resp.json()['status'] == 'rejected', blueprint
        assert 'skip_required' in {reason['code'] for reason in resp.json()['reasons']}
    assert _state().canary is None


def test_an_entry_that_would_skip_a_required_stage_leaves_the_item_at_intake(client):
    # Written straight to the version log, as if the check above were bypassed: the run time refuses too.
    _activate(_definition({'entry': [{'when': 'has label docs', 'to': 'implement'}]}))
    item = client.post('/factory/work-items', json={'factory_id': FACTORY, 'title': 'Docs', 'labels': ['docs'],
                                                     'source': {'kind': 'manual', 'ref': 'skip-1'}}).json()
    assert item['stage'] == 'intake'


def test_a_blueprint_that_is_not_valid_is_refused(client):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    resp = client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': _base(), 'blueprint': {'entry': [{'to': 'intake', 'mergeOnGreen': True}]}}, headers=HUMAN)
    assert resp.status_code == 200 and resp.json()['status'] == 'rejected'
    assert 'invalid_definition' in {reason['code'] for reason in resp.json()['reasons']}


def test_the_agent_token_cannot_change_the_blueprint(client):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    resp = client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': _base(), 'blueprint': {'entry': [{'to': 'intake'}]}})
    assert resp.status_code == 403


def test_would_it_fire_has_a_size_limit(client):
    big = {'provider': 'github', 'event': 'issues.opened', 'filter': {}, 'fields': {'x': 'y' * 70000}}
    assert client.post('/factory/blueprint/would-fire', json=big).status_code == 422
    odd = {'provider': 'git hub\n', 'event': 'issues.opened', 'filter': {}, 'fields': {}}
    assert client.post('/factory/blueprint/would-fire', json=odd).status_code == 422


def test_nilo_drops_a_request_that_holds_a_credential():
    files = compose('issue-pr', 'docs', 'use ghp_' + 'a' * 36 + ' to push')
    assert 'ghp_' not in files['agents/foreman/agent.md']
    kept = compose('issue-pr', 'docs', 'reset the password page copy')
    assert 'password page' in kept['agents/foreman/agent.md']


# ------------------------------------------------------------------------------------------- the editor starts from the active blueprint

def test_the_active_blueprint_is_read_with_its_hash(client):
    body = _definition({'entry': [{'to': 'intake'}], 'routes': [{'from': 'implement', 'to': 'end', 'when': 'has label stop', 'reason': 'x'}]})
    _activate(body)
    got = client.get('/factory/blueprint', params={'factory_id': FACTORY})
    assert got.status_code == 200, got.text
    assert got.json()['hash'] == _base() and got.json()['blueprint'] == body['blueprint']
    assert client.get('/factory/blueprint', params={'factory_id': 'nobody'}).status_code == 404
    assert client.get('/factory/blueprint', params={'factory_id': '../x'}).status_code == 422


def test_a_save_from_an_older_version_is_refused_and_nothing_changes(client):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    resp = client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': '0' * 64, 'blueprint': {'entry': [{'to': 'intake'}]}},
                       headers=HUMAN)
    assert resp.status_code == 409 and resp.json()['detail']['code'] == 'stale'
    assert client.post('/factory/blueprint', json={'factory_id': FACTORY, 'blueprint': {'entry': [{'to': 'intake'}]}},
                       headers=HUMAN).status_code == 422
    assert _state().canary is None


def test_the_preview_names_what_the_save_would_remove_and_changes_nothing(client):
    route = {'from': 'implement', 'to': 'end', 'when': 'has label stop', 'reason': 'x'}
    gate = {'id': 'ask', 'stage': 'implement', 'prompt': 'Which?', 'when': 'has label docs'}
    _activate(_definition({'entry': [{'to': 'intake'}], 'routes': [route], 'gates': [gate]}))
    resp = client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': _base(), 'preview': True,
                                                    'blueprint': {'entry': [{'to': 'intake'}], 'gates': [gate]}}, headers=HUMAN)
    assert resp.status_code == 200, resp.text
    assert resp.json()['status'] == 'preview'
    assert resp.json()['removed'] == [{'kind': 'routes', 'rule': route}]
    assert _state().canary is None


def test_simulate_walks_the_active_or_the_draft_blueprint(client):
    _activate(_definition({'entry': [{'to': 'intake'}], 'routes': [{'from': 'implement', 'to': 'end', 'when': 'has label stop', 'reason': 'x'}]}))
    active = client.post('/factory/blueprint/simulate', json={'factory_id': FACTORY, 'facts': {'labels': ['stop']}})
    assert active.status_code == 200, active.text
    assert [step['stage'] for step in active.json()['path']] == ['intake']
    draft = client.post('/factory/blueprint/simulate', json={'factory_id': FACTORY, 'facts': {'labels': ['stop']},
                                                             'blueprint': {'entry': [{'when': 'has label stop', 'to': 'spec'}],
                                                                           'routes': [{'from': 'spec', 'to': 'end', 'when': 'always'}]}})
    assert [step['stage'] for step in draft.json()['path']] == ['spec', 'end']
    assert client.post('/factory/blueprint/simulate', json={'factory_id': FACTORY, 'facts': {'labels': ['x'] * 500}}).status_code == 422


def test_saving_the_blueprint_frees_only_the_blueprint(client):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    stages = {'review': {'enabled': True, 'required': True, 'agent': 'builder'}, 'verify': {'enabled': True, 'required': True},
              'spec': {'enabled': True, 'required': True}}
    resp = client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': _base(), 'blueprint': {'entry': [{'to': 'intake'}]},
                                                    'stages': stages}, headers=HUMAN)
    assert resp.json()['status'] == 'rejected'
    assert 'protected_field' in {reason['code'] for reason in resp.json()['reasons']}


def test_the_base_hash_is_checked_inside_the_version_lock(client, monkeypatch):
    from factory import blueprint_router
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    seen = []
    original = blueprint_router._still_base

    async def watched(*args, **kwargs):
        seen.append(versions._WRITES.locked())
        return await original(*args, **kwargs)
    monkeypatch.setattr(blueprint_router, '_still_base', watched)
    resp = client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': _base(),
                                                    'blueprint': {'entry': [{'when': 'has label docs', 'to': 'spec'}, {'to': 'intake'}]}}, headers=HUMAN)
    assert resp.status_code == 200 and resp.json()['status'] == 'canary', resp.text
    assert seen == [True]


def test_reading_during_a_trial_shows_the_trial_and_says_so(client):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    tried = {'entry': [{'when': 'has label docs', 'to': 'spec'}, {'to': 'intake'}]}
    assert client.post('/factory/blueprint', json={'factory_id': FACTORY, 'base_hash': _base(), 'blueprint': tried},
                       headers=HUMAN).json()['status'] == 'canary'
    got = client.get('/factory/blueprint', params={'factory_id': FACTORY}).json()
    assert got['trial'] is True and got['blueprint'] == tried and got['hash'] == _base()


def test_nilo_returns_the_files_it_built(client):
    resp = client.post('/factory/blueprint/nilo', json={'recipe': 'issue-pr', 'name': 'docs', 'request': 'small fixes'})
    assert resp.status_code == 200 and resp.json()['ok'] is True
    assert 'forja.yaml' in resp.json()['files'] and 'name: "docs"' in resp.json()['files']['forja.yaml']


# ------------------------------------------------------------------------------------------- a body that nests too deep is refused

def _nested(levels: int) -> dict:
    root: dict = {}
    node = root
    for _ in range(levels):
        node['x'] = {}
        node = node['x']
    return root


@pytest.mark.parametrize('levels', [60, 900])
def test_every_blueprint_body_that_nests_too_deep_is_refused(client, levels):
    _activate(_definition({'entry': [{'to': 'intake'}]}))
    deep = _nested(levels)
    bodies = [
        ('/factory/blueprint', {'factory_id': FACTORY, 'base_hash': _base(), 'blueprint': deep}),
        ('/factory/blueprint', {'factory_id': FACTORY, 'base_hash': _base(), 'blueprint': {'entry': [{'to': 'intake'}]}, 'stages': deep}),
        ('/factory/blueprint/simulate', {'factory_id': FACTORY, 'blueprint': deep}),
        ('/factory/blueprint/would-fire', {'provider': 'github', 'event': 'issues', 'filter': deep}),
        ('/factory/blueprint/would-fire', {'provider': 'github', 'event': 'issues', 'fields': deep}),
        ('/factory/blueprint/would-fire', {'provider': 'github', 'event': 'issues', 'payload': deep}),
    ]
    for route, body in bodies:
        resp = client.post(route, json=body, headers=HUMAN)
        assert resp.status_code == 422, (route, list(body), resp.status_code)
    assert _state().canary is None
