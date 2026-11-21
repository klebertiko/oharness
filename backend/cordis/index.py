"""A static plugin index: a JSON list of packages. Nothing here runs package code.

The list is unreviewed. Reading it only parses JSON, and a published index cannot
claim otherwise. Sharing writes the same shape from the registry and from
``package.json`` read as data.
"""
from __future__ import annotations

import ipaddress
import json
import socket
import urllib.request
from collections.abc import Callable
from typing import Any
from urllib.parse import urlsplit

from cordis.sources import SourceError

INDEX_LIMIT = 1024 * 1024
INDEX_VERSION = 1
KINDS = frozenset({'npm', 'github', 'tarball', 'local'})
# Keys that would mean the index carries code rather than a description of a package.
_CODE_KEYS = frozenset({'script', 'scripts', 'eval', 'code', 'main', 'bin', 'install'})
Fetcher = Callable[[str, int], bytes]


def _public_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    return not (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast or ip.is_unspecified)


def validate_index_url(url: str) -> str:
    """HTTPS, no credentials, and not a local or private host written as an address."""
    parts = urlsplit(url)
    host = (parts.hostname or '').rstrip('.').lower()
    if parts.scheme != 'https' or not host or parts.username or parts.password:
        raise SourceError('untrusted_host', 'An index is loaded over HTTPS from a public host.')
    if host in {'localhost', 'localhost.localdomain'} or host.endswith('.localhost') or host.endswith('.local'):
        raise SourceError('untrusted_host', 'An index is loaded over HTTPS from a public host.')
    try:
        literal = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    if literal is not None and not _public_ip(literal):
        raise SourceError('untrusted_host', 'An index is loaded over HTTPS from a public host.')
    return url


def _assert_public_dns(host: str) -> None:
    try:
        infos = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    except OSError as error:
        raise SourceError('download_failed', 'The index could not be downloaded.') from error
    if not infos:
        raise SourceError('download_failed', 'The index could not be downloaded.')
    for info in infos:
        addr = ipaddress.ip_address(info[4][0])
        if not _public_ip(addr):
            raise SourceError('untrusted_host', 'An index is loaded over HTTPS from a public host.')


class _RefuseRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise SourceError('untrusted_host', 'The index host redirected, which is not followed.')


def _http(url: str, limit: int) -> bytes:
    validate_index_url(url)
    _assert_public_dns(urlsplit(url).hostname or '')
    opener = urllib.request.build_opener(_RefuseRedirects)
    request = urllib.request.Request(url, headers={'User-Agent': 'oharness-cordis', 'Accept': 'application/json'})
    try:
        with opener.open(request, timeout=30) as response:
            data = response.read(limit + 1)
    except SourceError:
        raise
    except OSError as error:
        raise SourceError('download_failed', 'The index could not be downloaded.') from error
    if len(data) > limit:
        raise SourceError('archive_too_large', 'The index is larger than the limit.')
    return data


def _source(raw: object) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise SourceError('bad_index', 'Each entry needs a source.')
    kind, spec = raw.get('kind'), raw.get('spec')
    if kind not in KINDS or not isinstance(spec, str) or not spec.strip() or len(spec) > 1024:
        raise SourceError('bad_index', 'A source must be npm, GitHub, an archive or a local folder.')
    out: dict[str, Any] = {'kind': kind, 'spec': spec.strip()}
    for key, cap in (('version', 128), ('commit', 64), ('subdir', 512)):
        value = raw.get(key)
        if value is None or value == '':
            continue
        if not isinstance(value, str) or len(value) > cap:
            raise SourceError('bad_index', 'A source field is not valid.')
        out[key] = value
    return out


def parse_index(data: bytes) -> dict[str, Any]:
    """Parse an index. The result is always ``trust: unreviewed``, whatever the file says."""
    if len(data) > INDEX_LIMIT:
        raise SourceError('archive_too_large', 'The index is larger than the limit.')
    try:
        parsed = json.loads(data)
    except ValueError as error:
        raise SourceError('bad_index', 'The index is not JSON.') from error
    if not isinstance(parsed, dict) or parsed.get('version') != INDEX_VERSION:
        raise SourceError('bad_index', 'The index is not a version 1 list.')
    rows = parsed.get('plugins')
    if not isinstance(rows, list) or len(rows) > 500:
        raise SourceError('bad_index', 'The index list is missing or too long.')
    plugins: list[dict[str, Any]] = []
    for item in rows:
        if not isinstance(item, dict) or _CODE_KEYS.intersection(item):
            raise SourceError('bad_index', 'The index must list packages, not code.')
        name, version = item.get('name'), item.get('version')
        if not isinstance(name, str) or not name.strip() or len(name) > 214:
            raise SourceError('bad_index', 'An entry needs a package name.')
        if not isinstance(version, str) or not version.strip() or len(version) > 64:
            raise SourceError('bad_index', 'An entry needs a version.')
        description = item.get('description') if isinstance(item.get('description'), str) else ''
        plugins.append({
            'name': name.strip(),
            'version': version.strip(),
            'description': description.strip()[:400],
            'source': _source(item.get('source')),
        })
    return {'version': INDEX_VERSION, 'plugins': plugins, 'trust': 'unreviewed'}


def load_index(url: str, *, fetcher: Fetcher | None = None) -> dict[str, Any]:
    """Load a remote index. A test fetcher skips DNS; the real fetch checks the host."""
    validate_index_url(url)
    if fetcher is None:
        data = _http(url, INDEX_LIMIT)
    else:
        data = fetcher(url, INDEX_LIMIT)
        if len(data) > INDEX_LIMIT:
            raise SourceError('archive_too_large', 'The index is larger than the limit.')
    return parse_index(data)


def build_index(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """An index from registry rows. ``description`` is already text; this does not open the package."""
    plugins = []
    for row in rows:
        source = row.get('source') if isinstance(row.get('source'), dict) else {}
        plugins.append({
            'name': row.get('name') or '',
            'version': row.get('version') or '',
            'description': row.get('description') or '',
            'source': {key: source[key] for key in ('kind', 'spec', 'version', 'commit', 'subdir') if source.get(key)},
        })
    return {'version': INDEX_VERSION, 'plugins': plugins, 'trust': 'unreviewed'}
