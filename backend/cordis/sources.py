"""Where a plugin package may come from (ADR 0071): npm, GitHub at a full commit, a tar.gz archive, or a local folder.

Nothing here runs package code, runs install scripts, or installs dependencies. Archives are unpacked by hand: only
regular files and folders, names that stay inside the destination, at most `MAX_FILES` files and `MAX_BYTES` bytes.
A download goes through an injected `Fetcher`, so tests never touch the network.
"""
from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import shutil
import stat
import tarfile
import urllib.request
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

MAX_BYTES = 20 * 1024 * 1024
MAX_FILES = 2000
METADATA_LIMIT = 2 * 1024 * 1024
NPM_HOST = 'registry.npmjs.org'
GITHUB_HOST = 'codeload.github.com'
_ALLOWED_HOSTS = frozenset({NPM_HOST, GITHUB_HOST})
_REPARSE_POINT = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT: symbolic links and junctions on Windows

_NPM_NAME = re.compile(r'^(?:@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$')
_SEMVER = re.compile(r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')
_GH_REPO = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$')
_COMMIT = re.compile(r'^[0-9a-fA-F]{40}$')

Fetcher = Callable[[str, int], bytes]


class SourceError(Exception):
    """A package could not be obtained safely. `code` is stable; `message` never contains a local path."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class _TrustedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _check_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname not in _ALLOWED_HOSTS or parts.username or parts.password:
        raise SourceError('untrusted_host', 'Packages are only downloaded over HTTPS from npm or GitHub.')


def default_fetcher(url: str, limit: int) -> bytes:
    _check_url(url)
    opener = urllib.request.build_opener(_TrustedRedirects)
    request = urllib.request.Request(url, headers={'User-Agent': 'oharness-cordis'})
    try:
        with opener.open(request, timeout=30) as response:
            data = response.read(limit + 1)
    except SourceError:
        raise
    except OSError as error:
        raise SourceError('download_failed', 'The package could not be downloaded.') from error
    return data


def _download(fetcher: Fetcher, url: str, limit: int) -> bytes:
    data = fetcher(url, limit)
    if len(data) > limit:
        raise SourceError('archive_too_large', 'The download is larger than the limit.')
    return data


# -- extraction ------------------------------------------------------------
def _clear(dest: Path) -> None:
    for child in dest.iterdir() if dest.is_dir() else ():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


def _safe_parts(name: str) -> tuple[str, ...]:
    if '\0' in name or '\\' in name or name.startswith('/'):
        raise SourceError('unsafe_archive', 'The archive has a file name that is not allowed.')
    parts = tuple(part for part in PurePosixPath(name).parts if part != '.')
    if any(part == '..' or ':' in part for part in parts):
        raise SourceError('unsafe_archive', 'The archive has a file name that is not allowed.')
    return parts


def _extract(data: bytes, dest: Path) -> Path:
    """Unpack `data` (tar.gz) into `dest` and return the package folder: the single top-level folder when there is one."""
    dest.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(fileobj=io.BytesIO(data), mode='r:gz') as tar:
            members = tar.getmembers()
            if len(members) > MAX_FILES:
                raise SourceError('archive_too_large', 'The archive has too many files.')
            total, seen, tops = 0, set(), set()
            plan: list[tuple[tarfile.TarInfo, tuple[str, ...]]] = []
            for member in members:  # everything is checked before the first byte is written
                if not (member.isdir() or member.type in (tarfile.REGTYPE, tarfile.AREGTYPE)):
                    raise SourceError('unsafe_archive', 'The archive has links or special files.')
                parts = _safe_parts(member.name)
                if not parts:
                    continue
                key = '/'.join(parts).casefold()
                if key in seen:
                    raise SourceError('unsafe_archive', 'The archive repeats a file name.')
                seen.add(key)
                if member.isfile():
                    total += member.size
                    if member.size > MAX_BYTES or total > MAX_BYTES:
                        raise SourceError('archive_too_large', 'The archive is larger than the limit.')
                tops.add(parts[0])
                plan.append((member, parts))
            root = dest.resolve()
            for member, parts in plan:
                target = root.joinpath(*parts)
                if not target.resolve().is_relative_to(root):
                    raise SourceError('unsafe_archive', 'The archive has a file name that is not allowed.')
                if member.isdir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                if source is None:
                    raise SourceError('unsafe_archive', 'The archive has a file that could not be read.')
                written = 0
                with open(target, 'xb') as out:
                    while chunk := source.read(1024 * 1024):
                        written += len(chunk)
                        if written > member.size:
                            raise SourceError('unsafe_archive', 'The archive lies about a file size.')
                        out.write(chunk)
    except SourceError:
        _clear(dest)
        raise
    except (tarfile.TarError, EOFError, OSError, ValueError) as error:
        _clear(dest)
        raise SourceError('bad_archive', 'The archive could not be read.') from error
    only = next(iter(tops)) if len(tops) == 1 else None
    return dest / only if only is not None and (dest / only).is_dir() else dest


def _require_package(root: Path, dest: Path) -> Path:
    if not (root / 'package.json').is_file():
        _clear(dest)
        raise SourceError('not_a_package', 'The folder has no package.json.')
    return root


def _read_manifest(root: Path) -> dict:
    try:
        parsed = json.loads((root / 'package.json').read_text(encoding='utf8'))
    except (OSError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


# -- npm ---------------------------------------------------------------------
def _sha512_matches(data: bytes, declared: object) -> bool:
    if not isinstance(declared, str):
        return False
    digest = base64.b64encode(hashlib.sha512(data).digest()).decode()
    return any(token == f'sha512-{digest}' for token in declared.split())


def fetch_npm(name: str, version: str, dest: Path, *, fetcher: Fetcher = default_fetcher) -> Path:
    if len(name) > 214 or not _NPM_NAME.match(name):
        raise SourceError('invalid_spec', 'That is not a valid npm package name.')
    if not _SEMVER.match(version):
        raise SourceError('invalid_spec', 'Give an exact version, such as 1.2.3.')
    try:
        meta = json.loads(_download(fetcher, f'https://{NPM_HOST}/{name.replace("/", "%2F")}/{version}', METADATA_LIMIT) or b'null')
    except ValueError as error:
        raise SourceError('download_failed', 'The registry answer could not be read.') from error
    dist = meta.get('dist') if isinstance(meta, dict) else None
    if not isinstance(dist, dict) or not isinstance(dist.get('tarball'), str):
        raise SourceError('download_failed', 'The registry did not describe that version.')
    declared = dist.get('integrity')
    if not isinstance(declared, str) or not any(token.startswith('sha512-') for token in declared.split()):
        raise SourceError('integrity_missing', 'The registry gave no sha512 integrity for that version.')
    _check_url(dist['tarball'])
    tarball = _download(fetcher, dist['tarball'], MAX_BYTES)
    if not _sha512_matches(tarball, declared):
        raise SourceError('integrity_mismatch', 'The downloaded package does not match the registry integrity.')
    root = _extract(tarball, dest)
    manifest = _read_manifest(root)
    if manifest.get('name') != name or manifest.get('version') != version:
        _clear(dest)
        raise SourceError('manifest_mismatch', 'The package.json does not match the name and version asked for.')
    return _require_package(root, dest)


# -- GitHub ------------------------------------------------------------------
def _subdir_parts(subdir: str | None) -> tuple[str, ...]:
    if not subdir:
        return ()
    if '\\' in subdir or subdir.startswith('/') or '\0' in subdir:
        raise SourceError('invalid_spec', 'The subfolder must be a relative path inside the repository.')
    parts = PurePosixPath(subdir).parts
    if any(part in ('..', '.') or ':' in part for part in parts):
        raise SourceError('invalid_spec', 'The subfolder must be a relative path inside the repository.')
    return parts


def fetch_github(spec: str, commit: str, subdir: str | None, dest: Path, *, fetcher: Fetcher = default_fetcher) -> Path:
    if not _GH_REPO.match(spec) or set(spec.split('/', 1)[1]) <= {'.'}:
        raise SourceError('invalid_spec', 'Use owner/repository.')
    if not _COMMIT.match(commit):
        raise SourceError('invalid_spec', 'GitHub packages need the full 40-character commit, not a branch or tag.')
    parts = _subdir_parts(subdir)
    data = _download(fetcher, f'https://{GITHUB_HOST}/{spec}/tar.gz/{commit.lower()}', MAX_BYTES)
    root = _extract(data, dest)
    package = root.joinpath(*parts)
    if not package.resolve().is_relative_to(dest.resolve()) or not package.is_dir():
        _clear(dest)
        raise SourceError('not_a_package', 'The subfolder was not found in that commit.')
    return _require_package(package, dest)


# -- local -------------------------------------------------------------------
def _is_link(path: Path) -> bool:
    if path.is_symlink() or path.is_junction():
        return True
    try:
        return bool(getattr(os.lstat(path), 'st_file_attributes', 0) & _REPARSE_POINT)
    except OSError:
        return True


def fetch_local(spec: str, dest: Path) -> Path:
    source = Path(spec)
    if not source.is_absolute() or not source.is_dir():
        raise SourceError('invalid_spec', 'Give the absolute path of a folder.')
    if _is_link(source):
        raise SourceError('unsafe_archive', 'The folder is a link.')
    dest.mkdir(parents=True, exist_ok=True)
    try:
        files, total = 0, 0
        copies: list[tuple[Path, Path]] = []
        for here, dirnames, filenames in os.walk(source, followlinks=False):
            here_path = Path(here)
            dirnames[:] = [name for name in dirnames if name not in ('node_modules', '.git')]
            for name in [*dirnames, *filenames]:
                entry = here_path / name
                if _is_link(entry):
                    raise SourceError('unsafe_archive', 'The folder contains links; copy the real files instead.')
            for name in filenames:
                entry = here_path / name
                info = os.lstat(entry)
                if not stat.S_ISREG(info.st_mode):
                    raise SourceError('unsafe_archive', 'The folder contains special files.')
                files, total = files + 1, total + info.st_size
                if files > MAX_FILES or info.st_size > MAX_BYTES or total > MAX_BYTES:
                    raise SourceError('archive_too_large', 'The folder is larger than the limit.')
                copies.append((entry, dest / entry.relative_to(source)))
        for origin, target in copies:
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(origin, target)
    except SourceError:
        _clear(dest)
        raise
    except OSError as error:
        _clear(dest)
        raise SourceError('bad_archive', 'The folder could not be copied.') from error
    return _require_package(dest, dest)


# -- tarball -----------------------------------------------------------------
def fetch_tarball(spec: str, dest: Path, *, fetcher: Fetcher = default_fetcher) -> Path:
    """A gzip tar the person already has, or an HTTPS archive on the npm or GitHub hosts. No script runs."""
    if spec.startswith('https://'):
        path = urlsplit(spec).path
        if not (path.endswith('.tgz') or path.endswith('.tar.gz')):
            raise SourceError('invalid_spec', 'The address must be a gzip tar archive.')
        _check_url(spec)
        data = _download(fetcher, spec, MAX_BYTES)
    else:
        source = Path(spec)
        suffix = source.name.lower()
        if not source.is_absolute() or not source.is_file() or _is_link(source) or not (suffix.endswith('.tgz') or suffix.endswith('.tar.gz')):
            raise SourceError('invalid_spec', 'Give the absolute path of a tar.gz file, or an HTTPS address.')
        try:
            if source.stat().st_size > MAX_BYTES:
                raise SourceError('archive_too_large', 'The archive is larger than the limit.')
            data = source.read_bytes()
        except SourceError:
            raise
        except OSError as error:
            raise SourceError('bad_archive', 'The archive could not be read.') from error
    return _require_package(_extract(data, dest), dest)
