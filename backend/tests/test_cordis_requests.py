"""Install requests from Nilo, against the real host: the agent stages, only the person's click installs, and a change needs a new request."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cordis import creator
from cordis.router import router
from cordis.service import CordisService
from cordis.supervisor import RUNNING
from cordis_support import node_problem, wait_until

HUMAN = {'x-oharness-human': 'human-secret'}
needs_node = pytest.mark.skipif(node_problem() is not None, reason=node_problem() or '')


@pytest.fixture(scope='module')
def stack(tmp_path_factory):
    service = CordisService(tmp_path_factory.mktemp('cordis-requests'))
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    service.start()
    assert wait_until(lambda: service.supervisor.state == RUNNING, 60), service.supervisor.status()
    with TestClient(app) as client:
        yield client, service
    service.stop()


@pytest.fixture()
def api(stack, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    yield stack


def tool(service, **args):
    return creator.run_action(service, args)


def test_creator_mode_switch_needs_the_human_credential(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    service = CordisService(tmp_path, enabled=False)
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    client = TestClient(app)
    assert client.get('/cordis/creator').json() == {'enabled': False}
    assert client.post('/cordis/creator', json={'enabled': True}).status_code == 403
    assert client.post('/cordis/creator', headers=HUMAN, json={'enabled': True}).json() == {'enabled': True}
    assert client.get('/cordis/creator').json() == {'enabled': True}


@needs_node
def test_the_agent_never_installs_and_the_person_approves_with_the_digest(api):
    client, service = api
    assert tool(service, action='scaffold', name='hello-tool', kind='tool')['status'] == 'applied'
    seen = tool(service, action='preview', name='hello-tool')
    assert seen['status'] == 'applied' and seen['preview']['runtime'] == 'isolated' and seen['preview']['capabilities'] == []
    asked = tool(service, action='request_install', name='hello-tool')
    assert asked['status'] == 'pending-approval' and 'approve' in asked['nextStep']
    assert client.get('/cordis/plugins').json() == {'plugins': []}  # nothing installed by the agent
    assert service.invoke_tool('hello_tool', {'name': 'Nilo'})['ok'] is False

    requests = client.get('/cordis/requests').json()['requests']
    assert len(requests) == 1
    pending = requests[0]
    assert pending['status'] == 'pending' and pending['name'] == 'hello-tool' and pending['changed'] is False
    assert pending['preview']['warning']['en'] and pending['preview']['digest'] and 'fetchId' not in pending
    rid = pending['id']

    assert client.post(f'/cordis/requests/{rid}/approve').status_code == 403
    assert client.post(f'/cordis/requests/{rid}/approve', headers={'x-oharness-human': 'wrong'}).status_code == 403
    done = client.post(f'/cordis/requests/{rid}/approve', headers=HUMAN)
    assert done.status_code == 200, done.text
    assert done.json()['plugin']['state'] == 'active' and done.json()['plugin']['madeByNilo'] is True
    assert service.invoke_tool('hello_tool', {'name': 'Nilo'})['value'] == {'greeting': 'Hello, Nilo.'}
    assert client.post(f'/cordis/requests/{rid}/approve', headers=HUMAN).status_code == 409  # used once

    # the same files again change nothing; logs are of the installed plugin
    again = tool(service, action='request_install', name='hello-tool')
    assert again['status'] == 'applied'
    assert tool(service, action='logs', name='hello-tool')['status'] == 'applied'
    listed = tool(service, action='list')
    assert listed['packages'][0]['installed']['upToDate'] is True

    # a change after install shows up and needs a new request; the installed copy keeps running
    tool(service, action='write_file', name='hello-tool', path='index.ts',
         content=(service.dev.read('hello-tool', 'index.ts').replace('Hello', 'Hi')))
    assert tool(service, action='list')['packages'][0]['installed']['upToDate'] is False
    assert service.invoke_tool('hello_tool', {'name': 'Nilo'})['value'] == {'greeting': 'Hello, Nilo.'}
    second = tool(service, action='request_install', name='hello-tool')
    assert second['status'] == 'pending-approval'
    rid2 = second['request']['id']
    assert client.post(f'/cordis/requests/{rid2}/approve', headers=HUMAN).status_code == 200
    assert service.invoke_tool('hello_tool', {'name': 'Nilo'})['value'] == {'greeting': 'Hi, Nilo.'}


@needs_node
def test_a_request_whose_files_changed_is_stale_and_reject_installs_nothing(api):
    client, service = api
    tool(service, action='scaffold', name='count-me', kind='service')
    rid = tool(service, action='request_install', name='count-me')['request']['id']
    tool(service, action='write_file', name='count-me', path='extra.ts', content='export const later = 1\n')
    assert next(r for r in client.get('/cordis/requests').json()['requests'] if r['id'] == rid)['changed'] is True
    stale = client.post(f'/cordis/requests/{rid}/approve', headers=HUMAN)
    assert stale.status_code == 409 and stale.json()['detail']['code'] == 'request_stale'
    assert not any(p['name'] == 'count-me' for p in client.get('/cordis/plugins').json()['plugins'])

    rid = tool(service, action='request_install', name='count-me')['request']['id']
    assert client.post(f'/cordis/requests/{rid}/reject').status_code == 403
    assert client.post(f'/cordis/requests/{rid}/reject', headers=HUMAN).json()['request']['status'] == 'rejected'
    assert not any(p['name'] == 'count-me' for p in client.get('/cordis/plugins').json()['plugins'])
    assert client.post(f'/cordis/requests/{"0" * 16}/approve', headers=HUMAN).status_code == 404


@needs_node
def test_the_service_and_command_starters_load_on_the_host(api):
    client, service = api
    for name, kind in (('tally-up', 'service'), ('say-back', 'command')):
        tool(service, action='scaffold', name=name, kind=kind)
        rid = tool(service, action='request_install', name=name)['request']['id']
        assert client.post(f'/cordis/requests/{rid}/approve', headers=HUMAN).json()['plugin']['state'] == 'active'
    assert service.invoke_tool('tally_up', {})['value'] == {'count': 1}
    assert service.invoke_tool('tally_up', {})['value'] == {'count': 2}
    said = client.post('/cordis/commands/execute', json={'line': '/say_back hello there'})
    assert said.status_code == 200 and said.json()['result'] == {'kind': 'success', 'text': 'hello there'}
