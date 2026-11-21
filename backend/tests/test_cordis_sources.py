"""Where a plugin package may come from (ADR 0071): npm with an integrity check, GitHub at a full commit, a local folder.

No network: every test hands the code a fake fetcher.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import sys
import tarfile
from pathlib import Path

import pytest

from cordis import sources
from cordis.sources import SourceError

COMMIT = 'a' * 40


def tar_gz(members: dict[str, bytes | None], *, extra=None) -> bytes:
    """`name -> bytes` is a file, `name -> None` a directory. `extra(tar)` can add odd members."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
        for name, data in members.items():
            info = tarfile.TarInfo(name)
            if data is None:
                info.type = tarfile.DIRTYPE
                tar.addfile(info)
            else:
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))
        if extra is not None:
            extra(tar)
    return buffer.getvalue()


def package(name='demo', version='1.0.0', prefix='package') -> dict[str, bytes | None]:
    manifest = json.dumps({'name': name, 'version': version, 'main': './index.ts'}).encode()
    return {f'{prefix}/package.json': manifest, f'{prefix}/index.ts': b'export const name = "demo"\n'}


def integrity(data: bytes) -> str:
    return 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()


class FakeNet:
    def __init__(self, routes: dict[str, bytes]):
        self.routes, self.calls = routes, []

    def __call__(self, url: str, limit: int) -> bytes:
        self.calls.append(url)
        if url not in self.routes:
            raise SourceError('download_failed', 'not found')
        return self.routes[url]


def npm_net(tarball: bytes, *, declared: str | None = None, name='demo', version='1.0.0', tarball_url=None) -> FakeNet:
    url = tarball_url or f'https://registry.npmjs.org/{name}/-/{name}-{version}.tgz'
    dist = {'tarball': url, 'integrity': declared if declared is not None else integrity(tarball)}
    return FakeNet({f'https://registry.npmjs.org/{name}/{version}': json.dumps({'dist': dist}).encode(), url: tarball})


def test_npm_package_is_fetched_verified_and_extracted(tmp_path):
    data = tar_gz(package())
    net = npm_net(data)
    root = sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=net)
    assert (root / 'package.json').is_file() and (root / 'index.ts').is_file()
    assert root.resolve().is_relative_to(tmp_path.resolve())


def test_npm_scoped_name_is_one_url_segment(tmp_path):
    data = tar_gz(package('@acme/demo'))
    net = FakeNet({
        'https://registry.npmjs.org/@acme%2Fdemo/1.0.0': json.dumps({'dist': {'tarball': 'https://registry.npmjs.org/@acme/demo/-/demo-1.0.0.tgz', 'integrity': integrity(data)}}).encode(),
        'https://registry.npmjs.org/@acme/demo/-/demo-1.0.0.tgz': data,
    })
    assert sources.fetch_npm('@acme/demo', '1.0.0', tmp_path, fetcher=net).is_dir()


def test_npm_wrong_integrity_is_refused(tmp_path):
    data = tar_gz(package())
    net = npm_net(data, declared=integrity(b'something else'))
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=net)
    assert error.value.code == 'integrity_mismatch'
    assert list(tmp_path.iterdir()) == []


def test_npm_without_sha512_integrity_is_refused(tmp_path):
    data = tar_gz(package())
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=npm_net(data, declared='sha1-AAAA'))
    assert error.value.code == 'integrity_missing'


@pytest.mark.parametrize('version', ['latest', '^1.0.0', '1.x', '1.0', '../1.0.0', ''])
def test_npm_needs_an_exact_version(tmp_path, version):
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', version, tmp_path, fetcher=FakeNet({}))
    assert error.value.code == 'invalid_spec'


@pytest.mark.parametrize('name', ['../evil', 'Demo', 'a b', '@x', 'a/b', ''])
def test_npm_name_is_validated(tmp_path, name):
    with pytest.raises(SourceError) as error:
        sources.fetch_npm(name, '1.0.0', tmp_path, fetcher=FakeNet({}))
    assert error.value.code == 'invalid_spec'


def test_npm_tarball_must_come_from_the_registry(tmp_path):
    data = tar_gz(package())
    net = npm_net(data, tarball_url='https://evil.example/demo.tgz')
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=net)
    assert error.value.code == 'untrusted_host'


