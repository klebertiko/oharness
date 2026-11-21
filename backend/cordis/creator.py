"""Creator mode for a plugin: a read-only API catalog, starting files, and one approval per install.

Writing the starting files does not run them. An approval changes that one action
and no other. Package code is not imported here.
"""
from __future__ import annotations

import json
import re
import secrets
import threading
from pathlib import Path
from typing import Any

from cordis.sources import _is_link

_NAME = re.compile(r'^[a-z0-9][a-z0-9._-]{0,63}$')
APIS: tuple[dict[str, str], ...] = (
    {'id': 'tools', 'access': 'read'},
    {'id': 'commands', 'access': 'read'},
    {'id': 'events', 'access': 'read'},
    {'id': 'services', 'access': 'read'},
)


class CreatorError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def starter_files(name: str, description: str) -> dict[str, str]:
    """The files a new plugin starts from. Text only; nothing is executed."""
    manifest = {
        'name': name,
        'version': '0.1.0',
        'type': 'module',
        'main': './index.js',
        'description': description,
        'oharness': {'runtime': 'isolated', 'capabilities': []},
    }
    source = (
        f"export const name = {json.dumps(name)}\n"
        "export const inject = []\n"
        "export function apply() {}\n"
    )
    return {'package.json': json.dumps(manifest, indent=2) + '\n', 'index.js': source}


def write_starter(folder: str, name: str, description: str) -> dict[str, Any]:
    """Create ``folder/name`` with the starting files. Refuses links and an existing folder."""
    if not _NAME.match(name):
        raise CreatorError('invalid_name', 'Use a short package name: letters, digits, dot, underscore or hyphen.')
    root = Path(folder)
    if not root.is_absolute() or not root.is_dir() or _is_link(root):
        raise CreatorError('invalid_folder', 'Choose an existing folder by its absolute path.')
    dest = (root / name).resolve()
    try:
        inside = dest.is_relative_to(root.resolve())
    except OSError:
        inside = False
    # A missing path is not a link. `_is_link` treats a missing lstat as unsafe, which is right for a
    # source we copy and wrong for the folder we are about to create.
    if not inside or dest == root.resolve() or dest.is_symlink() or dest.exists():
        raise CreatorError('folder_exists', 'That plugin folder already exists.')
    text = ' '.join(description.split())[:400]
    files = starter_files(name, text)
    dest.mkdir()
    written: list[str] = []
    try:
        for rel, body in files.items():
            path = (dest / rel).resolve()
            if not path.is_relative_to(dest):
                raise CreatorError('invalid_folder', 'The starting files would leave the folder.')
            path.write_text(body, encoding='utf-8')
            written.append(rel)
    except CreatorError:
        raise
    except OSError as error:
        raise CreatorError('invalid_folder', 'The starting files could not be written.') from error
    return {'path': str(dest), 'files': sorted(written)}


class ActionBook:
    """Pending install actions. Deciding one does not decide the others."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rows: dict[str, dict[str, Any]] = {}

    def propose(self, *, fetch_id: str, digest: str, summary: str, scripts: str | None) -> dict[str, Any]:
        with self._lock:
            action_id = secrets.token_hex(8)
            row = {
                'id': action_id,
                'fetchId': fetch_id,
                'digest': digest,
                'summary': summary[:400],
                'scripts': scripts,
                'status': 'pending',
            }
            self._rows[action_id] = row
            return dict(row)

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(row) for row in self._rows.values()]

    def claim(self, action_id: str, decision: str) -> dict[str, Any]:
        """Move one pending action to working or rejected. A second action stays pending."""
        if decision not in ('approve', 'reject'):
            raise CreatorError('invalid_decision', 'Approve or reject this action.')
        with self._lock:
            row = self._rows.get(action_id)
            if row is None:
                raise CreatorError('action_not_found', 'That action is not pending.')
            if row['status'] != 'pending':
                raise CreatorError('action_not_pending', 'That action was already decided.')
            row['status'] = 'rejected' if decision == 'reject' else 'working'
            return dict(row)

    def finish(self, action_id: str, status: str) -> None:
        with self._lock:
            row = self._rows.get(action_id)
            if row is not None:
                row['status'] = status


def read_description(package: Path) -> str:
    """``description`` from package.json, read as JSON. Missing or unreadable is empty."""
    try:
        parsed = json.loads((package / 'package.json').read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return ''
    if not isinstance(parsed, dict):
        return ''
    description = parsed.get('description')
    return description.strip()[:400] if isinstance(description, str) else ''
