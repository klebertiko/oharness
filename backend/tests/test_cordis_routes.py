"""`/cordis/*` against the real host, with a fake npm and GitHub (no network). Mutations need the human credential."""
from __future__ import annotations

import io
import tarfile

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cordis.router import router
from cordis.service import CordisService
from cordis.supervisor import RUNNING
from cordis_support import FakeNet, alive, node_problem, plugin_files, wait_until

HUMAN = {'x-oharness-human': 'human-secret'}
COMMIT = 'b' * 40
needs_node = pytest.mark.skipif(node_problem() is not None, reason=node_problem() or '')


@pytest.fixture(scope='module')
def stack(tmp_path_factory):
    net = FakeNet()
    service = CordisService(tmp_path_factory.mktemp('cordis'), fetcher=net)
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    service.start()
    assert wait_until(lambda: service.supervisor.state == RUNNING, 60), service.supervisor.status()
    with TestClient(app) as client:
        yield client, net, service
    service.stop()


@pytest.fixture()
def api(stack, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    client, net, service = stack
    yield client, net, service
    for row in client.get('/cordis/plugins').json()['plugins']:
        client.delete(f'/cordis/plugins/{row["id"]}', headers=HUMAN)


def fetch_npm(client, net, version='1.0.0', **files):
    net.add_npm('backend-probe', version, plugin_files(version, **files))
    response = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'npm', 'spec': 'backend-probe', 'version': version})
    assert response.status_code == 200, response.text
    return response.json()


def install(client, fetched, **override):
    body = {'fetch_id': fetched['fetchId'], 'accept': True, 'digest': fetched['preview']['digest'], **override}
    return client.post('/cordis/plugins/install', headers=HUMAN, json=body)


def invoke(service):
    return service.supervisor.request('POST', '/v1/tools/invoke', {'name': 'probe_info', 'args': {}})


@needs_node
def test_mutations_without_the_human_credential_are_403(api):
    client, net, _ = api
    fetched = fetch_npm(client, net)
    calls = [
        client.post('/cordis/plugins/fetch', json={'kind': 'npm', 'spec': 'backend-probe', 'version': '1.0.0'}),
        client.post('/cordis/plugins/install', json={'fetch_id': fetched['fetchId'], 'accept': True, 'digest': fetched['preview']['digest']}),
        client.post(f'/cordis/plugins/{"0" * 16}/enable'),
        client.post(f'/cordis/plugins/{"0" * 16}/disable'),
        client.delete(f'/cordis/plugins/{"0" * 16}'),
        client.post('/cordis/plugins/install', headers={'x-oharness-human': 'wrong'}, json={'fetch_id': fetched['fetchId'], 'accept': True, 'digest': 'x'}),
    ]
    assert [call.status_code for call in calls] == [403] * 6
    assert all(call.json()['detail']['code'] == 'human_only' for call in calls)
    assert client.get('/cordis/plugins').json() == {'plugins': []}


@needs_node
def test_reads_work_without_the_human_credential(api):
    client, net, _ = api
    install(client, fetch_npm(client, net))
    assert client.get('/cordis/status').json()['state'] == 'running'
    rows = client.get('/cordis/plugins').json()['plugins']
    assert [row['name'] for row in rows] == ['backend-probe']
    assert client.get(f'/cordis/plugins/{rows[0]["id"]}/logs').status_code == 200


