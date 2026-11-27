"""Hardening of the plugin manager (ADR 0071): unpacking with a real ceiling, Windows names, cancel and job races, a total
deadline on the index request, a ceiling on live jobs and a safe export file name. No network and no Node."""
from __future__ import annotations

import gzip
import io
import re
import tarfile
import threading
import time

import pytest

from cordis import index, sources
from cordis.service import CordisService, ServiceError
from cordis.sources import SourceError
from test_cordis_progress import FakeHost, FastNpm, SlowNet, make
from test_cordis_sources import tar_gz

PUBLIC = {'example.com': ['93.184.215.14']}


# -- item 5: the gzip is unpacked with a ceiling before tarfile sees it ------------------------
def test_a_small_gzip_that_expands_past_the_ceiling_is_refused(tmp_path):
    bomb = gzip.compress(b'\0' * (sources.MAX_UNPACKED_BYTES + 1024 * 1024), mtime=0)
    assert len(bomb) < 1024 * 1024  # small on the wire
    with pytest.raises(SourceError) as error:
        sources._extract(bomb, tmp_path / 'out')
    assert error.value.code == 'archive_too_large'


def test_a_tar_with_a_huge_pax_header_is_refused(tmp_path):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w', format=tarfile.PAX_FORMAT) as tar:
        info = tarfile.TarInfo('package/package.json')
        info.pax_headers = {'comment': 'x' * (sources.MAX_UNPACKED_BYTES + 1024)}
        info.size = 2
        tar.addfile(info, io.BytesIO(b'{}'))
    data = gzip.compress(buffer.getvalue(), mtime=0)
    with pytest.raises(SourceError) as error:
        sources._extract(data, tmp_path / 'out')
    assert error.value.code == 'archive_too_large'


@pytest.mark.parametrize('name', ['CON', 'con', 'nul.txt', 'Aux.json', 'prn', 'com1', 'COM9.log', 'lpt1', 'Lpt9.d.ts', 'con.tar.gz'])
def test_windows_reserved_names_are_refused_in_any_part_of_the_path(tmp_path, name):
    for path in (f'package/{name}', f'package/{name}/index.ts'):
        with pytest.raises(SourceError) as error:
            sources._extract(tar_gz({'package/package.json': b'{}', path: b'x'}), tmp_path / 'out')
        assert error.value.code == 'unsafe_archive'


@pytest.mark.parametrize('name', ['index.ts.', 'index.ts ', 'dir./a.ts', 'dir /a.ts'])
def test_a_part_ending_in_a_dot_or_a_space_is_refused(tmp_path, name):
    with pytest.raises(SourceError) as error:
        sources._extract(tar_gz({'package/package.json': b'{}', f'package/{name}': b'x'}), tmp_path / 'out')
    assert error.value.code == 'unsafe_archive'


@pytest.mark.parametrize('name', ['console.ts', 'com10', 'lpt0', 'nulls.json', 'auxiliary'])
def test_names_that_only_look_reserved_are_kept(tmp_path, name):
    root = sources._extract(tar_gz({'package/package.json': b'{}', f'package/{name}': b'x'}), tmp_path / 'out')
    assert (root / name).is_file()


def test_a_local_folder_with_a_reserved_name_is_refused(tmp_path, monkeypatch):
    source = tmp_path / 'src'
    source.mkdir()
    (source / 'package.json').write_text('{}', encoding='utf8')
    (source / 'lib').mkdir()
    (source / 'lib' / 'x.ts').write_text('x', encoding='utf8')
    real_walk = sources.os.walk

    def walk(top, **kwargs):  # Windows itself will not create these names, so the walk reports one
        for here, dirnames, filenames in real_walk(top, **kwargs):
            yield here, dirnames, [*filenames, 'aux.ts'] if here.endswith('lib') else filenames
    monkeypatch.setattr(sources.os, 'walk', walk)
    with pytest.raises(SourceError) as error:
        sources.fetch_local(str(source), tmp_path / 'dest')
    assert error.value.code == 'unsafe_archive' and 'name' in error.value.message  # refused for its name, not as a missing link


