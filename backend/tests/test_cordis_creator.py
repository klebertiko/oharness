"""Creator actions are one approval each, and the starting files are written without being run."""
from __future__ import annotations

import json

import pytest

from cordis.creator import ActionBook, CreatorError, read_description, write_starter
from cordis.service import CordisService


def test_approving_one_action_does_not_decide_the_other():
    book = ActionBook()
    first = book.propose(fetch_id='a' * 16, digest='d1', summary='one', scripts='do-not-run')
    second = book.propose(fetch_id='b' * 16, digest='d2', summary='two', scripts=None)
    claimed = book.claim(first['id'], 'approve')
    assert claimed['fetchId'] == 'a' * 16
    assert book.list()[1]['status'] == 'pending'
    book.finish(first['id'], 'approved')
    rejected = book.claim(second['id'], 'reject')
    assert rejected['status'] == 'rejected'
    with pytest.raises(CreatorError) as again:
        book.claim(first['id'], 'approve')
    assert again.value.code == 'action_not_pending'


def test_write_starter_does_not_run_the_files(tmp_path):
    written = write_starter(str(tmp_path), 'widget', 'Lists files\nand more')
    package = tmp_path / 'widget'
    manifest = json.loads((package / 'package.json').read_text(encoding='utf-8'))
    assert manifest['name'] == 'widget'
    assert manifest['oharness'] == {'runtime': 'isolated', 'capabilities': []}
    assert 'scripts' not in manifest
    assert (package / 'index.js').read_text(encoding='utf-8').startswith('export const name = "widget"')
    assert written['files'] == ['index.js', 'package.json']
    assert read_description(package) == 'Lists files and more'
    with pytest.raises(CreatorError):
        write_starter(str(tmp_path), 'widget', 'again')


def test_share_writes_an_index_without_running_the_package(tmp_path, monkeypatch):
    def refuse(*_args, **_kwargs):
        raise AssertionError('package code was executed')

    monkeypatch.setattr('subprocess.run', refuse)
    service = CordisService(tmp_path, enabled=False)
    stage = service.packages / 'stage'
    package = stage / 'pkg'
    package.mkdir(parents=True)
    (package / 'package.json').write_text(json.dumps({
        'name': 'widget',
        'version': '1.2.3',
        'description': 'Lists files',
        'scripts': {'install': 'node evil.js'},
    }), encoding='utf-8')
    (package / 'evil.js').write_text('throw new Error("ran")\n', encoding='utf-8')
    saved = service.registry.upsert({
        'name': 'widget',
        'version': '1.2.3',
        'source': {'kind': 'npm', 'spec': 'widget', 'version': '1.2.3'},
        'packageDir': str(package),
        'stageDir': str(stage),
        'digest': 'abc',
        'scripts': ['install'],
        'enabled': False,
        'runtime': 'isolated',
        'capabilities': [],
    })
    shared = service.share(saved['id'], 'npm')
    assert shared['scriptsExecuted'] is False
    assert shared['filename'] == 'widget-1.2.3.tgz'
    assert shared['index']['trust'] == 'unreviewed'
    assert shared['index']['plugins'][0]['description'] == 'Lists files'
    assert 'install' not in json.dumps(shared['index'])
    stored = json.loads((tmp_path / 'cordis-marketplace.json').read_text(encoding='utf-8'))
    assert stored['plugins'][0]['name'] == 'widget'
    assert service.marketplace()['trust'] == 'unreviewed'
