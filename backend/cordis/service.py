"""The plugin manager the `/cordis` routes call: fetch, preview, confirm, install, switch, remove, share (ADR 0071).

It owns the supervisor, the registry and the downloaded packages. A package is fetched into a folder inside the plugin
folder the host is allowed to read, shown to the person with the host's own warning, and loaded only after they confirm
the digest of that warning and those files.
"""
from __future__ import annotations

import base64
import gzip
import hashlib
import io
import json
import logging
import os
import re
import secrets
import shutil
import tarfile
import threading
import time
from collections.abc import Mapping
from pathlib import Path
from typing import Any

from cordis import index, sources
from cordis.devarea import DevArea, DevError
from cordis.registry import Registry
from cordis.sources import Fetcher, SourceError
from cordis.supervisor import RUNNING, UNAVAILABLE, CordisSupervisor, CordisUnavailable, HostRequestError

_log = logging.getLogger(__name__)

FETCH_ID = re.compile(r'^[0-9a-f]{16}$')
STALE_STAGE_S = 24 * 3600
MAX_JOBS = 20
MAX_CREATOR_THREADS = 200
CANCEL_WAIT_S = 15
THREAD_ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')  # sandbox.schemas.THREAD_ID_PATTERN
# What the host already provides to a plugin. Anything else a package depends on is not installed, so the preview says so.
HOST_PROVIDED = frozenset({'cordis', '@deepseek-ai/cordis', 'schemastery'})


class ServiceError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.status, self.code, self.message, self.extra = status, code, message, extra


def _host_error(error: HostRequestError) -> ServiceError:
    body = error.body if isinstance(error.body, dict) else {}
    status = error.status if error.status in (400, 404, 409, 422, 429) else 502
    message = body.get('error') or body.get('message') or 'The plugin host refused the request.'
    return ServiceError(status, str(body.get('code') or 'host_error'), str(message))