# -- item 6: a cancel that arrives right after the download never leaves a staged preview ------
def test_a_cancel_after_the_download_is_seen_before_the_preview_is_staged(tmp_path):
    cancel = threading.Event()

    class CancelDuringPreview(FakeHost):
        def __call__(self, method, path, body=None):
            if path == '/v1/plugins/preview':
                cancel.set()  # the person pressed Cancel just after the download finished
            return super().__call__(method, path, body)
    service = make(tmp_path, net=FastNpm(), host=CancelDuringPreview())
    with pytest.raises(ServiceError) as error:
        service.fetch('npm', 'demo', version='1.0.0', stage_id='b' * 16, cancel=cancel)
    assert error.value.code == 'cancelled'
    assert service._staged == {}
    assert not (service.packages / ('b' * 16)).exists()


# -- item 7: a total deadline on the index request, and a ceiling on live jobs ----------------
def test_a_slow_server_is_cut_by_the_total_deadline(monkeypatch):
    class Trickle:
        status = 200

        def read(self, n):  # one byte every 50 ms: never a socket timeout, never the end
            time.sleep(0.05)
            return b' '

    class SlowConnection:
        def __init__(self, host, address, timeout):
            self.sock = None

        def request(self, *a, **k):
            pass

        def getresponse(self):
            return Trickle()

        def close(self):
            pass
    monkeypatch.setattr(index, '_PinnedConnection', SlowConnection)
    monkeypatch.setattr(index, 'INDEX_TOTAL_S', 0.3)
    begun = time.monotonic()
    with pytest.raises(index.PluginIndexError) as error:
        index.fetch('https://example.com/i.json', resolve=lambda host: PUBLIC.get(host, []))
    assert error.value.code == 'download_timeout'
    assert time.monotonic() - begun < 3


def test_more_than_the_live_job_ceiling_is_refused_with_429(tmp_path):
    net = SlowNet()
    service = make(tmp_path, net=net)
    started = [service.start_fetch('npm', 'demo', version='1.0.0') for _ in range(service.MAX_LIVE_JOBS)]
    try:
        with pytest.raises(ServiceError) as error:
            service.start_fetch('npm', 'demo', version='1.0.0')
        assert error.value.status == 429 and error.value.code == 'too_many_jobs'
        service.index_fetcher = lambda url, limit: b'{"format": 1, "plugins": []}'
        service.index_resolver = lambda host: PUBLIC.get(host, [])
        with pytest.raises(ServiceError) as error:
            service.fetch_index('https://example.com/i.json')
        assert error.value.status == 429
    finally:
        for job in started:
            service.cancel_fetch(job['fetchId'])
    # once they end, a slot is free again
    service.index_fetcher = lambda url, limit: b'{"format": 1, "plugins": []}'
    service.index_resolver = lambda host: PUBLIC.get(host, [])
    assert service.fetch_index('https://example.com/i.json')['plugins'] == []


# -- item 8: the exported file name keeps only safe characters ------------------------------
@pytest.mark.parametrize('version', ['../x', '1.0/../../a', '1.0\x00\x1b[31m\n', '..', 'v' * 500])
def test_the_export_name_is_safe_for_any_version(tmp_path, version):
    service = CordisService(tmp_path, enabled=False)
    pkg = service.packages / ('a' * 16) / 'package'
    pkg.mkdir(parents=True)
    (pkg / 'package.json').write_text('{"name": "demo"}', encoding='utf8')
    entry = service.registry.upsert({'name': 'demo', 'version': version, 'source': {'kind': 'local', 'spec': 'C:/x'}, 'packageDir': str(pkg),
                                     'stageDir': str(pkg.parent), 'digest': 'd' * 64, 'scripts': [], 'enabled': False, 'runtime': 'isolated',
                                     'capabilities': []})
    name, _data = service.export(entry['id'])
    assert re.fullmatch(r'[A-Za-z0-9._-]+\.tgz', name), name
    assert '..' not in name and len(name) <= 140
