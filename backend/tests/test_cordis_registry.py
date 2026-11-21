"""The plugin registry: a small JSON file under the data folder (ADR 0071)."""
from __future__ import annotations

import json

from cordis.registry import Registry


def entry(name='demo', **extra):
    return {
        'name': name, 'version': '1.0.0', 'source': {'kind': 'npm', 'spec': f'{name}@1.0.0'},
        'packageDir': f'/data/{name}', 'digest': 'd' * 64, 'scripts': [], 'enabled': True, **extra,
    }


def test_add_list_and_persist(tmp_path):
    registry = Registry(tmp_path / 'cordis-plugins.json')
    saved = registry.upsert(entry())
    assert saved['id'] and registry.list() == [saved]
    assert Registry(tmp_path / 'cordis-plugins.json').get(saved['id']) == saved


def test_same_name_replaces_and_keeps_the_id(tmp_path):
    registry = Registry(tmp_path / 'r.json')
    first = registry.upsert(entry())
    second = registry.upsert(entry(version='2.0.0'))
    assert second['id'] == first['id'] and registry.list() == [second]


def test_enable_disable_remove(tmp_path):
    registry = Registry(tmp_path / 'r.json')
    saved = registry.upsert(entry())
    assert registry.set_enabled(saved['id'], False)['enabled'] is False
    assert registry.remove(saved['id'])['name'] == 'demo'
    assert registry.list() == [] and registry.get(saved['id']) is None
    assert registry.remove('nope') is None and registry.set_enabled('nope', True) is None


def test_a_corrupt_file_is_set_aside_and_the_registry_starts_empty(tmp_path):
    file = tmp_path / 'r.json'
    file.write_text('{not json')
    registry = Registry(file)
    assert registry.list() == []
    registry.upsert(entry())
    assert json.loads(file.read_text())['plugins'][0]['name'] == 'demo'
    assert (tmp_path / 'r.json.bad').exists()


def test_the_write_is_atomic_and_leaves_no_temp_file(tmp_path):
    registry = Registry(tmp_path / 'r.json')
    registry.upsert(entry())
    assert sorted(path.name for path in tmp_path.iterdir()) == ['r.json']
