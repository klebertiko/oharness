"""Where a plugin package may come from (ADR 0071): npm, GitHub at a full commit, a tarball with its hash, or a local folder.

Nothing here runs package code, runs install scripts, or installs dependencies. Archives are unpacked by hand: only
regular files and folders, names that stay inside the destination, at most `MAX_FILES` files and `MAX_BYTES` bytes.
A download goes through an injected `Fetcher`, so tests never touch the network. A fetcher marked `cancellable` gets the
cancel event and checks it between chunks; every download is checked before and after either way. `progress(step)` reports
each step to the live log of the screen.
"""
from __future__ import annotations

import base64
import email.message
import gzip
import hashlib
import io
import json
import os
import re
import shutil
import stat
import tarfile
import threading
import urllib.request
import zlib
from collections.abc import Callable
from pathlib import Path, PurePosixPath, PureWindowsPath
from typing import IO, Protocol, cast
from urllib.parse import urlsplit

MAX_BYTES = 20 * 1024 * 1024
MAX_FILES = 2000
# The tar stream after gunzip: the files plus room for their headers. tarfile only ever sees bytes already under this ceiling,
# so a small gzip that expands without end, or a PAX header of many megabytes, is refused before it is parsed.
MAX_UNPACKED_BYTES = MAX_BYTES + 4 * 1024 * 1024
CHUNK = 64 * 1024
METADATA_LIMIT = 2 * 1024 * 1024
NPM_HOST = 'registry.npmjs.org'
GITHUB_HOST = 'codeload.github.com'
_ALLOWED_HOSTS = frozenset({NPM_HOST, GITHUB_HOST})
_REPARSE_POINT = 0x400  # FILE_ATTRIBUTE_REPARSE_POINT: symbolic links and junctions on Windows

_NPM_NAME = re.compile(r'^(?:@[a-z0-9][a-z0-9._~-]*/)?[a-z0-9][a-z0-9._~-]*$')
_SEMVER = re.compile(r'^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$')
_GH_REPO = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$')
_COMMIT = re.compile(r'^[0-9a-fA-F]{40}$')
_HEX = re.compile(r'^[0-9a-fA-F]+$')
_SRI = re.compile(r'^(sha512|sha256)-([A-Za-z0-9+/]+={0,2})$')
_DIGEST_SIZE = {'sha512': 64, 'sha256': 32}
# Names Windows keeps for devices, with or without an extension (`nul.txt` is the device too).
_RESERVED = frozenset({'con', 'prn', 'aux', 'nul', *(f'com{n}' for n in range(1, 10)), *(f'lpt{n}' for n in range(1, 10))})

Fetcher = Callable[[str, int], bytes]
CancellableFetch = Callable[[str, int, 'threading.Event | None'], bytes]
Progress = Callable[[str], None]
# Downloads the https address of a tarball: (url, limit, cancel) -> bytes. The sidecar checks every address the name resolves to.
TarballDownload = Callable[[str, int, 'threading.Event | None'], bytes]


