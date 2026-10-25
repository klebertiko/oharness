"""Atomic JSON state for the Workspace Manager (managed-worktree registry and the selected workspace).

Deliberately not an ORM table: the ORM schema belongs to the persistence layer other work is changing, and this state is small,
local and rebuildable (the registry only *adds* information; git's own worktree list stays the source of truth for what exists).
Writes go to a temp file in the same directory and are swapped in with ``os.replace``, so a crash leaves the old file or the new
one, never half of one.
"""
from __future__ import annotations

import json
import logging
import os
import secrets
import threading
from pathlib import Path
from typing import Any, Callable, TypeVar

from .paths import valid_workspace_id

log = logging.getLogger(__name__)

T = TypeVar("T")
VERSION = 1
MAX_QUARANTINE = 50
_OPTIONAL_TEXT = ("branch", "base_ref", "base_commit", "created_at")
_LOCKS: dict[str, threading.RLock] = {}
_LOCKS_GUARD = threading.Lock()


def _empty() -> dict[str, Any]:
    return {"version": VERSION, "workspaces": {}, "selected": None}


def _lock_for(path: Path) -> threading.RLock:
    key = os.path.normcase(os.path.abspath(path))
    with _LOCKS_GUARD:
        return _LOCKS.setdefault(key, threading.RLock())


def _well_formed(state: Any) -> bool:
    return isinstance(state, dict) and state.get("version") == VERSION and isinstance(state.get("workspaces"), dict)


def _valid_record(ident: object, rec: object) -> bool:
    """A registry record is trusted only with this exact shape: the generated id it is filed under, an absolute path, text-or-null extras."""
    return (isinstance(rec, dict) and isinstance(ident, str) and rec.get("id") == ident and valid_workspace_id(ident)
            and isinstance(rec.get("path"), str) and bool(rec["path"]) and chr(0) not in rec["path"] and os.path.isabs(rec["path"])
            and all(rec.get(key) is None or isinstance(rec.get(key), str) for key in _OPTIONAL_TEXT))


def _valid_selection(chosen: object) -> bool:
    return isinstance(chosen, dict) and all(isinstance(chosen.get(key), str) and chosen[key] for key in ("repo", "repo_key", "id"))


def _sanitize(state: dict[str, Any]) -> dict[str, Any]:
    """Drop what cannot be trusted from a well-formed file, keeping the dropped parts under ``quarantine`` for inspection.

    The view is cleaned on every read; the file itself is only rewritten by the next mutation.
    """
    quarantined: list[dict[str, Any]] = []
    for key, group in list(state["workspaces"].items()):
        if not isinstance(group, dict):
            quarantined.append({"repo_key": key, "group": group})
            del state["workspaces"][key]
            continue
        for ident, rec in list(group.items()):
            if not _valid_record(ident, rec):
                quarantined.append({"repo_key": key, "id": ident, "record": rec})
                del group[ident]
    if state.get("selected") is not None and not _valid_selection(state["selected"]):  # of any type: only the selection is dropped
        quarantined.append({"selected": state["selected"]})
    if not _valid_selection(state.get("selected")):
        state["selected"] = None
    if quarantined:
        earlier = state.get("quarantine")
        state["quarantine"] = [*(earlier if isinstance(earlier, list) else []), *quarantined][-MAX_QUARANTINE:]
    return state


class StateStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._lock = _lock_for(self.path)

    def _load(self) -> dict[str, Any]:
        try:
            raw = self.path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return _empty()
        try:
            state = json.loads(raw)
        except ValueError:
            state = None
        if not _well_formed(state):
            self._set_aside()
            return _empty()
        return _sanitize(state)

    def _set_aside(self) -> None:
        """Keep an unreadable file for inspection instead of overwriting or deleting it."""
        try:
            os.replace(self.path, self.path.with_name(f"{self.path.name}.corrupt-{secrets.token_hex(3)}"))
        except OSError as exc:  # the file stays where it is and is rewritten by the next mutation; nothing else can be done here
            log.warning("could not set aside the unreadable workspace state file: %s", exc)

    def _write(self, state: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_name(f"{self.path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
        try:
            with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
                json.dump(state, handle, indent=2, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, self.path)
        except BaseException:
            try:
                tmp.unlink()
            except OSError as exc:  # the original error is what matters; a stray temp file is harmless
                log.debug("could not remove temporary state file %s: %s", tmp, exc)
            raise

    def read(self) -> dict[str, Any]:
        with self._lock:
            return self._load()

    def mutate(self, change: Callable[[dict[str, Any]], T]) -> T:
        """Load, apply ``change`` to the state, write it back. If ``change`` raises, nothing is written."""
        with self._lock:
            state = self._load()
            result = change(state)
            self._write(state)
            return result
