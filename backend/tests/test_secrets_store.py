"""SecretsStore protocol — MemorySecrets + FileSecrets roundtrips."""

from __future__ import annotations

import logging
from pathlib import Path

import pytest

from secret_store.base import SecretsStore
from secret_store.file_store import FileSecrets
from secret_store.memory import MemorySecrets


SECRET_VALUE = "sk-test-NEVER-LOG-THIS-VALUE-9f3a"
SECRET_REF = "oharness/test-provider"


def _assert_roundtrip(store: SecretsStore) -> None:
    assert store.exists(SECRET_REF) is False
    store.put(SECRET_REF, SECRET_VALUE)
    assert store.exists(SECRET_REF) is True
    assert store.get(SECRET_REF) == SECRET_VALUE
    store.delete(SECRET_REF)
    assert store.exists(SECRET_REF) is False
    assert store.get(SECRET_REF) is None


def test_memory_secrets_roundtrip() -> None:
    _assert_roundtrip(MemorySecrets())


def test_file_secrets_roundtrip(tmp_path: Path) -> None:
    _assert_roundtrip(FileSecrets(tmp_path))


def test_file_secrets_persists_across_instances(tmp_path: Path) -> None:
    a = FileSecrets(tmp_path)
    a.put(SECRET_REF, SECRET_VALUE)
    b = FileSecrets(tmp_path)
    assert b.get(SECRET_REF) == SECRET_VALUE
    assert b.exists(SECRET_REF) is True


def test_file_secrets_ciphertext_not_plaintext_on_disk(tmp_path: Path) -> None:
    FileSecrets(tmp_path).put(SECRET_REF, SECRET_VALUE)
    blobs = list(tmp_path.rglob("*"))
    assert blobs, "expected at least one written file"
    for path in blobs:
        if path.is_file():
            raw = path.read_bytes()
            assert SECRET_VALUE.encode() not in raw


def test_put_overwrite(tmp_path: Path) -> None:
    store = FileSecrets(tmp_path)
    store.put(SECRET_REF, "first")
    store.put(SECRET_REF, "second")
    assert store.get(SECRET_REF) == "second"


def test_never_logs_secret_values(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    for store in (MemorySecrets(), FileSecrets(tmp_path)):
        store.put(SECRET_REF, SECRET_VALUE)
        store.get(SECRET_REF)
        store.exists(SECRET_REF)
        store.delete(SECRET_REF)
    joined = "\n".join(r.getMessage() for r in caplog.records)
    assert SECRET_VALUE not in joined
