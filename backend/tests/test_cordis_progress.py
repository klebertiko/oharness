"""Live progress of a fetch, a real Cancel, and script decisions bound to one package (ADR 0071). No Node: the host calls are faked."""
from __future__ import annotations

import io
import threading
import time

import pytest

from cordis import sources
from cordis.service import CordisService, ServiceError
from cordis.sources import SourceError
from test_cordis_sources import integrity, package, tar_gz

PREVIEW = {'name': 'demo', 'version': '1.0.0', 'runtime': 'isolated', 'runtimeDefaulted': False, 'isolation': {'enforced': [], 'notEnforced': []},
           'capabilities': [], 'capabilitiesDeclared': True, 'scripts': [], 'bundlePatchIgnored': False, 'digest': 'd' * 64, 'warning': {}}


class FakeHost:
    def __init__(self, preview=None):
        self.preview, self.installs = dict(preview or PREVIEW), []

    def __call__(self, method, path, body=None):
        if path == '/v1/plugins/preview':
            return dict(self.preview)
        if path == '/v1/plugins/install':
            self.installs.append(body)
            return {'status': 'active'}
        return {'plugins': []} if path == '/v1/plugins' else {}


class SlowNet:
    """A cancellable npm: the tarball download waits for the cancel event, as the real fetcher checks it between chunks."""
    cancellable = True

    def __init__(self):
        self.data = tar_gz(package())
        self.started = threading.Event()

    def __call__(self, url, limit, cancel=None):
        if url.endswith('/1.0.0'):
            return ('{"dist": {"tarball": "https://registry.npmjs.org/demo/-/demo-1.0.0.tgz", "integrity": "%s"}}' % integrity(self.data)).encode()
        self.started.set()
        for _ in range(500):
            if cancel is not None and cancel.is_set():
                raise SourceError('cancelled', 'The download was cancelled.')
            time.sleep(0.01)
        return self.data


def make(tmp_path, net=None, host=None):
    service = CordisService(tmp_path, fetcher=net or SlowNet(), enabled=False)
    service.supervisor.request = host or FakeHost()
    return service


def wait_state(service, fetch_id, states, timeout=10):
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        view = service.fetch_status(fetch_id)
        if view['state'] in states:
            return view
        time.sleep(0.02)
    raise AssertionError(service.fetch_status(fetch_id))


def test_the_reader_checks_cancel_between_chunks_and_keeps_the_ceiling():
    cancel = threading.Event()

    class Stream(io.BytesIO):
        def read(self, size=-1):
            chunk = super().read(size)
            cancel.set()  # the person pressed Cancel while this chunk arrived
            return chunk
    with pytest.raises(SourceError) as error:
        sources.read_capped(Stream(b'x' * (sources.CHUNK * 3)), 10 * sources.CHUNK, cancel)
    assert error.value.code == 'cancelled'
    assert len(sources.read_capped(io.BytesIO(b'y' * 100), 10)) == 11  # one past the ceiling, so the caller can refuse it


def test_a_fetch_reports_each_step_until_the_preview(tmp_path):
    service = make(tmp_path, net=FastNpm())
    started = service.start_fetch('npm', 'demo', version='1.0.0')
    assert started['state'] == 'running'
    view = wait_state(service, started['fetchId'], {'ready', 'failed'})
    assert view['state'] == 'ready', view
    steps = [event['step'] for event in view['events']]
    assert steps == ['downloading', 'verifying', 'extracting', 'preview-ready']
    assert view['result']['preview']['name'] == 'demo'


def test_cancel_stops_the_download_and_removes_the_staging(tmp_path):
    net = SlowNet()
    service = make(tmp_path, net=net)
    started = service.start_fetch('npm', 'demo', version='1.0.0')
    assert net.started.wait(5)
    stage = service.packages / started['fetchId']
    assert stage.is_dir()
    begun = time.monotonic()
    view = service.cancel_fetch(started['fetchId'])
    assert time.monotonic() - begun < 3  # the fetcher saw the event; it did not run to the end
    assert view['state'] == 'cancelled'
    assert not stage.exists()
    assert [event['step'] for event in view['events']][-1] == 'cancelled'
    with pytest.raises(ServiceError) as error:
        service.install(started['fetchId'], accept=True, digest='d' * 64, scripts=None)
    assert error.value.code == 'fetch_not_found'


