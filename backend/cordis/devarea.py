"""The development area of creator mode (ADR 0071): `<plugins>/dev/<name>`, the only place the agent writes plugin files.

A path is relative to one package folder, uses `/`, has no empty, `.`, `..` or hidden part, no drive or `:`, and never goes
through a link or junction. Files and packages have size ceilings. Nothing here runs or installs code.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
from pathlib import Path

MAX_FILE_BYTES = 256 * 1024
MAX_FILES = 200
MAX_PACKAGE_BYTES = 2 * 1024 * 1024
KINDS = ('tool', 'command', 'service')
STARTERS = Path(__file__).resolve().parent / 'skill' / 'starters'

_NAME = re.compile(r'^[a-z][a-z0-9-]{0,63}$')
_PART = re.compile(r'^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$')
_RESERVED = frozenset({'con', 'prn', 'aux', 'nul', *(f'com{n}' for n in range(1, 10)), *(f'lpt{n}' for n in range(1, 10))})


class DevError(Exception):
    """A refused development-area action. `code` is stable; `message` never contains a local path."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code, self.message = code, message


def _is_link(path: Path) -> bool:
    return os.path.islink(path) or os.path.isjunction(path)


def _reserved(part: str) -> bool:
    return part.split('.', 1)[0].lower() in _RESERVED


class DevArea:
    def __init__(self, root: Path):
        self.root = root

    # -- paths -----------------------------------------------------------
    def _base(self) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        if _is_link(self.root):
            raise DevError('invalid_path', 'The development area is a link.')
        return self.root

    def path(self, name: str, *, must_exist: bool = True) -> Path:
        if not isinstance(name, str) or not _NAME.match(name) or _reserved(name):
            raise DevError('invalid_name', 'A package name is lowercase letters, digits and dashes, starting with a letter (at most 64).')
        package = self._base() / name
        if _is_link(package):
            raise DevError('invalid_path', 'The package folder is a link.')
        if must_exist and not package.is_dir():
            raise DevError('not_found', 'No package with that name in the development area; scaffold it first.')
        return package

    def _file(self, name: str, relative: str) -> Path:
        package = self.path(name)
        if not isinstance(relative, str) or not relative or len(relative) > 400 or any(c in relative for c in '\\:\0'):
            raise DevError('invalid_path', 'Give a relative path inside the package, with / between folders.')
        parts = relative.split('/')
        if any(not _PART.match(part) or _reserved(part) for part in parts):
            raise DevError('invalid_path', 'Give a relative path inside the package: no .., no hidden or empty part.')
        current = package
        for part in parts:
            current = current / part
            if _is_link(current):
                raise DevError('invalid_path', 'The path goes through a link.')
        if not current.resolve().is_relative_to(package.resolve()):
            raise DevError('invalid_path', 'The path leaves the package.')
        return current

    def _walk(self, package: Path) -> list[Path]:
        found: list[Path] = []
        for here, dirnames, filenames in os.walk(package, followlinks=False):
            dirnames[:] = sorted(d for d in dirnames if not _is_link(Path(here) / d))
            found.extend(Path(here) / f for f in sorted(filenames) if not _is_link(Path(here) / f))
        return found

    # -- reads -----------------------------------------------------------
    def files(self, name: str) -> list[str]:
        package = self.path(name)
        return [p.relative_to(package).as_posix() for p in self._walk(package)]

    def digest(self, name: str) -> str:
        package = self.path(name)
        total = hashlib.sha256()
        for file in self._walk(package):
            total.update(file.relative_to(package).as_posix().encode('utf8') + b'\0')
            total.update(hashlib.sha256(file.read_bytes()).digest())
        return total.hexdigest()

    def list(self) -> list[dict]:
        base = self._base()
        rows = []
        for child in sorted(base.iterdir()):
            if child.is_dir() and not _is_link(child) and _NAME.match(child.name):
                rows.append({'name': child.name, 'files': self.files(child.name), 'digest': self.digest(child.name)})
        return rows

    def read(self, name: str, relative: str) -> str:
        target = self._file(name, relative)
        if not target.is_file():
            raise DevError('not_found', 'No such file in the package.')
        if target.stat().st_size > MAX_FILE_BYTES:
            raise DevError('too_large', 'The file is larger than 256 KiB.')
        try:
            return target.read_bytes().decode('utf8')
        except UnicodeDecodeError:
            raise DevError('not_text', 'The file is not UTF-8 text.') from None

    # -- writes ----------------------------------------------------------
    def write(self, name: str, relative: str, content: str) -> dict:
        if not isinstance(content, str):
            raise DevError('invalid_content', 'content is text.')
        data = content.encode('utf8')
        if len(data) > MAX_FILE_BYTES:
            raise DevError('too_large', 'A file is at most 256 KiB.')
        target = self._file(name, relative)
        package = self.path(name)
        others = [p for p in self._walk(package) if p != target]
        if len(others) + 1 > MAX_FILES or sum(p.stat().st_size for p in others) + len(data) > MAX_PACKAGE_BYTES:
            raise DevError('too_large', 'The package would pass 200 files or 2 MiB.')
        if target.exists() and not target.is_file():
            raise DevError('invalid_path', 'That path is a folder.')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        return {'name': name, 'path': relative, 'bytes': len(data)}

    def scaffold(self, name: str, kind: str) -> dict:
        if kind not in KINDS:
            raise DevError('invalid_kind', 'kind is tool, command or service.')
        package = self.path(name, must_exist=False)
        if package.exists():
            raise DevError('exists', 'A package with that name already exists; edit it with write_file.')
        identifier = name.replace('-', '_')
        service = re.sub(r'-([a-z0-9])', lambda m: m[1].upper(), name)
        code = (STARTERS / f'{kind}.ts').read_text(encoding='utf8')
        code = code.replace('__NAME__', name).replace('__TOOL__', identifier).replace('__SERVICE__', service)
        manifest = {
            'name': name, 'version': '0.1.0', 'private': True, 'type': 'module', 'main': './index.ts',
            'description': f'A Cordis {kind} plugin.', 'oharness': {'runtime': 'isolated', 'capabilities': []},
        }
        package.mkdir()
        (package / 'package.json').write_bytes((json.dumps(manifest, indent=2) + '\n').encode('utf8'))
        (package / 'index.ts').write_bytes(code.encode('utf8'))
        return {'name': name, 'kind': kind, 'files': self.files(name)}
