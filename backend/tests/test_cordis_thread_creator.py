"""Creator mode belongs to one chat thread (ADR 0071): only the person turns it on, for that thread, and the broker honours it only there."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cordis import creator
from cordis.router import router
from cordis.service import CordisService
from engine import RunControl
from sandbox.broker import ToolBroker
from sandbox.schemas import ToolsRequest

HUMAN = {'x-oharness-human': 'human-secret'}
A, B = 'thread-a', 'thread-b'


@pytest.fixture()
def service(tmp_path):
    service = CordisService(tmp_path, enabled=False)
    creator.bind(service)
    yield service
    creator.bind(None)


def test_it_is_off_for_every_thread_and_saved_per_thread(service, tmp_path):
    assert service.creator_on(A) is False
    service.set_creator(A, True)
    again = CordisService(tmp_path, enabled=False)
    assert again.creator_on(A) is True and again.creator_on(B) is False
    service.set_creator(A, False)
    assert CordisService(tmp_path, enabled=False).creator_on(A) is False


def test_the_tool_is_offered_only_in_the_thread_it_was_turned_on_for(service):
    service.set_creator(A, True)
    assert creator.active_service(A) is service
    assert creator.active_service(B) is None
    assert creator.active_service(None) is None


def test_the_broker_needs_the_thread_the_person_chose(service):
    service.set_creator(A, True)
    control = RunControl('t')
    assert ToolBroker(None, 'ollama', control, ToolsRequest(thread_id=A), creator_thread=A).cordis is service
    assert ToolBroker(None, 'ollama', control, ToolsRequest(thread_id=B), creator_thread=B).cordis is None
    # A run that names one thread for its tools and another for creator mode gets no creator tool.
    assert ToolBroker(None, 'ollama', control, ToolsRequest(thread_id=B), creator_thread=A).cordis is None
    assert ToolBroker(None, 'ollama', control, ToolsRequest()).cordis is None


def test_only_the_person_turns_it_on_and_only_for_one_thread(service, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    client = TestClient(app)
    assert client.post('/cordis/creator', json={'thread_id': A, 'enabled': True}).status_code == 403
    assert client.post('/cordis/creator', json={'thread_id': 'bad id!', 'enabled': True}, headers=HUMAN).status_code == 422
    assert client.post('/cordis/creator', json={'enabled': True}, headers=HUMAN).status_code == 422
    assert client.post('/cordis/creator', json={'thread_id': A, 'enabled': True}, headers=HUMAN).json() == {'threadId': A, 'enabled': True}
    assert client.get('/cordis/creator', params={'thread_id': A}).json() == {'threadId': A, 'enabled': True}
    assert client.get('/cordis/creator', params={'thread_id': B}).json() == {'threadId': B, 'enabled': False}


def test_api_catalog_lists_the_live_host_without_code(service):
    calls = []

    def host(method, path, body=None):
        calls.append((method, path))
        if path == '/v1/services':
            return {'services': [{'name': 'tools', 'chain': ['ToolsService', 'Service']}], 'tools': ['proof_echo'], 'commands': ['proof']}
        return {'plugins': [{'name': 'demo', 'version': '1.0.0', 'runtime': 'isolated', 'status': 'active', 'message': 'x'}]}
    service.supervisor.request = host
    result = creator.run_action(service, {'action': 'api_catalog'})
    assert result['status'] == 'applied'
    assert result['services'] == [{'name': 'tools', 'chain': ['ToolsService', 'Service']}]
    assert result['tools'] == ['proof_echo'] and result['commands'] == ['proof']
    assert result['plugins'] == [{'name': 'demo', 'version': '1.0.0', 'runtime': 'isolated', 'status': 'active'}]
    assert all(method == 'GET' for method, _ in calls)
    assert 'nextStep' in result


def test_starters_hands_out_the_starting_files(service):
    result = creator.run_action(service, {'action': 'starters'})
    assert result['status'] == 'applied'
    assert {row['kind'] for row in result['starters']} == {'tool', 'command', 'service'}
    assert all(row['content'] for row in result['starters'])