@needs_node
def test_fetch_previews_with_the_host_warning_and_installs_only_with_the_digest(api):
    client, net, service = api
    fetched = fetch_npm(client, net)
    preview = fetched['preview']
    assert preview['name'] == 'backend-probe' and preview['runtime'] == 'isolated' and preview['capabilities'] == []
    assert preview['warning']['en'] and preview['warning']['pt-BR'] and preview['digest']
    assert fetched['source'] == {'kind': 'npm', 'spec': 'backend-probe', 'version': '1.0.0'}
    assert 'realpath' not in preview
    assert client.get('/cordis/plugins').json() == {'plugins': []}
    # nothing is loaded without accept and the right digest
    refused = install(client, fetched, accept=False)
    assert refused.status_code == 409 and refused.json()['detail']['code'] == 'confirmation-required'
    wrong = install(client, fetched, digest='0' * 64)
    assert wrong.status_code == 409 and wrong.json()['detail']['code'] == 'confirmation-mismatch'
    assert client.get('/cordis/plugins').json() == {'plugins': []}
    assert invoke(service)['ok'] is False
    done = install(client, fetched)
    assert done.status_code == 200, done.text
    view = done.json()
    assert view['state'] == 'active' and view['enabled'] is True and view['runtime'] == 'isolated'
    assert invoke(service)['value']['version'] == '1.0.0'
    assert install(client, fetched).status_code == 404  # a fetch is used once


@needs_node
def test_an_isolated_plugin_runs_in_its_own_process_and_its_output_is_captured_by_prefix(api):
    client, net, service = api
    view = install(client, fetch_npm(client, net, say='hello from the probe')).json()
    pid = invoke(service)['value']['pid']
    assert pid != service.supervisor.host_pid and alive(pid)
    assert wait_until(lambda: 'hello from the probe' in client.get(f'/cordis/plugins/{view["id"]}/logs').json()['lines'], 10)
    assert not any('hello from the probe' in line for line in service.supervisor.status()['hostLog'])


@needs_node
def test_disable_unloads_and_enable_loads_again(api):
    client, net, service = api
    view = install(client, fetch_npm(client, net)).json()
    off = client.post(f'/cordis/plugins/{view["id"]}/disable', headers=HUMAN).json()
    assert off['state'] == 'disabled' and off['enabled'] is False
    assert invoke(service)['ok'] is False
    on = client.post(f'/cordis/plugins/{view["id"]}/enable', headers=HUMAN).json()
    assert on['state'] == 'active' and on['enabled'] is True
    assert invoke(service)['ok'] is True


@needs_node
def test_installing_another_version_replaces_it_without_restarting_the_host(api):
    client, net, service = api
    first = install(client, fetch_npm(client, net, '1.0.0')).json()
    host = service.supervisor.host_pid
    second = install(client, fetch_npm(client, net, '2.0.0'))
    assert second.status_code == 200, second.text
    assert second.json()['id'] == first['id'] and second.json()['version'] == '2.0.0'
    assert invoke(service)['value']['version'] == '2.0.0'
    assert service.supervisor.host_pid == host
    assert len(client.get('/cordis/plugins').json()['plugins']) == 1


@needs_node
def test_delete_unloads_and_removes_the_files(api):
    client, net, service = api
    view = install(client, fetch_npm(client, net)).json()
    package = service.registry.get(view['id'])['packageDir']
    removed = client.delete(f'/cordis/plugins/{view["id"]}', headers=HUMAN)
    assert removed.status_code == 204
    assert client.get('/cordis/plugins').json() == {'plugins': []}
    assert invoke(service)['ok'] is False
    import os
    assert not os.path.exists(package)
    again = client.delete(f'/cordis/plugins/{view["id"]}', headers=HUMAN)
    assert again.status_code == 404


@needs_node
def test_a_bad_download_is_refused_and_leaves_nothing_behind(api):
    client, net, service = api
    net.add_npm('backend-probe', '1.0.0', plugin_files('1.0.0'))
    import json
    before = sorted(path.name for path in service.packages.iterdir()) if service.packages.exists() else []
    meta_url = 'https://registry.npmjs.org/backend-probe/1.0.0'
    meta = json.loads(net.routes[meta_url])
    meta['dist']['integrity'] = 'sha512-' + 'A' * 86 + '=='
    net.routes[meta_url] = json.dumps(meta).encode()
    response = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'npm', 'spec': 'backend-probe', 'version': '1.0.0'})
    assert response.status_code == 422 and response.json()['detail']['code'] == 'integrity_mismatch'
    assert (sorted(path.name for path in service.packages.iterdir()) if service.packages.exists() else []) == before
    bad = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'github', 'spec': 'acme/demo', 'commit': 'main'})
    assert bad.status_code == 422 and bad.json()['detail']['code'] == 'invalid_spec'


