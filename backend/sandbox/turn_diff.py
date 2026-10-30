"""Per-turn file diff and per-file revert (#163).

A turn's edits are found by comparing two bounded snapshots of the workspace,
one before the turn and one after, so it covers commands run through the
broker and edits made by a provider's own CLI alike. Symlinks and junctions
are never followed or tracked; files whose names look like secrets are never
read or stored; binary and oversized files are listed but cannot be reverted
(only an added file of any kind can, by deleting it).
"""
import difflib
import hashlib
import os
import uuid
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath, PureWindowsPath

from .secrets import requires_approval

TURN_DIFF_RULES = {
    'max_files_scanned': 5000,
    'max_file_bytes': 262144,
    'max_total_bytes': 33554432,
    'max_listed_files': 100,
    'max_diff_chars': 20000,
    'ignored_dirs': ['.git', 'node_modules', '.venv', 'venv', '__pycache__', 'target', 'dist', 'build', '.next'],
}


class RevertRefused(Exception):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass
class Entry:
    kind: str  # text | binary | large
    sha: str
    data: bytes | None = None  # kept only for text
    mode: int = 0o644


@dataclass
class Snapshot:
    entries: dict = field(default_factory=dict)
    complete: bool = True


@dataclass
class Change:
    path: str
    status: str  # added | modified | deleted
    binary: bool = False
    added: int = 0
    removed: int = 0
    diff: str = ''
    diff_truncated: bool = False
    revertible: bool = False
    before: bytes | None = None
    before_mode: int = 0o644
    after_sha: str | None = None


def _is_link(path: str) -> bool:
    return os.path.islink(path) or (hasattr(os.path, 'isjunction') and os.path.isjunction(path))


def _classify(path: str, size: int, mtime_ns: int, keep_text: bool = True):
    """`(kind, sha, data)` for one regular file. The same function backs revert's safety check."""
    if size > TURN_DIFF_RULES['max_file_bytes']:
        return 'large', f'stat:{size}:{mtime_ns}', None
    with open(path, 'rb') as handle:
        data = handle.read(TURN_DIFF_RULES['max_file_bytes'] + 1)
    digest = hashlib.sha256(data).hexdigest()
    if b'\x00' in data[:8192]:
        return 'binary', digest, None
    try:
        data.decode('utf-8')
    except UnicodeDecodeError:
        return 'binary', digest, None
    return 'text', digest, data if keep_text else None


def snapshot(root) -> Snapshot:
    base = str(Path(root).resolve())
    snap, total, scanned = Snapshot(), 0, 0
    ignored = set(TURN_DIFF_RULES['ignored_dirs'])
    stack = [base]
    while stack:
        directory = stack.pop()
        try:
            with os.scandir(directory) as it:
                children = list(it)
        except OSError:
            continue
        for child in children:
            if _is_link(child.path):
                continue
            try:
                if child.is_dir(follow_symlinks=False):
                    if child.name not in ignored:
                        stack.append(child.path)
                    continue
                if not child.is_file(follow_symlinks=False):
                    continue
                rel = os.path.relpath(child.path, base).replace(os.sep, '/')
                if requires_approval(Path(rel)):
                    continue
                if any(ch in rel.replace('/', '') for ch in ':\\') or any(ord(ch) < 32 for ch in rel):
                    continue  # names revert cannot address safely are not tracked
                scanned += 1
                if scanned > TURN_DIFF_RULES['max_files_scanned']:
                    snap.complete = False
                    return snap
                stat = child.stat(follow_symlinks=False)
                kind, sha, data = _classify(child.path, stat.st_size, stat.st_mtime_ns)
                if kind == 'text':
                    total += len(data)
                    if total > TURN_DIFF_RULES['max_total_bytes']:
                        snap.complete = False
                        data = None
                        kind = 'large'
                snap.entries[rel] = Entry(kind, sha, data, stat.st_mode & 0o7777)
            except OSError:
                continue
    return snap


