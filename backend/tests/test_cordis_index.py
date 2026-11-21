"""The static plugin index is JSON only. Parsing it never runs package code, and a file cannot mark itself reviewed."""
from __future__ import annotations

import json

import pytest

from cordis.index import build_index, load_index, parse_index, validate_index_url
from cordis.sources import SourceError


def test_parse_keeps_package_facts_and_drops_any_claim_of_review():
    raw = json.dumps({
        'version': 1,
        'trust': 'reviewed',
        'plugins': [{
            'name': 'widget',
            'version': '1.2.3',
            'description': 'Lists files',
            'source': {'kind': 'npm', 'spec': 'widget', 'version': '1.2.3'},
        }],
    }).encode()
    parsed = parse_index(raw)
    assert parsed['trust'] == 'unreviewed'
    assert parsed['plugins'] == [{
        'name': 'widget',
        'version': '1.2.3',
        'description': 'Lists files',
        'source': {'kind': 'npm', 'spec': 'widget', 'version': '1.2.3'},
    }]


def test_parse_refuses_code_and_non_json():
    with pytest.raises(SourceError) as refused:
        parse_index(json.dumps({'version': 1, 'plugins': [{'name': 'a', 'version': '1', 'scripts': {'install': 'node evil.js'}, 'source': {'kind': 'npm', 'spec': 'a'}}]}).encode())
    assert refused.value.code == 'bad_index'
    with pytest.raises(SourceError) as broken:
        parse_index(b'not json')
    assert broken.value.code == 'bad_index'


def test_load_uses_the_fetcher_and_does_not_accept_a_private_address():
    seen = []

    def fetcher(url: str, limit: int) -> bytes:
        seen.append((url, limit))
        return json.dumps({'version': 1, 'plugins': []}).encode()

    assert load_index('https://index.example/plugins.json', fetcher=fetcher)['plugins'] == []
    assert seen[0][0] == 'https://index.example/plugins.json'
    for url in ('http://index.example/plugins.json', 'https://127.0.0.1/plugins.json', 'https://user:pw@index.example/a'):
        with pytest.raises(SourceError) as refused:
            load_index(url, fetcher=fetcher)
        assert refused.value.code == 'untrusted_host'
    validate_index_url('https://index.example/plugins.json')


def test_build_index_is_the_same_shape_and_carries_no_scripts():
    index = build_index([{
        'name': 'widget',
        'version': '1.2.3',
        'description': 'Lists files',
        'source': {'kind': 'github', 'spec': 'acme/widget', 'commit': 'a' * 40},
        'scripts': ['install'],
    }])
    assert index['trust'] == 'unreviewed'
    assert 'scripts' not in index['plugins'][0]
    assert index['plugins'][0]['source']['commit'] == 'a' * 40
