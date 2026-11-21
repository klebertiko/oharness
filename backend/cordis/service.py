"""The plugin manager the `/cordis` routes call: fetch, preview, confirm, install, switch, remove, share (ADR 0071).

It owns the supervisor, the registry and the downloaded packages. A package is fetched into a folder inside the plugin
folder the host is allowed to read, shown to the person with the host's own warning, and loaded only after they confirm
the digest of that warning and those files.
"""
from __future__ import annotations

import io
import json
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

from cordis import sources
from cordis.creator import ActionBook, CreatorError, read_description, write_starter
from cordis.index import build_index, load_index, parse_index
from cordis.registry import Registry
from cordis.sources import Fetcher, SourceError
from cordis.supervisor import RUNNING, UNAVAILABLE, CordisSupervisor, CordisUnavailable, HostRequestError

FETCH_ID = re.compile(r'^[0-9a-f]{16}$')
STALE_STAGE_S = 24 * 3600
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
    def __init__(self, data_dir: Path, *, fetcher: Fetcher | None = None, index_fetcher: Fetcher | None = None, supervisor_options: dict[str, Any] | None = None, enabled: bool = True):
        self.data_dir = data_dir
        self.root = (data_dir / 'cordis-plugins').resolve()
        self.packages = self.root / 'pkg'
        self._enabled = enabled
        self._fetcher: Fetcher = fetcher or sources.default_fetcher
        self._index_fetcher = index_fetcher
        self.registry = Registry(data_dir / 'cordis-plugins.json')
        self.supervisor = CordisSupervisor(self.root, on_running=self._reconcile, **(supervisor_options or {}))
        self.actions = ActionBook()
        self._lock = threading.RLock()
        self._log_lock = threading.Lock()
        self._staged: dict[str, dict[str, Any]] = {}
        self._states: dict[str, dict[str, Any]] = {}
        self._fetch_logs: dict[str, list[str]] = {}

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
        return self.supervisor.request('POST', '/v1/plugins/install', {'packageDir': entry['packageDir'], 'confirmation': self._confirm(entry)})

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
            pass

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
        keep = {Path(p['stageDir']).name for p in self.registry.list() if p.get('stageDir')}
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
    def _note(self, fetch_id: str, line: str) -> None:
        with self._log_lock:
            self._fetch_logs.setdefault(fetch_id, []).append(line)

    def fetch_log(self, fetch_id: str) -> list[str]:
        """Lines for one download. Does not take the install lock, so a poll can read them while install runs."""
        with self._log_lock:
            if fetch_id not in self._fetch_logs:
                raise ServiceError(404, 'fetch_not_found', 'That download is not known; fetch the package again.')
            return list(self._fetch_logs[fetch_id])

    def discard(self, fetch_id: str) -> None:
        """Drop a download that will not be installed. Unknown ids are ignored."""
        with self._lock:
            staged = self._staged.pop(fetch_id, None)
            if staged and staged.get('stageDir'):
                self._remove_stage(staged['stageDir'])
        with self._log_lock:
            self._fetch_logs.pop(fetch_id, None)

    def fetch(self, kind: str, spec: str, *, version: str | None = None, commit: str | None = None, subdir: str | None = None, cancel: threading.Event | None = None) -> dict[str, Any]:
        self.supervisor.request('GET', '/v1/health')  # fail early, before anything is downloaded, when the host is not up
        with self._lock:
            self._gc_stages()
            stage_id = secrets.token_hex(8)
            stage = self.packages / stage_id
            stage.mkdir(parents=True)
            self._note(stage_id, 'downloading')

            def fetching(url: str, limit: int) -> bytes:
                if cancel is not None and cancel.is_set():
                    raise SourceError('cancelled', 'The download was cancelled.')
                return self._fetcher(url, limit)

            try:
                if cancel is not None and cancel.is_set():
                    raise SourceError('cancelled', 'The download was cancelled.')
                if kind == 'npm':
                    package, source = sources.fetch_npm(spec, version or '', stage, fetcher=fetching), {'kind': 'npm', 'spec': spec, 'version': version}
                elif kind == 'github':
                    package = sources.fetch_github(spec, commit or '', subdir, stage, fetcher=fetching)
                    source = {'kind': 'github', 'spec': spec, 'commit': (commit or '').lower(), 'subdir': subdir or ''}
                elif kind == 'tarball':
                    package, source = sources.fetch_tarball(spec, stage, fetcher=fetching), {'kind': 'tarball', 'spec': spec}
                elif kind == 'local':
                    package, source = sources.fetch_local(spec, stage), {'kind': 'local', 'spec': spec}
                else:
                    raise SourceError('invalid_spec', 'Unknown source kind.')
                if cancel is not None and cancel.is_set():
                    raise SourceError('cancelled', 'The download was cancelled.')
                self._note(stage_id, 'inspecting')
                preview = self._preview(package)
            except SourceError as error:
                shutil.rmtree(stage, ignore_errors=True)
                with self._log_lock:
                    self._fetch_logs.pop(stage_id, None)
                status = 499 if error.code == 'cancelled' else 422
                raise ServiceError(status, error.code, error.message) from error
            except ServiceError:
                shutil.rmtree(stage, ignore_errors=True)
                with self._log_lock:
                    self._fetch_logs.pop(stage_id, None)
                raise
            self._note(stage_id, 'ready')
            self._staged[stage_id] = {'packageDir': str(package.resolve()), 'stageDir': str(stage), 'source': source, 'preview': preview}
            return {'fetchId': stage_id, 'source': source, 'preview': preview}

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
        view['packages'] = [{'name': view.get('name'), 'version': view.get('version'), 'scripts': list(view.get('scripts') or [])}]
        return view

    # -- install ---------------------------------------------------------
    def install(self, fetch_id: str, *, accept: bool, digest: str, scripts: str | None, enable: bool = True) -> dict[str, Any]:
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
            self._note(fetch_id, 'loading')
            seen = {'n': 0}
            stop = threading.Event()

            def pump() -> None:
                while not stop.wait(0.15):
                    try:
                        lines = self.supervisor.plugin_log(preview['name'], 200)
                    except (CordisUnavailable, HostRequestError, OSError):
                        continue
                    for line in lines[seen['n']:]:
                        self._note(fetch_id, line)
                    seen['n'] = len(lines)

            threading.Thread(target=pump, name='cordis-install-log', daemon=True).start()
            try:
                result = self.supervisor.request('POST', '/v1/plugins/install', {'packageDir': staged['packageDir'], 'confirmation': confirmation})
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
            finally:
                stop.set()
            for line in self.supervisor.plugin_log(preview['name'], 200)[seen['n']:]:
                self._note(fetch_id, line)
            entry = self.registry.upsert({
                'name': preview['name'], 'version': preview['version'], 'source': staged['source'],
                'packageDir': staged['packageDir'], 'stageDir': staged['stageDir'], 'digest': digest,
                'scripts': preview['scripts'] or [], 'enabled': enable,
                'runtime': preview['runtime'], 'capabilities': preview['capabilities'],
            })
            self._staged.pop(fetch_id, None)
            if enable:
                self._record(entry['id'], result.get('status', 'failed'), result.get('message'))
            else:
                self._drop_from_host(preview['name'])
                self._states.pop(entry['id'], None)
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
        buffer, total = io.BytesIO(), 0
        with tarfile.open(fileobj=buffer, mode='w:gz') as tar:
            for here, dirnames, filenames in os.walk(package, followlinks=False):
                dirnames.sort()
                for name in sorted(filenames):
                    file = Path(here) / name
                    if file.is_symlink():
                        continue
                    total += file.stat().st_size
                    if total > sources.MAX_BYTES:
                        raise ServiceError(413, 'archive_too_large', 'The plugin is larger than the sharing limit.')
                    tar.add(file, arcname=f'package/{file.relative_to(package).as_posix()}', recursive=False)
        safe = re.sub(r'[^A-Za-z0-9._-]+', '-', entry['name']).strip('-') or 'plugin'
        return f'{safe}-{entry["version"]}.tgz', buffer.getvalue()

    def _index_rows(self) -> list[dict[str, Any]]:
        rows = []
        for entry in self.registry.list():
            package = Path(entry.get('packageDir') or '')
            description = read_description(package) if self._inside_packages(package) and package.is_dir() else ''
            rows.append({**entry, 'description': description})
        return rows

    def marketplace(self) -> dict[str, Any]:
        path = self.data_dir / 'cordis-marketplace.json'
        if not path.is_file():
            return {'version': 1, 'plugins': [], 'trust': 'unreviewed'}
        try:
            return parse_index(path.read_bytes())
        except SourceError as error:
            raise ServiceError(422, error.code, error.message) from error

    def marketplace_from(self, url: str) -> dict[str, Any]:
        try:
            return load_index(url, fetcher=self._index_fetcher)
        except SourceError as error:
            status = 422 if error.code in ('bad_index', 'untrusted_host', 'archive_too_large') else 502
            raise ServiceError(status, error.code, error.message) from error

    def share(self, plugin_id: str, target: str) -> dict[str, Any]:
        """Write the static index for one plugin. Reads package.json as data and does not run it."""
        if target not in ('npm', 'git'):
            raise ServiceError(422, 'invalid_target', 'Share to npm or git.')
        self._entry(plugin_id)
        index = build_index(self._index_rows())
        path = self.data_dir / 'cordis-marketplace.json'
        path.write_text(json.dumps(index, indent=2), encoding='utf-8')
        filename, _data = self.export(plugin_id)
        return {'target': target, 'filename': filename, 'index': index, 'scriptsExecuted': False}

    def write_plugin_starter(self, folder: str, name: str, description: str) -> dict[str, Any]:
        try:
            return write_starter(folder, name, description)
        except CreatorError as error:
            raise ServiceError(422, error.code, error.message) from error

    def propose_action(self, fetch_id: str, digest: str, summary: str, scripts: str | None) -> dict[str, Any]:
        with self._lock:
            staged = self._staged.get(fetch_id)
            if staged is None:
                raise ServiceError(404, 'fetch_not_found', 'That download is not known; fetch the package again.')
            preview = staged['preview']
            if preview.get('digest') != digest:
                raise ServiceError(409, 'confirmation-mismatch', 'confirmation digest does not match this package')
            if preview.get('scripts') and scripts != 'do-not-run':
                raise ServiceError(409, 'lifecycle-scripts-not-run', 'lifecycle scripts are never run; confirm with scripts set to do-not-run')
            return self.actions.propose(fetch_id=fetch_id, digest=digest, summary=summary, scripts=scripts)

    def decide_action(self, action_id: str, decision: str, *, enable: bool = True) -> dict[str, Any]:
        try:
            action = self.actions.claim(action_id, decision)
        except CreatorError as error:
            status = 404 if error.code == 'action_not_found' else 409
            raise ServiceError(status, error.code, error.message) from error
        if decision == 'reject':
            self.discard(action['fetchId'])
            return {'id': action_id, 'status': 'rejected', 'applied': False}
        try:
            plugin = self.install(action['fetchId'], accept=True, digest=action['digest'], scripts=action.get('scripts'), enable=enable)
        except Exception:
            self.actions.finish(action_id, 'pending')
            raise
        self.actions.finish(action_id, 'approved')
        return {'id': action_id, 'status': 'approved', 'applied': True, 'plugin': plugin}


def disabled_by_environment(env: Mapping[str, str]) -> bool:
    return env.get('OH_CORDIS_DISABLE', '') == '1'