def test_npm_package_json_must_match_what_was_asked(tmp_path):
    data = tar_gz(package('other', '1.0.0'))
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=npm_net(data))
    assert error.value.code == 'manifest_mismatch'


@pytest.mark.parametrize('commit', ['main', 'v1.0.0', 'abc123', 'a' * 39, 'a' * 41, 'g' * 40, ''])
def test_github_needs_a_full_commit(tmp_path, commit):
    net = FakeNet({})
    with pytest.raises(SourceError) as error:
        sources.fetch_github('acme/demo', commit, None, tmp_path, fetcher=net)
    assert error.value.code == 'invalid_spec'
    assert net.calls == []


@pytest.mark.parametrize('spec', ['acme', 'acme/demo/extra', '../demo', 'acme/..', 'a cme/demo', 'https://github.com/acme/demo'])
def test_github_repo_is_owner_slash_name(tmp_path, spec):
    with pytest.raises(SourceError) as error:
        sources.fetch_github(spec, COMMIT, None, tmp_path, fetcher=FakeNet({}))
    assert error.value.code == 'invalid_spec'


def test_github_commit_is_fetched_with_a_subfolder(tmp_path):
    members = {f'demo-{COMMIT}/': None, **{f'demo-{COMMIT}/plugins/one/{k.split("/")[1]}': v for k, v in package().items()}, f'demo-{COMMIT}/README.md': b'x'}
    net = FakeNet({f'https://codeload.github.com/acme/demo/tar.gz/{COMMIT}': tar_gz(members)})
    root = sources.fetch_github('acme/demo', COMMIT, 'plugins/one', tmp_path, fetcher=net)
    assert (root / 'package.json').is_file()
    assert net.calls == [f'https://codeload.github.com/acme/demo/tar.gz/{COMMIT}']


@pytest.mark.parametrize('subdir', ['..', '../x', '/abs', 'a/../../b', 'a\\b', 'C:/x'])
def test_github_subfolder_cannot_leave_the_repo(tmp_path, subdir):
    with pytest.raises(SourceError) as error:
        sources.fetch_github('acme/demo', COMMIT, subdir, tmp_path, fetcher=FakeNet({}))
    assert error.value.code == 'invalid_spec'


def _extra_symlink(tar: tarfile.TarFile) -> None:
    info = tarfile.TarInfo('package/link')
    info.type = tarfile.SYMTYPE
    info.linkname = '../../outside'
    tar.addfile(info)


def _extra_hardlink(tar: tarfile.TarFile) -> None:
    info = tarfile.TarInfo('package/hard')
    info.type = tarfile.LNKTYPE
    info.linkname = 'package/index.ts'
    tar.addfile(info)


@pytest.mark.parametrize('extra', [_extra_symlink, _extra_hardlink])
def test_archive_with_a_link_is_refused_whole(tmp_path, extra):
    data = tar_gz(package(), extra=extra)
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=npm_net(data))
    assert error.value.code == 'unsafe_archive'
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize('name', ['package/../escape.txt', '/etc/escape', 'package/a/../../../escape', 'package\\..\\escape', 'package/C:evil'])
def test_archive_member_cannot_leave_the_folder(tmp_path, name):
    data = tar_gz({**package(), name: b'x'})
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=npm_net(data))
    assert error.value.code == 'unsafe_archive'
    assert not (tmp_path.parent / 'escape.txt').exists()


def test_archive_with_a_large_file_is_refused(tmp_path):
    data = tar_gz({**package(), 'package/big.bin': b'\0' * (sources.MAX_BYTES + 1)})
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=npm_net(data))
    assert error.value.code == 'archive_too_large'
    assert list(tmp_path.iterdir()) == []


def test_archive_with_too_many_files_is_refused(tmp_path):
    many = {f'package/f{i}.txt': b'' for i in range(sources.MAX_FILES + 1)}
    data = tar_gz({**package(), **many})
    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=npm_net(data))
    assert error.value.code == 'archive_too_large'


def test_download_over_the_limit_is_refused(tmp_path):
    data = tar_gz(package())

    def huge(url: str, limit: int) -> bytes:
        return b'x' * (limit + 1)

    with pytest.raises(SourceError) as error:
        sources.fetch_npm('demo', '1.0.0', tmp_path, fetcher=huge)
    assert error.value.code == 'archive_too_large'
    del data


