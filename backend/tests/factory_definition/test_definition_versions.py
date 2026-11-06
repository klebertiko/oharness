"""Activate, canary, promote, abort and rollback of definition versions; routing of new work items (ADR 0056)."""
from __future__ import annotations

import uuid

import anyio
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete

from database import SessionLocal
from factory import versions
from factory.orm import DefinitionVersion, WorkItem, WorkItemEvent
from factory_definition_files import agent_md
from main import app

HUMAN = {'x-oharness-human': 'human-secret'}
BUILDER = ('implement', 'openai/gpt-4o', 'workspace_write')


async def _reset() -> None:
    async with SessionLocal() as db:
        for table in (WorkItemEvent, WorkItem, DefinitionVersion):
            await db.execute(delete(table))
        await db.commit()


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as c:
        anyio.run(_reset)
        yield c
    anyio.run(_reset)


@pytest.fixture()
def project(client, make_definition, tmp_path):
    make_definition()
    resp = client.post('/cowork/projects', json={'name': 'payments', 'rootPath': str(tmp_path)})
    assert resp.status_code == 201, resp.text
    return str(tmp_path)


def _activate(client, workspace, human=True, **body):
    if 'expected_hash' not in body:  # the hash the person reviewed: the app sends what /validate showed
        body['expected_hash'] = client.post('/factory/definition/validate', json={'workspace': workspace}).json().get('hash') or 'f' * 64
    return client.post('/factory/definition/activate', json={'workspace': workspace, **body}, headers=HUMAN if human else {})


def _post(client, action, **body):
    return client.post(f'/factory/definition/{action}', json={'factory_id': 'payments', **body}, headers=HUMAN)


def _state(client):
    return client.get('/factory/definition', params={'factory_id': 'payments'}).json()


def _edit(make_definition, text):
    make_definition({'agents/builder/agent.md': agent_md(*BUILDER, body=text)})


def _item(client, n):
    resp = client.post('/factory/work-items', json={'factory_id': 'payments', 'title': f'item {n}', 'source': {'kind': 'manual', 'ref': f'm{n}'}})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_validate_reports_the_checkout_against_the_active_version(client, project, make_definition):
    first = client.post('/factory/definition/validate', json={'workspace': project}).json()
    assert first['ok'] and first['active_hash'] is None and first['update_available'] is True and first['name'] == 'payments'
    assert _activate(client, project).status_code == 200
    again = client.post('/factory/definition/validate', json={'workspace': project}).json()
    assert again['active_hash'] == first['hash'] and again['update_available'] is False and again['changes'] == []
    _edit(make_definition, 'Changed.')
    changed = client.post('/factory/definition/validate', json={'workspace': project}).json()
    assert changed['update_available'] is True and [c['path'] for c in changed['changes']] == ['agents.builder.instructions']


def test_only_a_registered_project_can_be_read(client, tmp_path):
    resp = client.post('/factory/definition/validate', json={'workspace': str(tmp_path)})
    assert resp.status_code == 404 and resp.json()['detail']['code'] == 'unknown_workspace'


def test_a_project_without_a_definition_says_so(client, tmp_path):
    client.post('/cowork/projects', json={'name': 'bare', 'rootPath': str(tmp_path)})
    resp = client.post('/factory/definition/validate', json={'workspace': str(tmp_path)})
    assert resp.status_code == 404 and resp.json()['detail']['code'] == 'no_definition'


def test_activation_is_a_human_decision(client, project):
    resp = _activate(client, project, human=False)
    assert resp.status_code == 403 and resp.json()['detail']['code'] == 'human_only'
    for action in ('promote', 'abort', 'rollback'):
        assert client.post(f'/factory/definition/{action}', json={'factory_id': 'payments'}).status_code == 403
    assert _state(client)['stable'] is None


def test_activate_stores_an_immutable_snapshot(client, project):
    resp = _activate(client, project, label='first')
    assert resp.status_code == 200
    body = resp.json()
    assert body['kind'] == 'activate' and body['mode'] == 'stable' and body['label'] == 'first' and body['previous_hash'] is None
    assert _state(client)['stable']['hash'] == body['hash'] and _state(client)['canary'] is None
    snapshot = client.get(f"/factory/definition/versions/{body['hash']}", params={'factory_id': 'payments'}).json()
    assert snapshot['definition']['name'] == 'payments'
    listed = client.get('/factory/definition/versions', params={'factory_id': 'payments'}).json()['versions']
    assert [v['hash'] for v in listed] == [body['hash']]


def test_an_invalid_definition_is_refused_and_the_last_valid_one_stays(client, project, make_definition):
    good = _activate(client, project).json()['hash']
    make_definition({'agents/builder/agent.md': agent_md('implement', 'openai/gpt-4o', 'full')})
    resp = _activate(client, project)
    assert resp.status_code == 422 and resp.json()['detail']['code'] == 'invalid_definition' and resp.json()['detail']['errors']
    assert _state(client)['stable']['hash'] == good


def test_activating_the_same_version_again_is_refused(client, project):
    _activate(client, project)
    assert _activate(client, project).status_code == 409