def _diff(old: bytes | None, new: bytes | None):
    a = (old or b'').decode('utf-8', 'replace').splitlines(keepends=True)
    b = (new or b'').decode('utf-8', 'replace').splitlines(keepends=True)
    lines = list(difflib.unified_diff(a, b, 'before', 'after', n=2))
    body = lines[2:]  # the two header lines come first; a content line may itself start with '++' or '--'
    added = sum(1 for l in body if l.startswith('+'))
    removed = sum(1 for l in body if l.startswith('-'))
    text = ''.join(l if l.endswith('\n') else l + '\n' for l in lines)
    limit = TURN_DIFF_RULES['max_diff_chars']
    return added, removed, text[:limit], len(text) > limit


def compute_changes(before: Snapshot, after: Snapshot) -> list:
    out = []
    for path in sorted(set(before.entries) | set(after.entries)):
        old, new = before.entries.get(path), after.entries.get(path)
        if old and new and old.sha == new.sha:
            continue
        status = 'added' if old is None else 'deleted' if new is None else 'modified'
        change = Change(path=path, status=status, after_sha=new.sha if new else None)
        change.binary = any(e is not None and e.kind != 'text' for e in (old, new))
        if not change.binary:
            change.added, change.removed, change.diff, change.diff_truncated = _diff(old and old.data, new and new.data)
        change.before = old.data if old and old.kind == 'text' else None
        change.before_mode = old.mode if old else 0o644
        # Past a scan limit "added"/"deleted" may just mean "outside the window": never offer a delete then.
        reliable = before.complete and after.complete
        change.revertible = (status == 'added' and reliable) or (change.before is not None and (status == 'modified' or reliable))
        out.append(change)
    return out


def _split(rel) -> list:
    if not isinstance(rel, str) or not rel or '\0' in rel:
        raise RevertRefused('path_escapes_root')
    win = PureWindowsPath(rel)
    if (os.path.isabs(rel) or win.drive or win.is_absolute() or rel.startswith(('/', '\\'))
            or any(':' in part for part in win.parts)):
        raise RevertRefused('path_escapes_root')
    parts = [p for p in rel.replace('\\', '/').split('/')]
    if any(p in ('', '.', '..') for p in parts) or PurePosixPath(rel.replace('\\', '/')).is_absolute():
        raise RevertRefused('path_escapes_root')
    return parts


def revert_file(root, rel, status, before, after_sha, mode=0o644) -> None:
    """Restore one file to its pre-turn state. Never touches another path.

    Refuses: paths that leave the workspace, any symlink/junction on the way,
    a file that changed after the turn (so later edits are never clobbered),
    and files whose old content was not stored (binary, oversized).
    """
    parts = _split(rel)
    base = Path(root).resolve()
    if not base.is_dir():
        raise RevertRefused('workspace_gone')
    current = base
    for index, part in enumerate(parts):
        current = current / part
        if _is_link(str(current)):
            raise RevertRefused('symlink_refused')
        if not os.path.lexists(current):
            break
        if index < len(parts) - 1 and not current.is_dir():
            raise RevertRefused('not_a_file')
    target = base.joinpath(*parts)
    exists = os.path.lexists(target)
    if exists and not target.is_file():
        raise RevertRefused('not_a_file')
    if status == 'deleted':
        if exists:
            raise RevertRefused('changed_since')
    else:
        if not exists:
            raise RevertRefused('changed_since')
        stat = target.stat()
        if _classify(str(target), stat.st_size, stat.st_mtime_ns, keep_text=False)[1] != after_sha:
            raise RevertRefused('changed_since')
    if status == 'added':
        target.unlink()
        return
    if before is None:
        raise RevertRefused('not_revertible')
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.parent.resolve() != (base.joinpath(*parts[:-1]) if parts[:-1] else base):
        raise RevertRefused('symlink_refused')
    temp = target.with_name(f'.{target.name}.oh-revert-{uuid.uuid4().hex}')
    try:
        with open(temp, 'xb') as handle:
            handle.write(before)
        os.chmod(temp, (target.stat().st_mode if exists else mode) & 0o7777)
        os.replace(temp, target)
    finally:
        if os.path.lexists(temp):
            temp.unlink()
