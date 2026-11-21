"""Compatibility through the sidecar: three packages copied from cordis-host, installed with the local source by the `/cordis/*` routes on
the real host, then exercised by the proxy routes the agent uses (`/cordis/tools/invoke`, `/cordis/commands/execute`)."""
from __future__ import annotations

import shutil

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cordis.router import router
from cordis.service import CordisService
from cordis.supervisor import RUNNING
from cordis_support import HOST_DIR, node_problem, wait_until

HUMAN = {'x-oharness-human': 'human-secret'}
needs_node = pytest.mark.skipif(node_problem() is not None, reason=node_problem() or '')
ALL = ['credentials', 'files', 'network', 'processes']


@pytest.fixture(scope='module')
def stack(tmp_path_factory):
    service = CordisService(tmp_path_factory.mktemp('cordis-compat'))
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


def copy_in(service, source, name):
    """The package as a person would have it: a folder of theirs, copied in by the local source."""
    target = service.root / 'incoming' / name
    shutil.copytree(source, target)
    return target


def add(client, folder, **install):
    fetched = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'local', 'spec': str(folder)})
    assert fetched.status_code == 200, fetched.text
    body = fetched.json()
    preview = body['preview']
    confirm = {'fetch_id': body['fetchId'], 'accept': True, 'digest': preview['digest'], **install}
    if preview['scripts']:
        confirm['scripts'] = 'do-not-run'
    done = client.post('/cordis/plugins/install', headers=HUMAN, json=confirm)
    assert done.status_code == 200, done.text
    return preview, done.json()


@needs_node
def test_a_our_plugin_tool_command_and_event_through_the_proxy_routes(api):
    client, service = api
    preview, view = add(client, copy_in(service, HOST_DIR / 'proofs' / 'our-plugin', 'our-plugin'))
    assert preview['runtime'] == 'isolated' and preview['capabilities'] == []
    assert view['state'] == 'active'
    echo = client.post('/cordis/tools/invoke', json={'name': 'proof_echo', 'args': {'text': 'via sidecar'}})
    assert echo.status_code == 200 and echo.json()['ok'] is True
    value = echo.json()['value']
    assert value['echoed'] == 'via sidecar' and value['pid'] != service.supervisor.host_pid
    command = client.post('/cordis/commands/execute', json={'line': '/proof hi'})
    assert command.status_code == 200
    assert command.json()['result'] == {'kind': 'success', 'text': f'proof hi pid {value["pid"]}'}
    service.supervisor.request('POST', '/v1/events/emit', {'name': 'proof/ping', 'payload': {'n': 7}})
    heard = client.post('/cordis/tools/invoke', json={'name': 'proof_seen', 'args': {}}).json()
    assert heard['value']['events'] == [{'n': 7}]
    assert client.post('/cordis/tools/invoke', json={'name': 'nope', 'args': {}}).json()['ok'] is False


@needs_node
def test_b_the_dsh_directory_picker_needs_in_process_with_all_four_capabilities(api):
    client, service = api
    preview, view = add(client, copy_in(service, HOST_DIR / 'proofs' / 'dsh-directory-picker', 'dsh-directory-picker'))
    assert preview['runtime'] == 'in-process' and sorted(preview['capabilities']) == ALL
    assert 'in-process' in preview['warning']['en'] or 'in-process' in preview['warning']['pt-BR']
    assert view['state'] == 'active' and view['runtime'] == 'in-process'
    services = service.supervisor.request('GET', '/v1/services')['services']
    picker = next(row for row in services if row['name'] == 'directoryPicker')
    assert picker['chain'] == ['ProofDirectoryPicker', 'DirectoryPicker', 'Service']


@needs_node
def test_c_the_dsh_tool_todo_registers_on_the_tools_service_and_keeps_its_own_rule(api):
    client, service = api
    preview, view = add(client, copy_in(service, HOST_DIR / 'vendor' / 'dsh' / 'tool-todo', 'tool-todo'),
                        config={'allowParallelInProgress': False})
    assert preview['name'] == '@deepseek-ai/dsh-tool-todo' and preview['runtime'] == 'isolated' and preview['runtimeDefaulted'] is True
    assert view['state'] == 'active', view
    called = client.post('/cordis/tools/invoke', json={'name': 'todo_write', 'args': {'todos': [{'content': 'Ship', 'status': 'pending'}]}})
    assert called.status_code == 200
    # outside an agent session the tool's own body refuses: it registered on `tools` and ran in its process
    assert called.json()['ok'] is False and 'owning agent session' in called.json()['error']


def test_the_proxy_routes_answer_503_without_a_host(tmp_path):
    service = CordisService(tmp_path, enabled=False)
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    client = TestClient(app)
    assert client.post('/cordis/tools/invoke', json={'name': 'x', 'args': {}}).status_code == 503
    assert client.post('/cordis/commands/execute', json={'line': '/x'}).status_code == 503