@needs_node
def test_github_source_keeps_its_commit_and_offers_a_share_link(api):
    client, net, _ = api
    net.add_github('acme/demo', COMMIT, {f'plugins/one/{k}': v for k, v in plugin_files('1.0.0').items()})
    fetched = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'github', 'spec': 'acme/demo', 'commit': COMMIT, 'subdir': 'plugins/one'})
    assert fetched.status_code == 200, fetched.text
    view = install(client, fetched.json()).json()
    assert view['source'] == {'kind': 'github', 'spec': 'acme/demo', 'commit': COMMIT, 'subdir': 'plugins/one'}
    assert view['shareLink'] == f'https://github.com/acme/demo/tree/{COMMIT}/plugins/one'


@needs_node
def test_local_folder_source_and_export_as_a_tarball(api, tmp_path):
    client, _, _ = api
    folder = tmp_path / 'mine'
    folder.mkdir()
    for name, data in plugin_files('0.1.0').items():
        (folder / name).write_bytes(data)
    fetched = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'local', 'spec': str(folder)})
    assert fetched.status_code == 200, fetched.text
    view = install(client, fetched.json()).json()
    assert 'shareLink' not in view
    exported = client.get(f'/cordis/plugins/{view["id"]}/export')
    assert exported.status_code == 200 and exported.headers['content-type'] == 'application/gzip'
    assert 'backend-probe-0.1.0.tgz' in exported.headers['content-disposition']
    with tarfile.open(fileobj=io.BytesIO(exported.content), mode='r:gz') as tar:
        assert sorted(tar.getnames()) == ['package/index.ts', 'package/package.json']


@needs_node
def test_the_host_token_never_appears_in_any_response(api):
    client, net, service = api
    token = service.supervisor._token
    fetched = fetch_npm(client, net)
    view = install(client, fetched).json()
    texts = [
        client.get('/cordis/status').text, client.get('/cordis/plugins').text,
        client.get(f'/cordis/plugins/{view["id"]}/logs').text, str(fetched), str(view),
        client.get(f'/cordis/plugins/{view["id"]}/export').content.decode('latin-1'),
    ]
    assert not any(token in text for text in texts)


@needs_node
def test_a_dependency_the_host_does_not_install_is_warned_about_in_the_preview(api):
    client, net, _ = api
    files = plugin_files('1.0.0')
    import json
    manifest = json.loads(files['package.json'])
    manifest['dependencies'] = {'cordis': '4.0.0-rc.11', 'left-pad': '1.3.0'}
    files['package.json'] = json.dumps(manifest).encode()
    net.add_npm('backend-probe', '1.0.0', files)
    fetched = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'npm', 'spec': 'backend-probe', 'version': '1.0.0'}).json()
    assert fetched['preview']['unmetDependencies'] == ['left-pad']
    assert fetched['preview']['warnings'] == [{'code': 'unmet-dependencies', 'dependencies': ['left-pad']}]


def test_routes_answer_503_while_the_host_is_not_available(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    service = CordisService(tmp_path, enabled=False)
    service.start()
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    with TestClient(app) as client:
        assert client.get('/cordis/status').json()['state'] == 'unavailable'
        blocked = client.post('/cordis/plugins/fetch', headers=HUMAN, json={'kind': 'npm', 'spec': 'backend-probe', 'version': '1.0.0'})
        assert blocked.status_code == 503 and blocked.json()['detail']['code'] == 'cordis_unavailable'
