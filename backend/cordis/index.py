"""Descobrir (ADR 0071): a static plugin index, `format: 1`, fetched by the sidecar and checked before the screen sees it.

The person gives an https address; the sidecar resolves it, refuses it when any address is not public, connects to the checked
address (no redirect), with a timeout and a size ceiling, and keeps only plain text and sources it can install: npm with an
exact version, GitHub at a full commit, or an https tarball with its hash. An index is a third party's list: nothing in it is trusted, rendered as HTML, or
installed without the usual preview and confirmation.
"""
from __future__ import annotations

import contextlib
import http.client
import ipaddress
import json
import re
import socket
import ssl
import threading
import time
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

from cordis.sources import _NPM_NAME, _SEMVER, SourceError, _subdir_parts, _tarball_name_ok, parse_integrity, read_capped

LIMIT_BYTES = 512 * 1024
TIMEOUT_S = 10
# The whole request, by the wall clock: a server that sends one byte just under each socket timeout is still cut here.
INDEX_TOTAL_S = 30
DOWNLOAD_TOTAL_S = 300
MAX_PLUGINS = 500
MAX_VERSIONS = 50
TEXT_LIMITS = {'title': 120, 'description': 500, 'author': 120}
_COMMIT = re.compile(r'^[0-9a-fA-F]{40}$')
_GITHUB_PATH = re.compile(r'^/([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9._-]{1,100}?)(?:\.git)?/?$')
# C0 and C1 controls, and the bidi and line-separator characters that reorder or split what is shown.
_HIDDEN = {c: None for c in (*range(0x00, 0x20), *range(0x7F, 0xA0), 0x061C, 0x200E, 0x200F, *range(0x202A, 0x202F), *range(0x2066, 0x206A), 0x2028, 0x2029)}

Fetcher = Callable[[str, int], bytes]
Resolver = Callable[[str], list[str]]


