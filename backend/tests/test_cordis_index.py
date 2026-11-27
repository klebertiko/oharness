"""Descobrir: a static plugin index (`format: 1`) fetched by the sidecar over https, with a size ceiling, and checked before the screen sees it."""
from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from cordis import index
from cordis.index import PluginIndexError
from cordis.router import router
from cordis.service import CordisService

HUMAN = {'x-oharness-human': 'human-secret'}
SHA = 'c' * 40
PUBLIC = {'example.com': ['93.184.215.14']}


def resolver(table):
    return lambda host: table.get(host, [])


def good(**over):
    body = {'format': 1, 'title': 'Community', 'plugins': [
        {'name': 'notes-tool', 'title': 'Notes', 'description': 'Keeps notes.', 'author': 'Ana', 'repository': 'https://github.com/ana/notes',
         'versions': [{'version': '1.2.0', 'source': {'type': 'npm'}}]},
        {'name': 'git-thing', 'title': 'Git thing', 'description': '<b>bold</b>', 'author': 'Bo',
         'versions': [{'version': '0.1.0', 'source': {'type': 'git', 'url': 'https://github.com/bo/thing.git', 'commit': SHA, 'path': 'packages/x'}}]},
    ]}
    body.update(over)
    return json.dumps(body).encode()


def test_a_valid_index_keeps_plain_text_and_the_sources():
    seen = index.parse(good())
    assert seen['title'] == 'Community' and seen['skipped'] == 0
    npm, git = seen['plugins']
    assert npm['versions'][0]['source'] == {'type': 'npm'}
    assert git['versions'][0]['source'] == {'type': 'git', 'url': 'https://github.com/bo/thing.git', 'commit': SHA, 'path': 'packages/x', 'repo': 'bo/thing'}
    assert git['description'] == '<b>bold</b>'  # kept as text; the screen never renders it as HTML


@pytest.mark.parametrize('raw', [b'not json', b'[]', json.dumps({'format': 2, 'plugins': []}).encode(), json.dumps({'format': 1}).encode()])
def test_an_index_with_the_wrong_shape_is_refused(raw):
    with pytest.raises(PluginIndexError) as error:
        index.parse(raw)
    assert error.value.code == 'invalid_index'


def test_bad_entries_are_skipped_not_trusted():
    raw = good(plugins=[
        {'name': 'ok', 'versions': [{'version': '1.0.0', 'source': {'type': 'npm'}}]},
        {'name': 'Bad Name', 'versions': [{'version': '1.0.0', 'source': {'type': 'npm'}}]},
        {'name': 'branch', 'versions': [{'version': '1.0.0', 'source': {'type': 'git', 'url': 'https://github.com/a/b', 'commit': 'main'}}]},
        {'name': 'http-git', 'versions': [{'version': '1.0.0', 'source': {'type': 'git', 'url': 'http://github.com/a/b', 'commit': SHA}}]},
        {'name': 'escape', 'versions': [{'version': '1.0.0', 'source': {'type': 'git', 'url': 'https://github.com/a/b', 'commit': SHA, 'path': '../x'}}]},
        {'name': 'tarball', 'versions': [{'version': '1.0.0', 'source': {'type': 'tarball', 'url': 'https://x'}}]},
        {'name': 'javascript-repo', 'repository': 'javascript:alert(1)', 'versions': [{'version': '1.0.0', 'source': {'type': 'npm'}}]},
        'not an object',
    ])
    seen = index.parse(raw)
    assert [p['name'] for p in seen['plugins']] == ['ok', 'javascript-repo']
    assert seen['plugins'][1]['repository'] is None
    assert seen['skipped'] == 6


def test_text_fields_are_capped_and_stripped_of_control_characters():
    raw = good(plugins=[{'name': 'long', 'title': 'a‮b\x00c', 'description': 'x' * 5000, 'versions': [{'version': '1.0.0', 'source': {'type': 'npm'}}]}])
    plugin = index.parse(raw)['plugins'][0]
    assert plugin['title'] == 'abc' and len(plugin['description']) == index.TEXT_LIMITS['description']


@pytest.mark.parametrize('url', ['http://example.com/i.json', 'https://user:pw@example.com/i.json', 'file:///etc/passwd', 'https://localhost/i.json',
                                 'https://127.0.0.1/i.json', 'https://10.0.0.1/i.json', 'https://[::1]/i.json', 'ftp://example.com/i.json'])