def test_nothing_is_executed_or_installed(tmp_path):
    marker = tmp_path / 'ran'
    scripts = json.dumps({'name': 'demo', 'version': '1.0.0', 'scripts': {'postinstall': f'node -e "require(\'fs\').writeFileSync(\'{marker.name}\',\'x\')"'}}).encode()
    data = tar_gz({'package/package.json': scripts, 'package/index.ts': b''})
    root = sources.fetch_npm('demo', '1.0.0', tmp_path / 'out', fetcher=npm_net(data))
    assert not marker.exists() and not (root / 'node_modules').exists()


def test_local_folder_is_copied(tmp_path):
    src = tmp_path / 'src'
    (src / 'lib').mkdir(parents=True)
    (src / 'package.json').write_text('{"name":"demo","version":"1.0.0"}')
    (src / 'lib' / 'a.ts').write_text('x')
    (src / 'node_modules' / 'dep').mkdir(parents=True)
    (src / 'node_modules' / 'dep' / 'i.js').write_text('x')
    root = sources.fetch_local(str(src), tmp_path / 'dest')
    assert (root / 'lib' / 'a.ts').read_text() == 'x'
    assert not (root / 'node_modules').exists()


def test_local_needs_an_absolute_folder(tmp_path):
    with pytest.raises(SourceError) as error:
        sources.fetch_local('relative/path', tmp_path / 'dest')
    assert error.value.code == 'invalid_spec'
    with pytest.raises(SourceError) as error:
        sources.fetch_local(str(tmp_path / 'missing'), tmp_path / 'dest')
    assert error.value.code == 'invalid_spec'


def _try_symlink(link: Path, target: Path, *, directory: bool) -> bool:
    try:
        os.symlink(target, link, target_is_directory=directory)
        return True
    except (OSError, NotImplementedError):
        return False


def test_local_folder_with_a_symlink_is_refused(tmp_path):
    src = tmp_path / 'src'
    src.mkdir()
    (src / 'package.json').write_text('{"name":"demo","version":"1.0.0"}')
    (tmp_path / 'secret.txt').write_text('s')
    if not _try_symlink(src / 'link.txt', tmp_path / 'secret.txt', directory=False):
        pytest.skip('this account cannot create symbolic links')
    with pytest.raises(SourceError) as error:
        sources.fetch_local(str(src), tmp_path / 'dest')
    assert error.value.code == 'unsafe_archive'
    assert not (tmp_path / 'dest').exists() or list((tmp_path / 'dest').iterdir()) == []


@pytest.mark.skipif(sys.platform != 'win32', reason='junctions are a Windows thing')
def test_local_folder_with_a_junction_is_refused(tmp_path):
    import subprocess
    src, outside = tmp_path / 'src', tmp_path / 'outside'
    src.mkdir()
    outside.mkdir()
    (src / 'package.json').write_text('{"name":"demo","version":"1.0.0"}')
    made = subprocess.run(['cmd', '/c', 'mklink', '/J', str(src / 'j'), str(outside)], capture_output=True, check=False)
    if made.returncode != 0:
        pytest.skip('could not create a junction')
    with pytest.raises(SourceError) as error:
        sources.fetch_local(str(src), tmp_path / 'dest')
    assert error.value.code == 'unsafe_archive'


def test_local_folder_that_is_itself_a_link_is_refused(tmp_path):
    real = tmp_path / 'real'
    real.mkdir()
    (real / 'package.json').write_text('{"name":"demo","version":"1.0.0"}')
    if not _try_symlink(tmp_path / 'ln', real, directory=True):
        pytest.skip('this account cannot create symbolic links')
    with pytest.raises(SourceError) as error:
        sources.fetch_local(str(tmp_path / 'ln'), tmp_path / 'dest')
    assert error.value.code == 'unsafe_archive'


def test_local_folder_too_large_is_refused(tmp_path):
    src = tmp_path / 'src'
    src.mkdir()
    (src / 'package.json').write_text('{"name":"demo","version":"1.0.0"}')
    with open(src / 'big.bin', 'wb') as handle:
        handle.truncate(sources.MAX_BYTES + 1)
    with pytest.raises(SourceError) as error:
        sources.fetch_local(str(src), tmp_path / 'dest')
    assert error.value.code == 'archive_too_large'
