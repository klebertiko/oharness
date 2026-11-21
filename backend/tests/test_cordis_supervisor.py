"""The sidecar runs the real Cordis host as a child and keeps it alive (ADR 0071). No fakes for the host or the plugin processes."""
from __future__ import annotations

import json
import logging
import shutil
import time

import pytest
from fastapi.testclient import TestClient

from cordis.service import CordisService
from cordis.supervisor import FAILED, RUNNING, STARTING, UNAVAILABLE, CordisSupervisor, CordisUnavailable, parse_node_version
from cordis_support import FakeNet, alive, kill_hard, node_problem, plugin_files, wait_until

needs_node = pytest.mark.skipif(node_problem() is not None, reason=node_problem() or '')


def make_service(tmp_path, net: FakeNet | None = None, **options) -> CordisService:
    return CordisService(tmp_path, fetcher=net or FakeNet(), supervisor_options=options)


def install_probe(service: CordisService, net: FakeNet, version: str = '1.0.0') -> dict:
    net.add_npm('backend-probe', version, plugin_files(version))
    fetched = service.fetch('npm', 'backend-probe', version=version)
    return service.install(fetched['fetchId'], accept=True, digest=fetched['preview']['digest'], scripts=None)


def probe_info(service: CordisService) -> dict:
    answer = service.supervisor.request('POST', '/v1/tools/invoke', {'name': 'probe_info', 'args': {}})
    assert answer['ok'] is True, answer
    return answer['value']


@pytest.fixture()
def running(tmp_path):
    net = FakeNet()
    service = make_service(tmp_path, net, backoff=(0.1,))
    service.start()
    assert wait_until(lambda: service.supervisor.state == RUNNING, 60), service.supervisor.status()
    yield service, net
    service.stop()


@needs_node
def test_start_returns_at_once_and_the_banner_makes_it_running(tmp_path):
    service = make_service(tmp_path)
    begun = time.monotonic()
    service.start()
    assert time.monotonic() - begun < 2.0
    assert service.supervisor.state in (STARTING, RUNNING)
    assert wait_until(lambda: service.supervisor.state == RUNNING, 60), service.supervisor.status()
    try:
        health = service.supervisor.request('GET', '/v1/health')
        assert health['host'] == '127.0.0.1' and health['cordis']['version'] == '4.0.0-rc.11'
        assert service.supervisor.status()['node'] == service.supervisor.node_version
    finally:
        service.stop()
    assert service.supervisor.state == 'stopped'
    with pytest.raises(CordisUnavailable):
        service.supervisor.request('GET', '/v1/health')


@needs_node
def test_the_host_token_is_never_in_status_logs_or_the_plugin_list(running, caplog):
    service, net = running
    caplog.set_level(logging.DEBUG)
    install_probe(service, net)
    token = service.supervisor._token
    assert token and len(token) > 20
    everything = json.dumps([service.status(), service.list_plugins(), service.logs(service.list_plugins()[0]['id'], 200)]) + caplog.text
    assert token not in everything
    assert str(service.supervisor._port) not in json.dumps(service.status())
    service.supervisor._ingest(f'host said {token}')  # even a line that quotes it is redacted before it is kept
    assert token not in json.dumps(service.status())


@needs_node
def test_stopping_the_sidecar_leaves_no_host_and_no_plugin_process(tmp_path):
    net = FakeNet()
    service = make_service(tmp_path, net)
    service.start()
    assert wait_until(lambda: service.supervisor.state == RUNNING, 60), service.supervisor.status()
    install_probe(service, net)
    plugin_pid, host_pid = probe_info(service)['pid'], service.supervisor.host_pid
    assert host_pid and alive(host_pid) and alive(plugin_pid) and plugin_pid != host_pid
    service.stop()
    assert wait_until(lambda: not alive(host_pid) and not alive(plugin_pid), 15), (alive(host_pid), alive(plugin_pid))


@needs_node
def test_a_dead_host_is_restarted_and_its_plugins_come_back(running):
    service, net = running
    install_probe(service, net)
    first_host, first_plugin = service.supervisor.host_pid, probe_info(service)['pid']
    kill_hard(first_host)
    assert wait_until(lambda: service.supervisor.state != RUNNING, 10)
    assert wait_until(lambda: service.supervisor.state == RUNNING and service.supervisor.host_pid not in (None, first_host), 60), service.supervisor.status()
    assert wait_until(lambda: service.list_plugins()[0]['state'] == 'active', 30), service.list_plugins()
    assert probe_info(service)['pid'] != first_plugin
    assert service.status()['restarts'] == 1
    assert wait_until(lambda: not alive(first_plugin), 15), 'the plugin process of the dead host must leave too'


