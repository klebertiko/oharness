"""Installed plugins, kept in one JSON file under the data folder (ADR 0071).

An entry is what a person confirmed: package name and version, where it came from, the folder it sits in, the digest of
the warning and files they confirmed, the lifecycle scripts that never run, and whether it should load. Nothing secret
is stored here.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import threading
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)
VERSION = 1


class Registry:
    def __init__(self, path: Path):
        self._path = path
        self._lock = threading.RLock()
        self._plugins: list[dict[str, Any]] = self._load()

    def _load(self) -> list[dict[str, Any]]:
        try:
            parsed = json.loads(self._path.read_text(encoding='utf8'))
            plugins = parsed['plugins']
            if parsed.get('version') != VERSION or not isinstance(plugins, list) or not all(isinstance(p, dict) and isinstance(p.get('id'), str) for p in plugins):
                raise ValueError('shape')
            return plugins
        except FileNotFoundError:
            return []
        except (OSError, ValueError, KeyError, TypeError):
            _log.warning('the plugin registry could not be read; it was set aside and the list starts empty')
            try:
                os.replace(self._path, self._path.with_name(self._path.name + '.bad'))
            except OSError:
                _log.warning('the unreadable plugin registry could not be set aside either')
            return []

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self._path.with_name(f'{self._path.name}.{secrets.token_hex(4)}.tmp')
        try:
            temporary.write_text(json.dumps({'version': VERSION, 'plugins': self._plugins}, indent=2), encoding='utf8')
            os.replace(temporary, self._path)
        finally:
            temporary.unlink(missing_ok=True)

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(p) for p in self._plugins]

    def get(self, plugin_id: str) -> dict[str, Any] | None:
        with self._lock:
            found = next((p for p in self._plugins if p['id'] == plugin_id), None)
            return dict(found) if found is not None else None

    def find_by_name(self, name: str) -> dict[str, Any] | None:
        with self._lock:
            found = next((p for p in self._plugins if p.get('name') == name), None)
            return dict(found) if found is not None else None

    def upsert(self, entry: dict[str, Any]) -> dict[str, Any]:
        """Add a plugin, or replace the one with the same name (another version of it) and keep its id."""
        with self._lock:
            existing = next((p for p in self._plugins if p.get('name') == entry['name']), None)
            saved = {**entry, 'id': existing['id'] if existing is not None else secrets.token_hex(8)}
            if existing is not None:
                self._plugins[self._plugins.index(existing)] = saved
            else:
                self._plugins.append(saved)
            self._save()
            return dict(saved)

    def set_enabled(self, plugin_id: str, enabled: bool) -> dict[str, Any] | None:
        with self._lock:
            found = next((p for p in self._plugins if p['id'] == plugin_id), None)
            if found is None:
                return None
            found['enabled'] = enabled
            self._save()
            return dict(found)

    def remove(self, plugin_id: str) -> dict[str, Any] | None:
        with self._lock:
            found = next((p for p in self._plugins if p['id'] == plugin_id), None)
            if found is None:
                return None
            self._plugins.remove(found)
            self._save()
            return dict(found)
