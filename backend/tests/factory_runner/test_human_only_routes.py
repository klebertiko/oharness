"""Every Forja route that changes state is classified, and the human-only ones refuse an agent credential and accept the person's (ADR 0055)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from factory.definition_router import router as definition_router
from factory.inbox_router import router as inbox_router
from factory.memory_router import router as memory_router
from factory.router import router as work_router
from factory.secrets_router import router as secrets_router
from main import app

HUMAN = {'x-oharness-human': 'human-secret'}
# Which mutating routes need the human credential (decision of the owner, #442: do not change this set here).
HUMAN_ONLY = {
    ('POST', '/factory/definition/activate'), ('POST', '/factory/definition/promote'), ('POST', '/factory/definition/abort'),
    ('POST', '/factory/definition/rollback'),
    ('POST', '/factory/inbox/{key}/resolve'), ('DELETE', '/factory/inbox/{key}/resolve'),
    ('PATCH', '/factory/memory/{note_id}'), ('DELETE', '/factory/memory/{note_id}'), ('DELETE', '/factory/memory'),
    ('PUT', '/factory/secrets/{name}'), ('DELETE', '/factory/secrets/{name}'),
}
# Mutating routes an agent may call, or that decide per action inside (covered by their own tests).
OPEN_OR_PER_ACTION = {
    ('POST', '/factory/definition/validate'), ('POST', '/factory/memory'),
    ('POST', '/factory/work-items'), ('POST', '/factory/work-items/{item_id}/actions'), ('POST', '/factory/work-items/{item_id}/check-landing'),
}
ROUTERS = (definition_router, inbox_router, memory_router, work_router, secrets_router)
PLACEHOLDER = {'key': 'k1', 'note_id': 'n1', 'name': 'npm-token', 'item_id': 'i1'}


def _mutating():
    return {(m, r.path) for router in ROUTERS for r in router.routes for m in r.methods if m in ('POST', 'PUT', 'PATCH', 'DELETE')}


def test_every_state_changing_route_is_classified():
    unclassified = _mutating() - HUMAN_ONLY - OPEN_OR_PER_ACTION
    assert not unclassified, f'classify these routes as human-only or not: {sorted(unclassified)}'
    assert HUMAN_ONLY <= _mutating(), 'a human-only route in the table no longer exists'


@pytest.fixture()
def client(monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    with TestClient(app) as c:
        yield c


@pytest.mark.parametrize(('method', 'path'), sorted(HUMAN_ONLY))
def test_a_human_only_route_refuses_the_agent_credential_and_not_the_persons(client, method, path):
    url = path.format(**PLACEHOLDER)
    body = {'params': {'factory_id': 'payments', 'agent_id': 'builder'}}  # what the routes need to get past validation, so the credential check is what answers
    if method in ('POST', 'PUT', 'PATCH'):
        body['json'] = {'value': 'abcd-efgh', 'text': 'x', 'status': 'open', 'factory_id': 'no-such-factory', 'workspace': 'no-such-folder', 'expected_hash': 'a' * 64}
    agent = client.request(method, url, **body)
    assert agent.status_code == 403 and agent.json()['detail']['code'] == 'human_only', (method, path, agent.status_code)
    person = client.request(method, url, headers=HUMAN, **body)
    assert not (person.status_code == 403 and person.json().get('detail', {}).get('code') == 'human_only'), (method, path)