class SourceError(Exception):
    """A package could not be obtained safely. `code` is stable; `message` never contains a local path."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


class _Readable(Protocol):
    def read(self, n: int, /) -> bytes:
        """Up to `n` bytes; empty at the end."""


class Cancellable(Protocol):
    """A fetcher that takes the cancel event and checks it between chunks."""
    cancellable: bool

    def __call__(self, url: str, limit: int, cancel: threading.Event | None = None) -> bytes:
        """The body of `url`, at most `limit` bytes; stops when `cancel` is set."""


class _TrustedRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req: urllib.request.Request, fp: IO[bytes], code: int, msg: str, headers: email.message.Message,
                         newurl: str) -> urllib.request.Request | None:
        _check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _check_url(url: str) -> None:
    parts = urlsplit(url)
    if parts.scheme != 'https' or parts.hostname not in _ALLOWED_HOSTS or parts.username or parts.password:
        raise SourceError('untrusted_host', 'Packages are only downloaded over HTTPS from npm or GitHub.')


def _cancelled() -> SourceError:
    return SourceError('cancelled', 'The download was cancelled.')


def read_capped(stream: _Readable, limit: int, cancel: threading.Event | None = None) -> bytes:
    """Read at most `limit + 1` bytes (one past the ceiling, so the caller can refuse it), checking `cancel` between chunks."""
    parts, total = [], 0
    while total <= limit:
        if cancel is not None and cancel.is_set():
            raise _cancelled()
        chunk = stream.read(min(CHUNK, limit + 1 - total))
        if not chunk:
            break
        parts.append(chunk)
        total += len(chunk)
    if cancel is not None and cancel.is_set():
        raise _cancelled()
    return b''.join(parts)


class _HttpsFetcher:
    """The real download: https from npm or GitHub only, redirects checked, a timeout and the cancel event between chunks."""
    cancellable = True

    def __call__(self, url: str, limit: int, cancel: threading.Event | None = None) -> bytes:
        _check_url(url)
        opener = urllib.request.build_opener(_TrustedRedirects)
        request = urllib.request.Request(url, headers={'User-Agent': 'oharness-cordis'})
        try:
            with opener.open(request, timeout=30) as response:
                data = read_capped(response, limit, cancel)
        except SourceError:
            raise
        except OSError as error:
            raise SourceError('download_failed', 'The package could not be downloaded.') from error
        return data


default_fetcher: Cancellable = _HttpsFetcher()


def _download(fetcher: Fetcher | Cancellable, url: str, limit: int, cancel: threading.Event | None = None) -> bytes:
    if cancel is not None and cancel.is_set():
        raise _cancelled()
    if getattr(fetcher, 'cancellable', False):
        data = cast(CancellableFetch, fetcher)(url, limit, cancel)
    else:
        data = cast(Fetcher, fetcher)(url, limit)
    if cancel is not None and cancel.is_set():
        raise _cancelled()
    if len(data) > limit:
        raise SourceError('archive_too_large', 'The download is larger than the limit.')
    return data


def _step(progress: Progress | None, step: str) -> None:
    if progress is not None:
        progress(step)


# -- extraction ------------------------------------------------------------
def _clear(dest: Path) -> None:
    for child in dest.iterdir() if dest.is_dir() else ():
        if child.is_dir() and not child.is_symlink():
            shutil.rmtree(child, ignore_errors=True)
        else:
            child.unlink(missing_ok=True)


def _windows_unsafe(part: str) -> bool:
    """A device name (`con`, `nul.txt`, `COM1.log`) or a name Windows would silently change (a trailing dot or space)."""
    return part.endswith(('.', ' ')) or part.split('.', 1)[0].rstrip(' ').casefold() in _RESERVED


def _safe_parts(name: str) -> tuple[str, ...]:
    if '\0' in name or '\\' in name or name.startswith('/'):
        raise SourceError('unsafe_archive', 'The archive has a file name that is not allowed.')
    parts = tuple(part for part in PurePosixPath(name).parts if part != '.')
    if any(part == '..' or ':' in part or _windows_unsafe(part) for part in parts):
        raise SourceError('unsafe_archive', 'The archive has a file name that is not allowed.')
    return parts


def _gunzip(data: bytes) -> bytes:
    """The tar stream of a .tgz, read in chunks and refused as soon as it passes `MAX_UNPACKED_BYTES`."""
    with gzip.GzipFile(fileobj=io.BytesIO(data), mode='rb') as stream:
        raw = read_capped(stream, MAX_UNPACKED_BYTES)
    if len(raw) > MAX_UNPACKED_BYTES:
        raise SourceError('archive_too_large', 'The archive unpacks to more than the limit.')
    return raw


def _extract(data: bytes, dest: Path) -> Path:
    """Unpack `data` (tar.gz) into `dest` and return the package folder: the single top-level folder when there is one."""
    dest.mkdir(parents=True, exist_ok=True)
    try:
        with tarfile.open(fileobj=io.BytesIO(_gunzip(data)), mode='r:') as tar:
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
    except (tarfile.TarError, EOFError, OSError, ValueError, zlib.error) as error:
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


def fetch_npm(name: str, version: str, dest: Path, *, fetcher: Fetcher | Cancellable = default_fetcher, cancel: threading.Event | None = None,
              progress: Progress | None = None) -> Path:
    if len(name) > 214 or not _NPM_NAME.match(name):
        raise SourceError('invalid_spec', 'That is not a valid npm package name.')
    if not _SEMVER.match(version):
        raise SourceError('invalid_spec', 'Give an exact version, such as 1.2.3.')
    _step(progress, 'downloading')
    try:
        meta = json.loads(_download(fetcher, f'https://{NPM_HOST}/{name.replace("/", "%2F")}/{version}', METADATA_LIMIT, cancel) or b'null')
    except ValueError as error:
        raise SourceError('download_failed', 'The registry answer could not be read.') from error
    dist = meta.get('dist') if isinstance(meta, dict) else None
    if not isinstance(dist, dict) or not isinstance(dist.get('tarball'), str):
        raise SourceError('download_failed', 'The registry did not describe that version.')
    declared = dist.get('integrity')
    if not isinstance(declared, str) or not any(token.startswith('sha512-') for token in declared.split()):
        raise SourceError('integrity_missing', 'The registry gave no sha512 integrity for that version.')
    _check_url(dist['tarball'])
    tarball = _download(fetcher, dist['tarball'], MAX_BYTES, cancel)
    _step(progress, 'verifying')
    if not _sha512_matches(tarball, declared):
        raise SourceError('integrity_mismatch', 'The downloaded package does not match the registry integrity.')
    _step(progress, 'extracting')
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


def fetch_github(spec: str, commit: str, subdir: str | None, dest: Path, *, fetcher: Fetcher | Cancellable = default_fetcher,
                 cancel: threading.Event | None = None, progress: Progress | None = None) -> Path:
    if not _GH_REPO.match(spec) or set(spec.split('/', 1)[1]) <= {'.'}:
        raise SourceError('invalid_spec', 'Use owner/repository.')
    if not _COMMIT.match(commit):
        raise SourceError('invalid_spec', 'GitHub packages need the full 40-character commit, not a branch or tag.')
    parts = _subdir_parts(subdir)
    _step(progress, 'downloading')
    data = _download(fetcher, f'https://{GITHUB_HOST}/{spec}/tar.gz/{commit.lower()}', MAX_BYTES, cancel)
    _step(progress, 'extracting')
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


def _refuse_network_path(spec: str, what: str) -> None:
    # Windows reads any two leading slashes, mixed or not (`/\host`, `\\?\UNC\host`), as a network drive; check the parsed drive, not the text.
    if spec.startswith(('\\\\', '//')) or PureWindowsPath(spec).drive.startswith(('\\\\', '//')):
        raise SourceError('invalid_spec', f'A network path is not accepted; copy the {what} to this computer first.')


def fetch_local(spec: str, dest: Path, *, progress: Progress | None = None) -> Path:
    _refuse_network_path(spec, 'folder')
    _step(progress, 'copying')
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
                if _windows_unsafe(name):
                    raise SourceError('unsafe_archive', 'The folder has a file name that is not allowed on Windows.')
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
def parse_integrity(text: object) -> tuple[str, bytes]:
    """(algorithm, digest) from `sha512-<base64>`, `sha256-<base64>`, or the hex of a sha256 (64) or sha512 (128)."""
    if not isinstance(text, str) or not text.strip():
        raise SourceError('integrity_missing', 'Give the sha512 or sha256 of the tarball.')
    value = text.strip()
    match = _SRI.match(value)
    try:
        if match:
            algo, digest = match[1], base64.b64decode(match[2], validate=True)
        elif _HEX.match(value) and len(value) in (64, 128):
            algo, digest = ('sha256' if len(value) == 64 else 'sha512'), bytes.fromhex(value)
        else:
            raise ValueError('not a hash')
    except ValueError:
        raise SourceError('invalid_spec', 'The hash must be sha512-... or sha256-... (base64), or the hex of a sha256 or sha512.') from None
    if len(digest) != _DIGEST_SIZE[algo]:
        raise SourceError('invalid_spec', 'The hash has the wrong length for its algorithm.')
    return algo, digest


def _tarball_name_ok(name: str) -> bool:
    return name.lower().endswith(('.tgz', '.tar.gz'))


def _read_local_tarball(spec: str, cancel: threading.Event | None) -> bytes:
    _refuse_network_path(spec, 'file')
    source = Path(spec)
    if not source.is_absolute() or not _tarball_name_ok(source.name):
        raise SourceError('invalid_spec', 'Give the absolute path of a .tgz file.')
    if (source.is_symlink() or source.exists()) and _is_link(source):
        raise SourceError('unsafe_archive', 'The file is a link.')
    if not source.is_file():
        raise SourceError('invalid_spec', 'Give the absolute path of a .tgz file.')
    try:
        if source.stat().st_size > MAX_BYTES:
            raise SourceError('archive_too_large', 'The file is larger than the limit.')
        with open(source, 'rb') as handle:
            return read_capped(handle, MAX_BYTES, cancel)
    except OSError as error:
        raise SourceError('bad_archive', 'The file could not be read.') from error


def fetch_tarball(spec: str, integrity: str | None, dest: Path, *, download: TarballDownload | None = None, cancel: threading.Event | None = None,
                  progress: Progress | None = None) -> Path:
    """An https `.tgz` (its sha512 or sha256 is required and checked) or a local `.tgz` by absolute path (a hash, when given, is checked).
    Both are unpacked by the same `_extract` as npm and GitHub."""
    if ':' in spec.split('/', 1)[0] and spec.split(':', 1)[0].lower() in ('https', 'http', 'ftp', 'file'):
        parts = urlsplit(spec)
        if parts.scheme != 'https' or not parts.hostname or parts.username is not None or parts.password is not None or not _tarball_name_ok(parts.path):
            raise SourceError('invalid_spec', 'Give the https address of a .tgz file.')
        expected: tuple[str, bytes] | None = parse_integrity(integrity)
        if download is None:
            raise SourceError('download_failed', 'Downloading a tarball is not available here.')
        _step(progress, 'downloading')
        if cancel is not None and cancel.is_set():
            raise _cancelled()
        data = download(spec, MAX_BYTES, cancel)
        if cancel is not None and cancel.is_set():
            raise _cancelled()
    else:
        expected = parse_integrity(integrity) if integrity else None
        _step(progress, 'copying')
        data = _read_local_tarball(spec, cancel)
    if len(data) > MAX_BYTES:
        raise SourceError('archive_too_large', 'The tarball is larger than the limit.')
    if expected is not None:
        _step(progress, 'verifying')
        algo, digest = expected
        if hashlib.new(algo, data).digest() != digest:
            raise SourceError('integrity_mismatch', 'The tarball does not match the hash you gave.')
    _step(progress, 'extracting')
    root = _extract(data, dest)
    return _require_package(root, dest)