def test_only_public_https_addresses_are_fetched(url):
    calls = []
    with pytest.raises(PluginIndexError) as error:
        index.fetch(url, fetcher=lambda u, limit: calls.append(u) or b'{}', resolve=resolver(PUBLIC))
    assert error.value.code == 'invalid_url' and calls == []


def test_the_fetch_has_a_size_ceiling():
    with pytest.raises(PluginIndexError) as error:
        index.fetch('https://example.com/i.json', fetcher=lambda u, limit: b'x' * (limit + 1), resolve=resolver(PUBLIC))
    assert error.value.code == 'index_too_large'


def test_the_route_needs_the_human_credential_and_answers_the_parsed_index(tmp_path, monkeypatch):
    monkeypatch.setenv('OH_HUMAN_TOKEN', 'human-secret')
    service = CordisService(tmp_path, enabled=False)
    service.index_fetcher = lambda u, limit: good()
    service.index_resolver = resolver(PUBLIC)
    app = FastAPI()
    app.include_router(router)
    app.state.cordis = service
    client = TestClient(app)
    assert client.post('/cordis/index/fetch', json={'url': 'https://example.com/i.json'}).status_code == 403
    done = client.post('/cordis/index/fetch', headers=HUMAN, json={'url': 'https://example.com/i.json'})
    assert done.status_code == 200 and [p['name'] for p in done.json()['plugins']] == ['notes-tool', 'git-thing']
    bad = client.post('/cordis/index/fetch', headers=HUMAN, json={'url': 'http://example.com/i.json'})
    assert bad.status_code == 422 and bad.json()['detail']['code'] == 'invalid_url'


@pytest.mark.parametrize('answers', [['127.0.0.1'], ['10.1.2.3'], ['169.254.169.254'], ['93.184.215.14', '192.168.0.9'], ['::1'], ['fd00::1'], []])
def test_a_name_that_resolves_to_a_local_or_private_address_is_refused(answers):
    calls = []
    with pytest.raises(PluginIndexError) as error:
        index.fetch('https://Index.Example.org./i.json', fetcher=lambda u, limit: calls.append(u) or good(),
                    resolve=resolver({'index.example.org': answers}))
    assert error.value.code == 'invalid_url' and calls == []


def test_the_host_is_normalized_before_it_is_resolved():
    asked = []
    seen = index.fetch('https://EXAMPLE.com./i.json', fetcher=lambda u, limit: good(), resolve=lambda host: asked.append(host) or ['93.184.215.14'])
    assert asked == ['example.com'] and seen['plugins']


def test_the_connection_goes_to_the_checked_address_with_the_name_for_tls_and_host(monkeypatch):
    opened = {}

    class FakeResponse:
        status = 200
        left = [good()]

        def read(self, n):  # a stream: the body once, then end of file (the reader now reads in chunks)
            return self.left.pop() if self.left else b''

    class FakeConnection:
        def __init__(self, host, address, timeout):
            opened.update(host=host, address=address, timeout=timeout)

        def request(self, method, path, headers):
            opened.update(method=method, path=path, headers=headers)

        def getresponse(self):
            return FakeResponse()

        def close(self):
            opened['closed'] = True

    monkeypatch.setattr(index, '_PinnedConnection', FakeConnection)
    seen = index.fetch('https://example.com/list/i.json?x=1', resolve=resolver(PUBLIC))
    assert seen['plugins'] and opened['host'] == 'example.com' and opened['address'] == '93.184.215.14'
    assert opened['path'] == '/list/i.json?x=1' and opened['timeout'] == index.TIMEOUT_S and opened['closed']


@pytest.mark.parametrize('status', [301, 302, 307, 308])
def test_a_redirect_is_refused(monkeypatch, status):
    class Redirect:
        def __init__(self, *a):
            pass

        def request(self, *a, **k):
            pass

        def getresponse(self):
            return type('R', (), {'status': status, 'read': lambda self, n: b''})()

        def close(self):
            pass

    monkeypatch.setattr(index, '_PinnedConnection', Redirect)
    with pytest.raises(PluginIndexError) as error:
        index.fetch('https://example.com/i.json', resolve=resolver(PUBLIC))
    assert error.value.code == 'redirect_refused'