@needs_node
def test_a_host_that_keeps_dying_is_given_up_on(tmp_path):
    service = make_service(tmp_path, backoff=(0.05,), max_restarts=2)
    service.start()
    try:
        for _ in range(3):
            assert wait_until(lambda: service.supervisor.state in (RUNNING, FAILED), 60)
            if service.supervisor.state == FAILED:
                break
            seen = service.supervisor.host_pid
            kill_hard(seen)
            assert wait_until(lambda: service.supervisor.host_pid != seen or service.supervisor.state == FAILED, 60)
        assert wait_until(lambda: service.supervisor.state == FAILED, 30), service.supervisor.status()
        assert service.supervisor.reason
    finally:
        service.stop()


@needs_node
def test_a_plugin_that_changed_on_disk_is_not_loaded_again(running):
    service, net = running
    view = install_probe(service, net)
    package = service.registry.get(view['id'])['packageDir']
    with open(f'{package}/index.ts', 'a', encoding='utf8') as file:
        file.write('\n// edited after the person confirmed it\n')
    kill_hard(service.supervisor.host_pid)
    assert wait_until(lambda: service.supervisor.state != RUNNING, 10)
    assert wait_until(lambda: service.supervisor.state == RUNNING, 60)
    assert wait_until(lambda: service.list_plugins()[0]['state'] == 'changed', 30), service.list_plugins()


def test_without_node_the_state_is_unavailable_with_a_reason_and_nothing_raises(tmp_path, monkeypatch):
    monkeypatch.setattr(shutil, 'which', lambda *_a, **_k: None)
    supervisor = CordisSupervisor(tmp_path / 'plugins', env={})
    supervisor.start()
    assert wait_until(lambda: supervisor.state == UNAVAILABLE, 5)
    assert 'Node' in supervisor.reason
    with pytest.raises(CordisUnavailable) as error:
        supervisor.request('GET', '/v1/health')
    assert error.value.state == UNAVAILABLE
    supervisor.stop()


def test_a_missing_host_folder_is_unavailable(tmp_path):
    supervisor = CordisSupervisor(tmp_path / 'plugins', env={'OH_CORDIS_NODE': 'node', 'OH_CORDIS_HOST_DIR': str(tmp_path / 'nothing')})
    supervisor.start()
    assert wait_until(lambda: supervisor.state == UNAVAILABLE, 5)
    assert 'host files' in supervisor.reason
    supervisor.stop()


def test_a_node_that_cannot_run_is_unavailable(tmp_path):
    host = tmp_path / 'host'
    (host / 'src').mkdir(parents=True)
    (host / 'node_modules' / 'cordis').mkdir(parents=True)
    (host / 'src' / 'main.ts').write_text('')
    (host / 'package.json').write_text('{}')
    supervisor = CordisSupervisor(tmp_path / 'plugins', env={'OH_CORDIS_NODE': str(tmp_path / 'no-such-node'), 'OH_CORDIS_HOST_DIR': str(host)})
    supervisor.start()
    assert wait_until(lambda: supervisor.state == UNAVAILABLE, 10)
    supervisor.stop()


def test_node_version_gate():
    assert parse_node_version('v22.20.0\n') == (22, 20, 0)
    assert parse_node_version('v22.19.9') < (22, 20, 0)
    assert parse_node_version('v24.19.0') > (22, 20, 0)
    assert parse_node_version('nonsense') is None


def test_the_sidecar_boots_and_serves_when_the_host_cannot_start(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_CORDIS_DISABLE', '0')
    monkeypatch.setenv('OH_CORDIS_NODE', str(tmp_path / 'no-such-node'))
    monkeypatch.setenv('OH_CORDIS_DATA_DIR', str(tmp_path / 'data'))
    from main import app
    with TestClient(app) as client:
        assert client.get('/health').json() == {'status': 'ok'}
        assert wait_until(lambda: client.get('/cordis/status').json()['state'] == UNAVAILABLE, 20)
        assert client.get('/cordis/status').json()['reason']
        assert client.get('/cordis/plugins').json() == {'plugins': []}


def test_the_off_switch_leaves_the_host_unstarted(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_CORDIS_DISABLE', '1')
    monkeypatch.setenv('OH_CORDIS_DATA_DIR', str(tmp_path / 'data'))
    from main import app
    with TestClient(app) as client:
        status = client.get('/cordis/status').json()
        assert status['state'] == UNAVAILABLE and 'turned off' in status['reason']