class PluginIndexError(Exception):
    """An index (or a tarball from an https address) could not be fetched or read. `code` is stable."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _normal_host(url: str) -> tuple[str, Any]:
    parts = urlsplit(url)
    host = (parts.hostname or '').rstrip('.').lower()
    if parts.scheme != 'https' or not host or parts.username is not None or parts.password is not None:
        raise PluginIndexError('invalid_url', 'Give a public https address of the index.')
    if host == 'localhost' or host.endswith('.localhost'):
        raise PluginIndexError('invalid_url', 'Give a public https address of the index.')
    return host, parts


def default_resolve(host: str) -> list[str]:
    try:
        return sorted({info[4][0] for info in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)})
    except (OSError, UnicodeError):
        return []


def check_url(url: str, resolve: Resolver | None = None) -> tuple[str, str]:
    """(host, address): the normalized host and one of its addresses, after every address it resolves to was found public.
    The connection then goes to that address, so a second DNS answer (rebinding) cannot point it elsewhere."""
    host, _parts = _normal_host(url)
    try:
        literal = ipaddress.ip_address(host.strip('[]'))
    except ValueError:
        literal = None
    answers = [str(literal)] if literal is not None else (resolve or default_resolve)(host)
    addresses = []
    for answer in answers:
        try:
            address = ipaddress.ip_address(answer.split('%', 1)[0])
        except ValueError:
            address = None
        if address is None or not address.is_global:
            raise PluginIndexError('invalid_url', 'The index address is local or private; give a public https address.')
        addresses.append(str(address))
    if not addresses:
        raise PluginIndexError('invalid_url', 'The index address does not resolve.')
    return host, addresses[0]


class _PinnedConnection(http.client.HTTPSConnection):
    """HTTPS to a checked address, with the name for TLS (SNI and certificate) and for the Host header."""

    def __init__(self, host: str, address: str, timeout: float):
        super().__init__(host, 443, timeout=timeout, context=ssl.create_default_context())
        self._address = address

    def connect(self) -> None:
        sock = socket.create_connection((self._address, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)


def _timed_out() -> PluginIndexError:
    return PluginIndexError('download_timeout', 'The index took too long to download.')


class _Deadline:
    """Reads a response until a wall-clock deadline. Each read waits at most the time left (the socket timeout is lowered to it),
    and a timer shuts the socket at the deadline, so neither a slow trickle nor a stalled read outlives it."""

    def __init__(self, connection: Any, total: float):
        self.connection, self.end = connection, time.monotonic() + total
        self.expired = threading.Event()
        self.timer = threading.Timer(total, self._expire)
        self.timer.daemon = True
        self.timer.start()

    def _expire(self) -> None:
        self.expired.set()
        sock = getattr(self.connection, 'sock', None)
        if sock is not None:
            with contextlib.suppress(OSError):  # already closed: the read that follows fails, which is the goal
                sock.shutdown(socket.SHUT_RDWR)

    def check(self) -> None:
        left = self.end - time.monotonic()
        if left <= 0 or self.expired.is_set():
            raise _timed_out()
        sock = getattr(self.connection, 'sock', None)
        if sock is not None:
            sock.settimeout(min(left, sock.gettimeout() or left))

    def wrap(self, response: Any) -> Any:
        deadline = self

        class Reader:
            def read(self, n: int) -> bytes:
                deadline.check()
                read = getattr(response, 'read1', None) or response.read
                chunk = read(n)
                deadline.check()
                return chunk
        return Reader()

    def stop(self) -> None:
        self.timer.cancel()


def _pinned_get(url: str, host: str, address: str, limit: int, cancel: threading.Event | None = None, timeout: float = TIMEOUT_S,
                total: float | None = None) -> bytes:
    parts = urlsplit(url)
    path = (parts.path or '/') + (f'?{parts.query}' if parts.query else '')
    connection = _PinnedConnection(host, address, timeout)
    deadline = _Deadline(connection, INDEX_TOTAL_S if total is None else total)
    try:
        connection.request('GET', path, headers={'User-Agent': 'oharness-cordis', 'Accept': 'application/json'})
        deadline.check()
        response = connection.getresponse()
        if 300 <= response.status < 400:
            raise PluginIndexError('redirect_refused', 'The index address redirects; give its final https address.')
        if response.status != 200:
            raise PluginIndexError('download_failed', 'The index could not be downloaded.')
        return read_capped(deadline.wrap(response), limit, cancel)
    except (PluginIndexError, SourceError):
        raise
    except (OSError, http.client.HTTPException) as error:
        if deadline.expired.is_set():
            raise _timed_out() from error
        raise PluginIndexError('download_failed', 'The index could not be downloaded.') from error
    finally:
        deadline.stop()
        connection.close()


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str):
        return ''
    return value.translate(_HIDDEN).strip()[:TEXT_LIMITS[field]]


def _https(value: Any) -> str | None:
    if not isinstance(value, str) or len(value) > 512:
        return None
    parts = urlsplit(value)
    return value if parts.scheme == 'https' and parts.hostname and parts.username is None else None


def _source(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    if raw.get('type') == 'npm':
        return {'type': 'npm'}
    if raw.get('type') == 'tarball':
        url = _https(raw.get('url'))
        try:
            parse_integrity(raw.get('integrity'))
        except SourceError:
            return None
        return {'type': 'tarball', 'url': url, 'integrity': raw['integrity'].strip()} if url and _tarball_name_ok(urlsplit(url).path) else None
    if raw.get('type') != 'git' or not isinstance(raw.get('url'), str) or not isinstance(raw.get('commit'), str):
        return None
    parts = urlsplit(raw['url'])
    match = _GITHUB_PATH.match(parts.path)
    if parts.scheme != 'https' or (parts.hostname or '').lower() != 'github.com' or parts.username is not None or not match or not _COMMIT.match(raw['commit']):
        return None
    path = raw.get('path') or ''
    if not isinstance(path, str):
        return None
    try:
        _subdir_parts(path or None)
    except SourceError:
        return None
    return {'type': 'git', 'url': raw['url'], 'commit': raw['commit'].lower(), 'path': path, 'repo': f'{match[1]}/{match[2]}'}


def _plugin(raw: Any) -> dict[str, Any] | None:
    if not isinstance(raw, dict) or not isinstance(raw.get('name'), str) or len(raw['name']) > 214 or not _NPM_NAME.match(raw['name']):
        return None
    versions = []
    for item in raw.get('versions') if isinstance(raw.get('versions'), list) else []:
        if len(versions) >= MAX_VERSIONS:
            break
        if isinstance(item, dict) and isinstance(item.get('version'), str) and _SEMVER.match(item['version']):
            source = _source(item.get('source'))
            if source is not None:
                versions.append({'version': item['version'], 'source': source})
    if not versions:
        return None
    return {'name': raw['name'], 'title': _text(raw.get('title'), 'title'), 'description': _text(raw.get('description'), 'description'),
            'author': _text(raw.get('author'), 'author'), 'repository': _https(raw.get('repository')), 'versions': versions}


def parse(data: bytes) -> dict[str, Any]:
    try:
        body = json.loads(data.decode('utf8'))
    except (UnicodeDecodeError, ValueError):
        raise PluginIndexError('invalid_index', 'The index is not JSON.') from None
    if not isinstance(body, dict) or body.get('format') != 1 or not isinstance(body.get('plugins'), list):
        raise PluginIndexError('invalid_index', 'The index is not a format 1 plugin index.')
    plugins, skipped = [], 0
    for raw in body['plugins'][:MAX_PLUGINS]:
        plugin = _plugin(raw)
        if plugin is None:
            skipped += 1
        else:
            plugins.append(plugin)
    skipped += max(0, len(body['plugins']) - MAX_PLUGINS)
    return {'title': _text(body.get('title'), 'title'), 'plugins': plugins, 'skipped': skipped}


def fetch(url: str, *, fetcher: Fetcher | None = None, resolve: Resolver | None = None) -> dict[str, Any]:
    """`fetcher` replaces the pinned https request in tests; the address checks run either way, before anything is sent."""
    host, address = check_url(url, resolve)
    data = fetcher(url, LIMIT_BYTES) if fetcher is not None else _pinned_get(url, host, address, LIMIT_BYTES)
    if len(data) > LIMIT_BYTES:
        raise PluginIndexError('index_too_large', 'The index is larger than 512 KiB.')
    return parse(data)


DOWNLOAD_TIMEOUT_S = 30


def download_https(url: str, limit: int, cancel: threading.Event | None = None, *, resolve: Resolver | None = None) -> bytes:
    """A package tarball from a public https address: the same checks as an index (every resolved address public, the connection
    pinned to the checked one, no redirect), a ceiling, a timeout, and the cancel event checked between chunks."""
    try:
        host, address = check_url(url, resolve)
        return _pinned_get(url, host, address, limit, cancel, DOWNLOAD_TIMEOUT_S, DOWNLOAD_TOTAL_S)
    except PluginIndexError as error:
        code = 'untrusted_host' if error.code == 'invalid_url' else 'download_failed'
        raise SourceError(code, error.message.replace('index', 'tarball')) from None