def test_diff_between_two_versions(client, project, make_definition):
    a = _activate(client, project).json()['hash']
    _edit(make_definition, 'Changed.')
    b = _activate(client, project).json()
    assert b['previous_hash'] == a
    diff = client.get('/factory/definition/diff', params={'factory_id': 'payments', 'from': a, 'to': b['hash']}).json()
    assert [c['path'] for c in diff['changes']] == ['agents.builder.instructions']
    assert client.get('/factory/definition/diff', params={'factory_id': 'payments', 'from': a, 'to': 'f' * 64}).status_code == 404


def test_rollback_reactivates_the_previous_version_for_new_items_only(client, project, make_definition):
    a = _activate(client, project).json()['hash']
    old = _item(client, 1)
    assert old['factory_version'] == a
    _edit(make_definition, 'Changed.')
    b = _activate(client, project).json()['hash']
    assert _item(client, 2)['factory_version'] == b
    rolled = _post(client, 'rollback')
    assert rolled.status_code == 200 and rolled.json()['hash'] == a and rolled.json()['kind'] == 'rollback'
    assert _item(client, 3)['factory_version'] == a
    assert client.get(f"/factory/work-items/{old['id']}").json()['factory_version'] == a  # in-flight items keep the version they began with


def test_rollback_needs_something_to_go_back_to(client, project):
    assert _post(client, 'rollback').status_code == 409
    _activate(client, project)
    assert _post(client, 'rollback').status_code == 409
    assert _post(client, 'rollback', to='e' * 64).status_code == 404


def test_canary_routes_a_share_of_new_items_and_promote_makes_it_stable(client, project, make_definition):
    a = _activate(client, project).json()['hash']
    _edit(make_definition, 'Candidate.')
    canary = _activate(client, project, mode='canary', percent=50)
    assert canary.status_code == 200 and canary.json()['mode'] == 'canary' and canary.json()['percent'] == 50
    state = _state(client)
    assert state['stable']['hash'] == a and state['canary']['hash'] == canary.json()['hash']
    assert {_item(client, n)['factory_version'] for n in range(30)} == {a, canary.json()['hash']}
    promoted = _post(client, 'promote')
    assert promoted.status_code == 200 and promoted.json()['kind'] == 'promote' and promoted.json()['hash'] == canary.json()['hash']
    state = _state(client)
    assert state['stable']['hash'] == canary.json()['hash'] and state['canary'] is None


def test_abort_sends_everything_back_to_stable(client, project, make_definition):
    a = _activate(client, project).json()['hash']
    _edit(make_definition, 'Candidate.')
    _activate(client, project, mode='canary', percent=50)
    assert _post(client, 'abort').status_code == 200
    assert _state(client)['canary'] is None
    assert {_item(client, n)['factory_version'] for n in range(10)} == {a}


def test_canary_rules(client, project, make_definition):
    assert _activate(client, project, mode='canary', percent=10).status_code == 409  # nothing stable to compare against
    _activate(client, project)
    _edit(make_definition, 'Candidate.')
    for percent in (0, 51):
        assert _activate(client, project, mode='canary', percent=percent).status_code == 422
    assert _activate(client, project, mode='canary').status_code == 422
    assert _activate(client, project, mode='canary', percent=5).status_code == 200
    _edit(make_definition, 'Another.')
    assert _activate(client, project, mode='canary', percent=5).status_code == 409  # one candidate at a time
    assert _activate(client, project).status_code == 409  # promote or abort it first
    assert _post(client, 'rollback').status_code == 409
    assert client.post('/factory/definition/promote', json={'factory_id': 'other'}, headers=HUMAN).status_code == 409


def test_routing_is_deterministic_and_close_to_the_percentage():
    ids = [str(uuid.uuid4()) for _ in range(2000)]
    first = [versions.in_canary(i, 20) for i in ids]
    assert first == [versions.in_canary(i, 20) for i in ids]
    assert 0.14 < sum(first) / len(first) < 0.26
    assert not any(versions.in_canary(i, 0) for i in ids[:50]) and all(versions.in_canary(i, 100) for i in ids[:50])


def test_activation_is_pinned_to_the_hash_the_person_reviewed(client, project, make_definition):
    reviewed = client.post('/factory/definition/validate', json={'workspace': project}).json()['hash']
    _edit(make_definition, 'Changed after the review.')  # something rewrote the folder between review and click
    resp = _activate(client, project, expected_hash=reviewed)
    assert resp.status_code == 409 and resp.json()['detail']['code'] == 'changed_since_review'
    assert _state(client)['stable'] is None
    assert client.post('/factory/definition/activate', json={'workspace': project}, headers=HUMAN).status_code == 422  # the hash is required


def test_rollback_never_goes_to_a_canary_that_was_aborted(client, project, make_definition):
    _activate(client, project)
    _edit(make_definition, 'Candidate.')
    candidate = _activate(client, project, mode='canary', percent=5).json()['hash']
    _post(client, 'abort')
    assert _post(client, 'rollback', to=candidate).status_code == 404


def test_a_second_rollback_does_not_return_to_the_version_that_was_left(client, project, make_definition):
    a = _activate(client, project).json()['hash']
    _edit(make_definition, 'Bad release.')
    _activate(client, project)
    assert _post(client, 'rollback').json()['hash'] == a
    assert _post(client, 'rollback').status_code == 409
