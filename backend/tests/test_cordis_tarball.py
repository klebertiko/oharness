"""Tarball as the fourth source (ADR 0071): an https `.tgz` with a required sha512 or sha256, or a local `.tgz` by absolute path."""
from __future__ import annotations

import base64
import hashlib
import os
import sys

import pytest

from cordis import index, sources
from cordis.sources import SourceError
from test_cordis_sources import package, tar_gz

URL = 'https://example.org/dist/demo-1.0.0.tgz'


def sri(data: bytes, algo: str = 'sha512') -> str:
    return f'{algo}-' + base64.b64encode(hashlib.new(algo, data).digest()).decode()


def server(data: bytes):
    calls = []

    def download(url, limit, cancel=None):
        calls.append(url)
        return data
    download.calls = calls
    return download


@pytest.mark.parametrize('algo', ['sha512', 'sha256'])
def test_an_https_tarball_with_the_right_integrity_is_unpacked(tmp_path, algo):
    data = tar_gz(package())
    root = sources.fetch_tarball(URL, sri(data, algo), tmp_path, download=server(data))
    assert (root / 'package.json').is_file()


def test_a_hex_sha256_is_accepted_too(tmp_path):
    data = tar_gz(package())
    assert sources.fetch_tarball(URL, hashlib.sha256(data).hexdigest(), tmp_path, download=server(data)).is_dir()


def test_wrong_integrity_is_refused_and_nothing_is_left(tmp_path):
    data = tar_gz(package())
    with pytest.raises(SourceError) as error:
        sources.fetch_tarball(URL, sri(b'other'), tmp_path, download=server(data))
    assert error.value.code == 'integrity_mismatch'
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize('integrity', [None, '', 'md5-abc', 'sha512-not base64!', 'sha1-' + 'A' * 27 + '='])
def test_an_https_tarball_needs_a_sha512_or_sha256(tmp_path, integrity):
    download = server(tar_gz(package()))
    with pytest.raises(SourceError) as error:
        sources.fetch_tarball(URL, integrity, tmp_path, download=download)
    assert error.value.code in ('integrity_missing', 'invalid_spec')
    assert download.calls == []  # nothing downloaded before the hash is known


@pytest.mark.parametrize('url', ['http://example.org/a.tgz', 'https://example.org/a.zip', 'https://user:pw@example.org/a.tgz', 'ftp://example.org/a.tgz'])
def test_only_https_tgz_addresses(tmp_path, url):
    with pytest.raises(SourceError) as error:
        sources.fetch_tarball(url, sri(b'x'), tmp_path, download=server(b''))
    assert error.value.code == 'invalid_spec'


def test_a_local_tgz_by_absolute_path(tmp_path):
    data = tar_gz(package())
    file = tmp_path / 'demo-1.0.0.tgz'
    file.write_bytes(data)
    dest = tmp_path / 'stage'
    assert (sources.fetch_tarball(str(file), None, dest) / 'package.json').is_file()
    with pytest.raises(SourceError) as error:  # a hash given for a local file is still checked
        sources.fetch_tarball(str(file), sri(b'other'), tmp_path / 'stage2')
    assert error.value.code == 'integrity_mismatch'


@pytest.mark.parametrize('spec', ['\\\\server\\share\\demo.tgz', '//server/share/demo.tgz', '\\\\?\\UNC\\server\\share\\demo.tgz', '/\\server\\share\\demo.tgz'])
def test_a_network_path_is_refused(tmp_path, spec):
    with pytest.raises(SourceError) as error:
        sources.fetch_tarball(spec, None, tmp_path)
    assert error.value.code == 'invalid_spec'


def test_relative_paths_and_other_files_are_refused(tmp_path):
    other = tmp_path / 'demo.zip'
    other.write_bytes(b'x')
    for spec in ('demo.tgz', str(other), str(tmp_path / 'missing.tgz')):
        with pytest.raises(SourceError) as error:
            sources.fetch_tarball(spec, None, tmp_path / 'stage')
        assert error.value.code == 'invalid_spec'


@pytest.mark.skipif(sys.platform == 'win32' and not hasattr(os, 'symlink'), reason='no symlinks')
def test_a_link_to_a_tarball_is_refused(tmp_path):
    real = tmp_path / 'real.tgz'
    real.write_bytes(tar_gz(package()))
    link = tmp_path / 'link.tgz'
    try:
        link.symlink_to(real)
    except OSError:
        pytest.skip('symlinks need privileges here')
    with pytest.raises(SourceError) as error:
        sources.fetch_tarball(str(link), None, tmp_path / 'stage')
    assert error.value.code == 'unsafe_archive'


def test_a_tarball_with_links_inside_is_refused_by_the_same_extraction(tmp_path):
    import tarfile

    def add_link(tar):
        info = tarfile.TarInfo('package/evil')
        info.type, info.linkname = tarfile.SYMTYPE, '/etc/passwd'
        tar.addfile(info)
    data = tar_gz(package(), extra=add_link)
    with pytest.raises(SourceError) as error:
        sources.fetch_tarball(URL, sri(data), tmp_path, download=server(data))
    assert error.value.code == 'unsafe_archive'


def test_the_https_download_refuses_addresses_that_are_not_public():
    for answers in (['127.0.0.1'], ['10.0.0.2'], ['93.184.215.14', '192.168.1.1']):
        with pytest.raises(SourceError) as error:
            index.download_https('https://example.org/a.tgz', 1024, resolve=lambda host, a=answers: a)
        assert error.value.code == 'untrusted_host'


def test_an_index_can_list_an_https_tarball_with_its_hash():
    data = b'{"format": 1, "plugins": [{"name": "demo", "versions": [{"version": "1.0.0", "source": {"type": "tarball", "url": "' + URL.encode() + b'", "integrity": "' + sri(b'x').encode() + b'"}}, {"version": "0.9.0", "source": {"type": "tarball", "url": "./demo.tgz", "integrity": "sha512-x"}}]}]}'
    parsed = index.parse(data)
    assert parsed['plugins'][0]['versions'] == [{'version': '1.0.0', 'source': {'type': 'tarball', 'url': URL, 'integrity': sri(b'x')}}]