def test_do_not_install_discards_a_ready_preview(tmp_path):
    service = make(tmp_path, net=FastNpm())
    started = service.start_fetch('npm', 'demo', version='1.0.0')
    wait_state(service, started['fetchId'], {'ready'})
    assert (service.packages / started['fetchId']).is_dir()
    assert service.cancel_fetch(started['fetchId'])['state'] == 'cancelled'
    assert not (service.packages / started['fetchId']).exists()
    with pytest.raises(ServiceError):
        service.cancel_fetch('0' * 16)


class FastNpm:
    def __init__(self):
        self.data = tar_gz(package())

    def __call__(self, url, limit):
        if url.endswith('/1.0.0'):
            return ('{"dist": {"tarball": "https://registry.npmjs.org/demo/-/demo-1.0.0.tgz", "integrity": "%s"}}' % integrity(self.data)).encode()
        return self.data


def test_install_adds_installing_and_done_to_the_same_log(tmp_path):
    service = make(tmp_path, net=FastNpm())
    started = service.start_fetch('npm', 'demo', version='1.0.0')
    wait_state(service, started['fetchId'], {'ready'})
    service.install(started['fetchId'], accept=True, digest='d' * 64, scripts=None)
    steps = [event['step'] for event in service.fetch_status(started['fetchId'])['events']]
    assert steps[-2:] == ['installing', 'done']


def test_scripts_need_a_decision_for_each_script_of_this_package(tmp_path):
    host = FakeHost({**PREVIEW, 'scripts': ['postinstall', 'prepare']})
    service = make(tmp_path, net=FastNpm(), host=host)
    fetched = service.fetch('npm', 'demo', version='1.0.0')
    for accepted in (None, [], ['postinstall'], ['postinstall', 'prepare', 'other']):
        with pytest.raises(ServiceError) as error:
            service.install(fetched['fetchId'], accept=True, digest='d' * 64, scripts='do-not-run', scripts_accepted=accepted)
        assert error.value.code == 'scripts_not_reviewed'
    assert host.installs == []
    service.install(fetched['fetchId'], accept=True, digest='d' * 64, scripts='do-not-run', scripts_accepted=['prepare', 'postinstall'])
    assert host.installs[-1]['confirmation'] == {'accept': True, 'digest': 'd' * 64, 'scripts': 'do-not-run'}
    # A second package with the same scripts gets no decision from the first one.
    again = service.fetch('npm', 'demo', version='1.0.0')
    with pytest.raises(ServiceError):
        service.install(again['fetchId'], accept=True, digest='d' * 64, scripts='do-not-run')


def test_the_routes_start_poll_and_cancel_and_need_the_person(tmp_path, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from cordis.router import router
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    human = {'x-oharness-human': 'human-secret'}
    net = SlowNet()
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = make(tmp_path, net=net)
    client = TestClient(app)
    body = {'kind': 'npm', 'spec': 'demo', 'version': '1.0.0', 'live': True}
    assert client.post('/cordis/plugins/fetch', json=body).status_code == 403
    started = client.post('/cordis/plugins/fetch', json=body, headers=human).json()
    assert started['state'] == 'running'
    assert net.started.wait(5)
    assert client.get(f'/cordis/plugins/fetch/{started["fetchId"]}').status_code == 403
    assert client.delete(f'/cordis/plugins/fetch/{started["fetchId"]}').status_code == 403
    seen = client.get(f'/cordis/plugins/fetch/{started["fetchId"]}', headers=human).json()
    assert seen['events'][0]['step'] == 'downloading'
    cancelled = client.delete(f'/cordis/plugins/fetch/{started["fetchId"]}', headers=human).json()
    assert cancelled['state'] == 'cancelled'
    assert not (tmp_path / 'cordis-plugins' / 'pkg' / started['fetchId']).exists()
