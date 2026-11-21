"""Screen routes that do not need the plugin host: index, share, starter files, and one approval per action."""
from __future__ import annotations

import json

from fastapi import FastAPI
from fastapi.testclient import TestClient

from cordis.router import router
from cordis.service import CordisService

HUMAN = {'x-oharness-human': 'human-secret'}


def test_index_share_and_starter_do_not_run_code(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    monkeypatch.setattr('subprocess.run', lambda *_a, **_k: (_ for _ in ()).throw(AssertionError('ran')))
    service = CordisService(tmp_path, enabled=False)
    stage = service.packages / 'stage'
    package = stage / 'pkg'
    package.mkdir(parents=True)
    (package / 'package.json').write_text(json.dumps({'name': 'widget', 'version': '1.2.3', 'description': 'Lists files', 'scripts': {'install': 'node evil.js'}}), encoding='utf-8')
    (package / 'index.js').write_text('throw new Error("ran")\n', encoding='utf-8')
    saved = service.registry.upsert({
        'name': 'widget', 'version': '1.2.3', 'source': {'kind': 'npm', 'spec': 'widget', 'version': '1.2.3'},
        'packageDir': str(package), 'stageDir': str(stage), 'digest': 'abc', 'scripts': ['install'],
        'enabled': False, 'runtime': 'isolated', 'capabilities': ['files'],
    })
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    with TestClient(app) as client:
        assert client.get('/cordis/marketplace').json()['trust'] == 'unreviewed'
        shared = client.post(f'/cordis/plugins/{saved["id"]}/share', headers=HUMAN, json={'target': 'git'})
        assert shared.status_code == 200, shared.text
        body = shared.json()
        assert body['scriptsExecuted'] is False
        assert body['index']['plugins'][0]['name'] == 'widget'
        assert 'install' not in json.dumps(body['index'])
        written = client.post('/cordis/creator/write', headers=HUMAN, json={'folder': str(tmp_path), 'name': 'fresh', 'description': 'A note'})
        assert written.status_code == 200, written.text
        assert sorted(written.json()['files']) == ['index.js', 'package.json']
        assert 'scripts' not in (tmp_path / 'fresh' / 'package.json').read_text(encoding='utf-8')
        apis = client.get('/cordis/creator/apis').json()['apis']
        assert {row['id'] for row in apis} == {'tools', 'commands', 'events', 'services'}
        assert {row['access'] for row in apis} == {'read'}


def test_two_actions_are_decided_separately(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    service = CordisService(tmp_path, enabled=False)
    service._staged['a' * 16] = {'preview': {'digest': 'd1', 'scripts': ['install'], 'name': 'alpha'}, 'packageDir': '', 'stageDir': '', 'source': {}}
    service._staged['b' * 16] = {'preview': {'digest': 'd2', 'scripts': [], 'name': 'beta'}, 'packageDir': '', 'stageDir': '', 'source': {}}
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    with TestClient(app) as client:
        first = client.post('/cordis/creator/actions', headers=HUMAN, json={'fetch_id': 'a' * 16, 'digest': 'd1', 'summary': 'alpha', 'scripts': 'do-not-run'})
        second = client.post('/cordis/creator/actions', headers=HUMAN, json={'fetch_id': 'b' * 16, 'digest': 'd2', 'summary': 'beta'})
        assert first.status_code == 200 and second.status_code == 200, (first.text, second.text)
        rejected = client.post(f'/cordis/creator/actions/{second.json()["id"]}/decide', headers=HUMAN, json={'decision': 'reject'})
        assert rejected.status_code == 200 and rejected.json()['applied'] is False
        still = client.get('/cordis/creator/actions').json()['actions']
        assert [row['status'] for row in still] == ['pending', 'rejected']
        # Approving the remaining action asks the host, which is off, and leaves the action pending.
        blocked = client.post(f'/cordis/creator/actions/{first.json()["id"]}/decide', headers=HUMAN, json={'decision': 'approve'})
        assert blocked.status_code == 503
        assert client.get('/cordis/creator/actions').json()['actions'][0]['status'] == 'pending'
