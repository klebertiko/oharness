"""Builds a factory definition directory on disk for the tests (ADR 0056 layout)."""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from factory_definition_files import FILES


@pytest.fixture()
def make_definition(tmp_path):
    """make_definition({path: text}): write the base definition; an entry replaces a file, None removes it."""
    def build(changes: dict[str, str | None] | None = None) -> Path:
        root = tmp_path / '.oharness' / 'factory'
        shutil.rmtree(root, ignore_errors=True)
        files = {**FILES, **(changes or {})}
        for rel, text in files.items():
            if text is None:
                continue
            target = root / rel
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(text.encode('utf-8'))
        return root
    return build