class CordisService:
    def __init__(self, data_dir: Path, *, fetcher: Fetcher | None = None, supervisor_options: dict[str, Any] | None = None, enabled: bool = True):
        self.data_dir = data_dir
        self.root = (data_dir / 'cordis-plugins').resolve()
        self.packages = self.root / 'pkg'
        self._enabled = enabled
        self._fetcher: Fetcher = fetcher or sources.default_fetcher
        self.registry = Registry(data_dir / 'cordis-plugins.json')
        self.supervisor = CordisSupervisor(self.root, on_running=self._reconcile, **(supervisor_options or {}))
        self._lock = threading.RLock()
        self._staged: dict[str, dict[str, Any]] = {}
        self._states: dict[str, dict[str, Any]] = {}
        self.dev = DevArea(self.root / 'dev')
        self._requests: dict[str, dict[str, Any]] = {}
        self._creator_file = data_dir / 'cordis-creator.json'
        self.index_fetcher: index.Fetcher | None = None  # tests inject one; None is the https fetcher
        self.index_resolver: index.Resolver | None = None  # tests inject one; None is getaddrinfo
        self.tarball_download: sources.TarballDownload | None = None  # tests inject one; None is the checked https download
        self._jobs: dict[str, dict[str, Any]] = {}  # live fetches: their log of steps, and the event Cancel sets

    # -- lifecycle -------------------------------------------------------
    def start(self) -> None:
        if not self._enabled:
            self.supervisor._set(UNAVAILABLE, 'Plugins are turned off (OH_CORDIS_DISABLE).')
            return
        self.supervisor.start()

    def stop(self) -> None:
        self.supervisor.stop()

    # -- helpers ---------------------------------------------------------
    def _inside_packages(self, path: Path) -> bool:
        try:
            return path.resolve().is_relative_to(self.packages.resolve()) and path.resolve() != self.packages.resolve()
        except OSError:
            return False

    def _confirm(self, entry: dict[str, Any]) -> dict[str, Any]:
        confirmation: dict[str, Any] = {'accept': True, 'digest': entry['digest']}
        if entry.get('scripts'):
            confirmation['scripts'] = 'do-not-run'
        return confirmation

    def _host_install(self, entry: dict[str, Any]) -> dict[str, Any]:
        body: dict[str, Any] = {'packageDir': entry['packageDir'], 'confirmation': self._confirm(entry)}
        if entry.get('config') is not None:
            body['config'] = entry['config']
        return self.supervisor.request('POST', '/v1/plugins/install', body)

    def _record(self, plugin_id: str, state: str, message: str | None = None) -> None:
        self._states[plugin_id] = {'state': state, 'message': message}

    def _load_into_host(self, entry: dict[str, Any]) -> None:
        """Install a registered plugin into the running host with the digest the person already confirmed."""
        try:
            result = self._host_install(entry)
            self._record(entry['id'], result.get('status', 'failed'), result.get('message'))
        except HostRequestError as error:
            body = error.body if isinstance(error.body, dict) else {}
            if body.get('code') == 'confirmation-mismatch':
                self._record(entry['id'], 'changed', 'The package changed since it was confirmed; confirm it again.')
            else:
                self._record(entry['id'], 'failed', str(body.get('message') or body.get('error') or 'The plugin host refused it.'))
                self._drop_from_host(entry['name'])

    def _drop_from_host(self, name: str) -> None:
        try:
            self.supervisor.request('POST', '/v1/plugins/unload', {'name': name})
        except (HostRequestError, CordisUnavailable):
            # Not loaded, or no host running: either way nothing of this plugin runs, which is the goal.
            _log.debug('plugin %s was not loaded in the host', name)

    def _reconcile(self, _supervisor: CordisSupervisor) -> None:
        """The host just came up: load every enabled plugin again with its stored digest."""
        with self._lock:
            for entry in self.registry.list():
                if not entry.get('enabled'):
                    continue
                if not Path(entry['packageDir']).is_dir():
                    self._record(entry['id'], 'failed', 'The plugin files are missing.')
                    continue
                self._load_into_host(entry)

    def _gc_stages(self) -> None:
        keep = {Path(p['stageDir']).name for p in self.registry.list() if p.get('stageDir')} | set(self._jobs)
        now = time.time()
        for child in self.packages.iterdir() if self.packages.is_dir() else ():
            try:
                if child.name not in keep and child.name not in self._staged and now - child.stat().st_mtime > STALE_STAGE_S:
                    shutil.rmtree(child, ignore_errors=True)
            except OSError:
                continue

    def _view(self, entry: dict[str, Any], live: dict[str, dict[str, Any]] | None) -> dict[str, Any]:
        if not entry.get('enabled'):
            state, message = 'disabled', None
        elif live is None:
            state, message = 'unavailable', self.supervisor.reason
        else:
            hosted = live.get(entry['name'])
            recorded = self._states.get(entry['id'], {})
            if hosted is not None:
                state, message = hosted.get('status', 'failed'), hosted.get('message')
            else:
                state, message = recorded.get('state', 'failed'), recorded.get('message')
                if state == 'active':
                    state = 'failed'
        view = {k: entry.get(k) for k in ('id', 'name', 'version', 'source', 'enabled', 'scripts', 'runtime', 'capabilities')}
        view['state'], view['message'] = state, message
        view['madeByNilo'] = bool(entry.get('dev'))
        source = entry.get('source') or {}
        if source.get('kind') == 'github':
            sub = f'/{source["subdir"]}' if source.get('subdir') else ''
            view['shareLink'] = f'https://github.com/{source["spec"]}/tree/{source["commit"]}{sub}'
        return view

    def _live(self) -> dict[str, dict[str, Any]] | None:
        if self.supervisor.state != RUNNING:
            return None
        try:
            rows = self.supervisor.request('GET', '/v1/plugins').get('plugins', [])
        except (CordisUnavailable, HostRequestError):
            return None
        return {row['name']: row for row in rows}

    # -- reads -----------------------------------------------------------
    def status(self) -> dict[str, Any]:
        info = self.supervisor.status()
        info['plugins'] = len(self.registry.list())
        return info

    def list_plugins(self) -> list[dict[str, Any]]:
        live = self._live()
        return [self._view(entry, live) for entry in self.registry.list()]

    def logs(self, plugin_id: str, tail: int) -> list[str]:
        entry = self._entry(plugin_id)
        return self.supervisor.plugin_log(entry['name'], tail)

    def _entry(self, plugin_id: str) -> dict[str, Any]:
        entry = self.registry.get(plugin_id)
        if entry is None:
            raise ServiceError(404, 'plugin_not_found', 'No such plugin.')
        return entry

    # -- fetch + preview -------------------------------------------------
    def _download_tarball(self, url: str, limit: int, cancel: threading.Event | None) -> bytes:
        if self.tarball_download is not None:
            return self.tarball_download(url, limit, cancel)
        return index.download_https(url, limit, cancel, resolve=self.index_resolver)

    def fetch(self, kind: str, spec: str, *, version: str | None = None, commit: str | None = None, subdir: str | None = None,
              integrity: str | None = None, stage_id: str | None = None, cancel: threading.Event | None = None,
              progress: sources.Progress | None = None) -> dict[str, Any]:
        """Download (or copy) a package into its own stage folder and preview it in the host. The download runs outside the lock,
        so a Cancel or a list never waits behind it."""
        self.supervisor.request('GET', '/v1/health')  # fail early, before anything is downloaded, when the host is not up
        with self._lock:
            self._gc_stages()
            stage_id = stage_id or secrets.token_hex(8)
            stage = self.packages / stage_id
            stage.mkdir(parents=True)
        try:
            if kind == 'npm':
                package = sources.fetch_npm(spec, version or '', stage, fetcher=self._fetcher, cancel=cancel, progress=progress)
                source: dict[str, Any] = {'kind': 'npm', 'spec': spec, 'version': version}
            elif kind == 'github':
                package = sources.fetch_github(spec, commit or '', subdir, stage, fetcher=self._fetcher, cancel=cancel, progress=progress)
                source = {'kind': 'github', 'spec': spec, 'commit': (commit or '').lower(), 'subdir': subdir or ''}
            elif kind == 'local':
                package, source = sources.fetch_local(spec, stage, progress=progress), {'kind': 'local', 'spec': spec}
            elif kind == 'tarball':
                package = sources.fetch_tarball(spec, integrity, stage, download=self._download_tarball, cancel=cancel, progress=progress)
                source = {'kind': 'tarball', 'spec': spec, 'integrity': (integrity or '').strip() or None}
            else:
                raise SourceError('invalid_spec', 'Unknown source kind.')
            if cancel is not None and cancel.is_set():
                raise SourceError('cancelled', 'The download was cancelled.')
            preview = self._preview(package)
        except SourceError as error:
            shutil.rmtree(stage, ignore_errors=True)
            raise ServiceError(422, error.code, error.message) from error
        except BaseException:
            shutil.rmtree(stage, ignore_errors=True)
            raise
        with self._lock:
            self._staged[stage_id] = {'packageDir': str(package.resolve()), 'stageDir': str(stage), 'source': source, 'preview': preview}
        if progress is not None:
            progress('preview-ready')
        return {'fetchId': stage_id, 'source': source, 'preview': preview}

    # -- live fetch: a log of steps the screen polls, and a real Cancel -----
    def _event(self, job: dict[str, Any], step: str) -> None:
        with self._lock:
            job['events'].append({'step': step, 'at': time.time()})

    def _job_view(self, job: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            view: dict[str, Any] = {'fetchId': job['id'], 'state': job['state'], 'events': [dict(e) for e in job['events']]}
            if job.get('result') is not None:
                view['result'] = job['result']
            if job.get('error') is not None:
                view['error'] = dict(job['error'])
            return view

    def start_fetch(self, kind: str, spec: str, **options: Any) -> dict[str, Any]:
        """Start a fetch in the background and answer at once; `fetch_status` reports each step and `cancel_fetch` stops it."""
        self.supervisor.request('GET', '/v1/health')
        job: dict[str, Any] = {'id': secrets.token_hex(8), 'state': 'running', 'events': [], 'cancel': threading.Event(),
                               'result': None, 'error': None, 'started': time.time()}
        with self._lock:
            self._jobs[job['id']] = job
            for old in sorted(self._jobs.values(), key=lambda j: j['started'])[:-MAX_JOBS]:
                if old['state'] != 'running':
                    self._jobs.pop(old['id'], None)
        job['thread'] = threading.Thread(target=self._run_job, args=(job, kind, spec, options), name=f'cordis-fetch-{job["id"]}', daemon=True)
        job['thread'].start()
        return self._job_view(job)

    def _run_job(self, job: dict[str, Any], kind: str, spec: str, options: dict[str, Any]) -> None:
        result, failure = None, None
        try:
            result = self.fetch(kind, spec, stage_id=job['id'], cancel=job['cancel'], progress=lambda step: self._event(job, step), **options)
        except ServiceError as error:
            failure = {'code': error.code, 'message': error.message}
        except CordisUnavailable as error:
            failure = {'code': 'cordis_unavailable', 'message': error.reason or 'The plugin host is not running.'}
        except Exception:  # noqa: BLE001 - the screen gets a stable code; the stack stays in the sidecar log
            _log.exception('plugin fetch failed')
            failure = {'code': 'fetch_failed', 'message': 'The package could not be checked.'}
        with self._lock:
            if job['state'] != 'running':
                return
            if job['cancel'].is_set():
                self._discard(job['id'])
                job['state'] = 'cancelled'
                job['events'].append({'step': 'cancelled', 'at': time.time()})
            elif failure is not None:
                job['state'], job['error'] = 'failed', failure
                job['events'].append({'step': 'failed', 'at': time.time()})
            else:
                job['state'], job['result'] = 'ready', result

    def fetch_status(self, fetch_id: str) -> dict[str, Any]:
        job = self._jobs.get(fetch_id) if FETCH_ID.match(fetch_id) else None
        if job is None:
            raise ServiceError(404, 'fetch_not_found', 'That download is not known; fetch the package again.')
        return self._job_view(job)

    def cancel_fetch(self, fetch_id: str) -> dict[str, Any]:
        """Cancel a running download, or drop a preview nobody installs ("Do not install"): its stage folder is removed either way."""
        job = self._jobs.get(fetch_id) if FETCH_ID.match(fetch_id) else None
        if job is None:
            with self._lock:
                if fetch_id not in self._staged:
                    raise ServiceError(404, 'fetch_not_found', 'That download is not known; fetch the package again.')
                self._discard(fetch_id)
            return {'fetchId': fetch_id, 'state': 'cancelled', 'events': [{'step': 'cancelled', 'at': time.time()}]}
        if job['state'] == 'installed':
            raise ServiceError(409, 'already_installed', 'That package is installed; remove it from the list instead.')
        job['cancel'].set()
        thread = job.get('thread')
        if thread is not None and thread is not threading.current_thread():
            thread.join(CANCEL_WAIT_S)  # the fetcher checks the event between chunks, so this is short
        with self._lock:
            self._discard(fetch_id)
            shutil.rmtree(self.packages / fetch_id, ignore_errors=True)
            job['result'] = None
            if job['state'] in ('running', 'ready'):
                job['state'] = 'cancelled'
                job['events'].append({'step': 'cancelled', 'at': time.time()})
        return self._job_view(job)

    def _preview(self, package: Path) -> dict[str, Any]:
        try:
            seen = self.supervisor.request('POST', '/v1/plugins/preview', {'packageDir': str(package.resolve())})
        except HostRequestError as error:
            raise _host_error(error) from error
        manifest = sources._read_manifest(package)
        deps = manifest.get('dependencies') if isinstance(manifest.get('dependencies'), dict) else {}
        unmet = sorted(name for name in deps if name not in HOST_PROVIDED)
        keep = ('name', 'version', 'runtime', 'runtimeDefaulted', 'isolation', 'capabilities', 'capabilitiesDeclared', 'scripts', 'bundlePatchIgnored', 'digest', 'warning')
        view = {k: seen.get(k) for k in keep}
        view['unmetDependencies'] = unmet
        if unmet:
            view['warnings'] = [{'code': 'unmet-dependencies', 'dependencies': unmet}]
        else:
            view['warnings'] = []
        return view

    # -- install ---------------------------------------------------------
    def install(self, fetch_id: str, *, accept: bool, digest: str, scripts: str | None, config: dict[str, Any] | None = None,
                dev: dict[str, Any] | None = None, scripts_accepted: list[str] | None = None) -> dict[str, Any]:
        """`scripts_accepted` is the person's decision for each lifecycle script of THIS fetch ("accept without running"). It is checked
        against this preview and digest only and never kept for another package; the host still gets `scripts: do-not-run` and runs none."""
        job = self._jobs.get(fetch_id) if FETCH_ID.match(fetch_id) else None
        with self._lock:
            staged = self._staged.get(fetch_id) if FETCH_ID.match(fetch_id) else None
            declared = sorted((staged or {}).get('preview', {}).get('scripts') or [])
            if staged is not None and declared and (digest != staged['preview'].get('digest') or sorted(scripts_accepted or []) != declared):
                raise ServiceError(422, 'scripts_not_reviewed', 'Decide each lifecycle script of this package before installing it.', scripts=declared)
            if job is not None and staged is not None:
                job['events'].append({'step': 'installing', 'at': time.time()})
            try:
                plugin = self._install_staged(fetch_id, accept=accept, digest=digest, scripts=scripts, config=config, dev=dev)
            except BaseException:
                if job is not None and staged is not None:
                    job['events'].append({'step': 'failed', 'at': time.time()})
                raise
            if job is not None:
                job['state'] = 'installed'
                job['events'].append({'step': 'done', 'at': time.time()})
            return plugin

    def _install_staged(self, fetch_id: str, *, accept: bool, digest: str, scripts: str | None, config: dict[str, Any] | None,
                        dev: dict[str, Any] | None) -> dict[str, Any]:
        if not FETCH_ID.match(fetch_id):
            raise ServiceError(404, 'fetch_not_found', 'That download is not known; fetch the package again.')
        with self._lock:
            staged = self._staged.get(fetch_id)
            if staged is None:
                raise ServiceError(404, 'fetch_not_found', 'That download is not known; fetch the package again.')
            preview = staged['preview']
            confirmation: dict[str, Any] = {'accept': accept, 'digest': digest}
            if scripts is not None:
                confirmation['scripts'] = scripts
            previous = self.registry.find_by_name(preview['name'])
            if previous is not None:
                self._drop_from_host(previous['name'])
            try:
                body: dict[str, Any] = {'packageDir': staged['packageDir'], 'confirmation': confirmation}
                if config is not None:
                    body['config'] = config
                result = self.supervisor.request('POST', '/v1/plugins/install', body)
            except HostRequestError as error:
                self._drop_from_host(preview['name'])
                if previous is not None and previous.get('enabled'):
                    self._load_into_host(previous)
                body = error.body if isinstance(error.body, dict) else {}
                if error.status == 422 and body.get('status') == 'failed':
                    raise ServiceError(422, 'plugin_failed', str(body.get('message') or 'The plugin failed to load.')) from error
                raise _host_error(error) from error
            except CordisUnavailable:
                if previous is not None and previous.get('enabled'):
                    self._load_into_host(previous)
                raise
            entry = self.registry.upsert({
                'name': preview['name'], 'version': preview['version'], 'source': staged['source'],
                'packageDir': staged['packageDir'], 'stageDir': staged['stageDir'], 'digest': digest,
                'scripts': preview['scripts'] or [], 'enabled': True,
                'runtime': preview['runtime'], 'capabilities': preview['capabilities'],
                'config': config, 'dev': dev,
            })
            self._staged.pop(fetch_id, None)
            self._record(entry['id'], result.get('status', 'failed'), result.get('message'))
            if previous is not None and previous.get('stageDir') and previous['stageDir'] != entry['stageDir']:
                self._remove_stage(previous['stageDir'])
            return self._view(entry, self._live())

    def _remove_stage(self, stage_dir: str) -> None:
        path = Path(stage_dir)
        if path.parent.resolve() == self.packages.resolve():
            shutil.rmtree(path, ignore_errors=True)

    # -- switch + remove -------------------------------------------------
    def enable(self, plugin_id: str) -> dict[str, Any]:
        with self._lock:
            self._entry(plugin_id)
            entry = self.registry.set_enabled(plugin_id, True) or {}
            if self.supervisor.state == RUNNING:
                self._load_into_host(entry)
            return self._view(entry, self._live())

    def disable(self, plugin_id: str) -> dict[str, Any]:
        with self._lock:
            entry = self._entry(plugin_id)
            self._drop_from_host(entry['name'])
            saved = self.registry.set_enabled(plugin_id, False) or entry
            self._states.pop(plugin_id, None)
            return self._view(saved, self._live())

    def delete(self, plugin_id: str) -> None:
        with self._lock:
            entry = self._entry(plugin_id)
            self._drop_from_host(entry['name'])
            self.registry.remove(plugin_id)
            self._states.pop(plugin_id, None)
            if entry.get('stageDir'):
                self._remove_stage(entry['stageDir'])

    # -- share -----------------------------------------------------------
    def export(self, plugin_id: str) -> tuple[str, bytes]:
        entry = self._entry(plugin_id)
        package = Path(entry['packageDir'])
        if not self._inside_packages(package) or not package.is_dir():
            raise ServiceError(404, 'plugin_files_missing', 'The plugin files are missing.')
        # Reproducible: sorted names, no times, owners or modes of this computer, and a gzip header without a date. The same files give
        # the same bytes, so the hash written in the exported index matches the .tgz wherever it is put.
        buffer, total = io.BytesIO(), 0
        with gzip.GzipFile(filename='', mode='wb', fileobj=buffer, mtime=0) as zipped, tarfile.open(fileobj=zipped, mode='w', format=tarfile.PAX_FORMAT) as tar:
            for here, dirnames, filenames in os.walk(package, followlinks=False):
                dirnames.sort()
                for name in sorted(filenames):
                    file = Path(here) / name
                    if file.is_symlink() or not file.is_file():
                        continue
                    data = file.read_bytes()
                    total += len(data)
                    if total > sources.MAX_BYTES:
                        raise ServiceError(413, 'archive_too_large', 'The plugin is larger than the sharing limit.')
                    info = tarfile.TarInfo(f'package/{file.relative_to(package).as_posix()}')
                    info.size, info.mode, info.mtime = len(data), 0o644, 0
                    tar.addfile(info, io.BytesIO(data))
        safe = re.sub(r'[^A-Za-z0-9._-]+', '-', entry['name']).strip('-') or 'plugin'
        return f'{safe}-{entry["version"]}.tgz', buffer.getvalue()

    def export_index(self, plugin_id: str) -> dict[str, Any]:
        """A `format: 1` index with this one plugin, built from its package.json and its files only: nothing of the package runs."""
        entry = self._entry(plugin_id)
        manifest = sources._read_manifest(Path(entry['packageDir']))
        source = entry.get('source') or {}
        if source.get('kind') == 'npm':
            described: dict[str, Any] = {'type': 'npm'}
        elif source.get('kind') == 'github':
            described = {'type': 'git', 'url': f'https://github.com/{source["spec"]}', 'commit': source['commit'], 'path': source.get('subdir') or ''}
        elif source.get('kind') == 'tarball' and str(source.get('spec', '')).startswith('https://') and source.get('integrity'):
            described = {'type': 'tarball', 'url': source['spec'], 'integrity': source['integrity']}
        else:  # a local folder or file: the exported .tgz by its hash; the person puts it at an https address and edits `url`
            filename, data = self.export(plugin_id)
            described = {'type': 'tarball', 'url': f'./{filename}', 'integrity': 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode()}
        author = manifest.get('author')
        repo = manifest.get('repository')
        repo = repo.get('url') if isinstance(repo, dict) else repo
        if isinstance(repo, str):
            repo = repo.removeprefix('git+')
            repo = repo[:-4] if repo.endswith('.git') else repo
        plugin = {'name': entry['name'], 'title': index._text(manifest.get('displayName'), 'title'),
                  'description': index._text(manifest.get('description'), 'description'),
                  'author': index._text(author.get('name') if isinstance(author, dict) else author, 'author'),
                  'homepage': index._https(manifest.get('homepage')), 'repository': index._https(repo),
                  'versions': [{'version': entry['version'], 'source': described}]}
        return {'format': 1, 'title': plugin['title'] or entry['name'], 'plugins': [plugin]}

    # -- creator mode (the chat agent's `cordis_plugins` tool) -------------
    def _creator_threads(self) -> list[str]:
        try:
            threads = json.loads(self._creator_file.read_text(encoding='utf8')).get('threads')
        except (OSError, ValueError, AttributeError):
            return []
        return [t for t in threads if isinstance(t, str) and THREAD_ID.match(t)] if isinstance(threads, list) else []

    def creator_on(self, thread_id: str | None) -> bool:
        """Creator mode belongs to one chat thread; only the person turns it on (a human route), never the agent."""
        return bool(thread_id) and thread_id in self._creator_threads()

    def set_creator(self, thread_id: str, enabled: bool) -> dict[str, Any]:
        if not isinstance(thread_id, str) or not THREAD_ID.match(thread_id):
            raise ServiceError(422, 'invalid_thread', 'That is not a chat thread id.')
        with self._lock:
            threads = [t for t in self._creator_threads() if t != thread_id]
            if enabled:
                threads.append(thread_id)
            self._creator_file.parent.mkdir(parents=True, exist_ok=True)
            self._creator_file.write_text(json.dumps({'threads': threads[-MAX_CREATOR_THREADS:]}), encoding='utf8')
        return {'threadId': thread_id, 'enabled': self.creator_on(thread_id)}

    def api_catalog(self) -> dict[str, Any]:
        """What the live host offers, read only and without code: services, tools, commands and the loaded plugins."""
        services = self.supervisor.request('GET', '/v1/services')
        plugins = self.supervisor.request('GET', '/v1/plugins').get('plugins', [])
        keep = ('name', 'version', 'runtime', 'status')
        return {'services': services.get('services', []), 'tools': sorted(services.get('tools', [])), 'commands': sorted(services.get('commands', [])),
                'plugins': [{k: row.get(k) for k in keep} for row in plugins if isinstance(row, dict)]}

    def _dev_entry(self, dev_name: str) -> dict[str, Any] | None:
        return next((e for e in self.registry.list() if (e.get('dev') or {}).get('name') == dev_name), None)

    def dev_packages(self) -> list[dict[str, Any]]:
        live = self._live()
        rows = []
        for row in self.dev.list():
            entry = self._dev_entry(row['name'])
            installed = None
            if entry is not None:
                view = self._view(entry, live)
                installed = {'id': entry['id'], 'state': view['state'], 'upToDate': entry['dev'].get('digest') == row['digest']}
            rows.append({'name': row['name'], 'files': row['files'], 'installed': installed})
        return rows

    def _discard(self, fetch_id: str) -> None:
        staged = self._staged.pop(fetch_id, None)
        if staged is not None:
            self._remove_stage(staged['stageDir'])

    def dev_preview(self, dev_name: str) -> dict[str, Any]:
        fetched = self.fetch('local', str(self.dev.path(dev_name)))
        with self._lock:
            self._discard(fetched['fetchId'])
        return fetched['preview']

    def _request_view(self, request: dict[str, Any]) -> dict[str, Any]:
        view = {k: request[k] for k in ('id', 'devName', 'name', 'version', 'createdAt', 'status', 'preview')}
        view['changed'] = False
        if request['status'] == 'pending':
            try:
                view['changed'] = self.dev.digest(request['devName']) != request['devDigest']
            except DevError:
                view['changed'] = True
        replaced = self.registry.find_by_name(request['name'])
        view['replaces'] = None if replaced is None else {
            'version': replaced['version'], 'madeByNilo': bool(replaced.get('dev')), 'source': (replaced.get('source') or {}).get('kind')}
        return view

    def request_install(self, dev_name: str) -> dict[str, Any]:
        """Stage a development package for the person to approve. The agent never installs; this only leaves a pending request."""
        digest = self.dev.digest(dev_name)
        entry = self._dev_entry(dev_name)
        if entry is not None and entry.get('enabled') and entry['dev'].get('digest') == digest:
            return {'unchanged': True, 'plugin': self._view(entry, self._live())}
        fetched = self.fetch('local', str(self.dev.path(dev_name)))
        with self._lock:
            for old in self._requests.values():
                if old['devName'] == dev_name and old['status'] == 'pending':
                    old['status'] = 'superseded'
                    self._discard(old['fetchId'])
            request = {
                'id': secrets.token_hex(8), 'devName': dev_name, 'name': fetched['preview']['name'], 'version': fetched['preview']['version'],
                'createdAt': time.time(), 'status': 'pending', 'fetchId': fetched['fetchId'], 'devDigest': digest, 'preview': fetched['preview'],
            }
            self._requests[request['id']] = request
            while len(self._requests) > 50:
                oldest = min(self._requests.values(), key=lambda r: r['createdAt'])
                self._discard(oldest['fetchId'])
                self._requests.pop(oldest['id'])
            return {'request': self._request_view(request)}

    def list_requests(self) -> list[dict[str, Any]]:
        with self._lock:
            rows = sorted(self._requests.values(), key=lambda r: (r['status'] != 'pending', -r['createdAt']))
            return [self._request_view(r) for r in rows]

    def _pending(self, request_id: str) -> dict[str, Any]:
        request = self._requests.get(request_id) if FETCH_ID.match(request_id) else None
        if request is None:
            raise ServiceError(404, 'request_not_found', 'No such request.')
        if request['status'] != 'pending':
            raise ServiceError(409, 'request_closed', 'That request was already answered.')
        return request

    def approve_request(self, request_id: str) -> dict[str, Any]:
        """The person's click: install the staged package with the digest of the preview they saw, if the files are still the same."""
        with self._lock:
            request = self._pending(request_id)
            try:
                current = self.dev.digest(request['devName'])
            except DevError:
                current = None
            if current != request['devDigest']:
                request['status'] = 'stale'
                self._discard(request['fetchId'])
                raise ServiceError(409, 'request_stale', 'The files changed after Nilo asked; ask Nilo for a new request.')
            preview = request['preview']
            plugin = self.install(request['fetchId'], accept=True, digest=preview['digest'], scripts='do-not-run' if preview['scripts'] else None,
                                  dev={'name': request['devName'], 'digest': request['devDigest']}, scripts_accepted=list(preview['scripts'] or []))
            request['status'] = 'approved'
            return {'request': self._request_view(request), 'plugin': plugin}

    def reject_request(self, request_id: str) -> dict[str, Any]:
        with self._lock:
            request = self._pending(request_id)
            request['status'] = 'rejected'
            self._discard(request['fetchId'])
            return {'request': self._request_view(request)}

    def dev_logs(self, dev_name: str, tail: int = 100) -> list[str]:
        self.dev.path(dev_name)
        entry = self._dev_entry(dev_name)
        if entry is None:
            raise ServiceError(404, 'not_installed', 'That package is not installed yet; request_install and wait for the approval.')
        return self.supervisor.plugin_log(entry['name'], tail)

    # -- the agent's way to plugin tools and commands (the host token stays here) --
    def invoke_tool(self, name: str, args: Any) -> dict[str, Any]:
        try:
            return self.supervisor.request('POST', '/v1/tools/invoke', {'name': name, 'args': args})
        except HostRequestError as error:
            raise _host_error(error) from error

    def execute_command(self, line: str) -> dict[str, Any]:
        try:
            return self.supervisor.request('POST', '/v1/commands/execute', {'line': line})
        except HostRequestError as error:
            raise _host_error(error) from error

def disabled_by_environment(env: Mapping[str, str]) -> bool:
    return env.get('OH_CORDIS_DISABLE', '') == '1'

