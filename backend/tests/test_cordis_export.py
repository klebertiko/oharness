"""Exportar (ADR 0071): the package as a reproducible .tgz and a `format: 1` index with this plugin, built by reading files only."""
from __future__ import annotations

import base64
import hashlib
import json

import pytest

from cordis import index
from cordis.service import CordisService, ServiceError


def installed(tmp_path, source, manifest=None):
    service = CordisService(tmp_path, enabled=False)
    pkg = service.packages / ('a' * 16) / 'package'
    pkg.mkdir(parents=True)
    body = {'name': 'demo', 'version': '1.2.3', 'description': 'Says hi\u202e', 'author': {'name': 'Ana'},
            'repository': {'type': 'git', 'url': 'git+https://github.com/acme/demo.git'}, 'homepage': 'https://acme.dev', 'main': './index.ts',
            'scripts': {'postinstall': 'node evil.js'}}
    (pkg / 'package.json').write_text(json.dumps(manifest or body), encoding='utf8')
    (pkg / 'index.ts').write_text('throw new Error("never run")\n', encoding='utf8')
    entry = service.registry.upsert({'name': 'demo', 'version': '1.2.3', 'source': source, 'packageDir': str(pkg), 'stageDir': str(pkg.parent),
                                     'digest': 'd' * 64, 'scripts': [], 'enabled': False, 'runtime': 'isolated', 'capabilities': []})
    return service, entry['id']


def test_the_tgz_is_the_same_bytes_every_time(tmp_path):
    service, plugin_id = installed(tmp_path, {'kind': 'local', 'spec': 'C:/x'})
    name, first = service.export(plugin_id)
    assert name == 'demo-1.2.3.tgz'
    assert service.export(plugin_id)[1] == first


def test_a_local_plugin_is_indexed_as_a_tarball_with_the_hash_of_the_export(tmp_path):
    service, plugin_id = installed(tmp_path, {'kind': 'local', 'spec': 'C:/x'})
    _name, data = service.export(plugin_id)
    built = service.export_index(plugin_id)
    assert built['format'] == 1
    [plugin] = built['plugins']
    assert plugin['name'] == 'demo' and plugin['description'] == 'Says hi' and plugin['author'] == 'Ana'
    assert plugin['repository'] == 'https://github.com/acme/demo'
    [version] = plugin['versions']
    assert version['version'] == '1.2.3'
    assert version['source'] == {'type': 'tarball', 'url': './demo-1.2.3.tgz', 'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()}


def test_npm_and_github_sources_keep_their_own_kind(tmp_path):
    service, plugin_id = installed(tmp_path / 'a', {'kind': 'npm', 'spec': 'demo', 'version': '1.2.3'})
    assert service.export_index(plugin_id)['plugins'][0]['versions'][0]['source'] == {'type': 'npm'}
    service, plugin_id = installed(tmp_path / 'b', {'kind': 'github', 'spec': 'acme/demo', 'commit': 'c' * 40, 'subdir': 'pkg'})
    source = service.export_index(plugin_id)['plugins'][0]['versions'][0]['source']
    assert source == {'type': 'git', 'url': 'https://github.com/acme/demo', 'commit': 'c' * 40, 'path': 'pkg'}


def test_the_exported_index_reads_back_as_an_index(tmp_path):
    service, plugin_id = installed(tmp_path, {'kind': 'github', 'spec': 'acme/demo', 'commit': 'c' * 40, 'subdir': ''})
    parsed = index.parse(json.dumps(service.export_index(plugin_id)).encode())
    assert parsed['plugins'][0]['versions'][0]['source']['repo'] == 'acme/demo'


def test_an_unknown_plugin_is_404(tmp_path):
    service = CordisService(tmp_path, enabled=False)
    with pytest.raises(ServiceError) as error:
        service.export_index('0' * 16)
    assert error.value.status == 404
