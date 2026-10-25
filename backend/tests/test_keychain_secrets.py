"""KeychainSecrets + OH_SECRETS factory — mock keyring; optional real keyring."""

from __future__ import annotations

import importlib.util

import pytest

from secret_store.factory import build_secrets_store
from secret_store.file_store import FileSecrets
from secret_store.keychain import KeychainSecrets
from secret_store.memory import MemorySecrets


SECRET_VALUE = "sk-test-NEVER-LOG-THIS-VALUE-9f3a"
SECRET_REF = "oharness/test-provider"


class FakeKeyring:
    """In-memory stand-in for the ``keyring`` module API."""

    def __init__(self) -> None:
        self._data: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self._data.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self._data[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        key = (service, username)
        if key not in self._data:
            raise KeyError(f"missing {service}/{username}")
        del self._data[key]


def test_keychain_secrets_roundtrip_with_mock() -> None:
    store = KeychainSecrets(backend=FakeKeyring())
    assert store.exists(SECRET_REF) is False
    store.put(SECRET_REF, SECRET_VALUE)
    assert store.exists(SECRET_REF) is True
    assert store.get(SECRET_REF) == SECRET_VALUE
    store.delete(SECRET_REF)
    assert store.exists(SECRET_REF) is False
    assert store.get(SECRET_REF) is None


def test_keychain_delete_missing_is_noop() -> None:
    store = KeychainSecrets(backend=FakeKeyring())
    store.delete(SECRET_REF)  # must not raise


def test_keychain_repr_hides_values() -> None:
    store = KeychainSecrets(backend=FakeKeyring())
    store.put(SECRET_REF, SECRET_VALUE)
    assert SECRET_VALUE not in repr(store)


def test_build_secrets_store_memory() -> None:
    assert isinstance(build_secrets_store("memory"), MemorySecrets)


def test_build_secrets_store_file(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OH_SECRETS_DIR", str(tmp_path))
    store = build_secrets_store("file")
    assert isinstance(store, FileSecrets)
    store.put(SECRET_REF, SECRET_VALUE)
    assert store.get(SECRET_REF) == SECRET_VALUE


def test_build_secrets_store_keychain_uses_keychain_type(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake = FakeKeyring()

    def _fake_default():
        return fake

    monkeypatch.setattr("secret_store.keychain._default_keyring", _fake_default)
    store = build_secrets_store("keychain")
    assert isinstance(store, KeychainSecrets)
    store.put(SECRET_REF, SECRET_VALUE)
    assert store.get(SECRET_REF) == SECRET_VALUE


def test_build_secrets_store_unknown_raises() -> None:
    with pytest.raises(ValueError, match="Unknown OH_SECRETS"):
        build_secrets_store("vault")


def test_build_secrets_store_reads_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OH_SECRETS", "memory")
    assert isinstance(build_secrets_store(), MemorySecrets)


@pytest.mark.skipif(
    importlib.util.find_spec("keyring") is None,
    reason="optional keyring package not installed",
)
def test_keychain_integration_optional_real_backend() -> None:
    """Live OS keychain smoke — skipped on CI without keyring."""
    store = KeychainSecrets()
    ref = "oharness/ci-skip-integration-probe"
    try:
        store.put(ref, "probe-value")
        assert store.get(ref) == "probe-value"
    finally:
        store.delete(ref)


def test_keychain_migrates_pre_rebrand_service_on_first_get() -> None:
    kr = FakeKeyring()
    kr.set_password(KeychainSecrets.LEGACY_SERVICE, SECRET_REF, SECRET_VALUE)
    store = KeychainSecrets(backend=kr)
    assert store.get(SECRET_REF) == SECRET_VALUE
    assert kr.get_password(KeychainSecrets.SERVICE, SECRET_REF) == SECRET_VALUE
    assert kr.get_password(KeychainSecrets.LEGACY_SERVICE, SECRET_REF) is None


def test_file_store_default_root_keeps_pre_rebrand_dir_when_only_it_exists(
    tmp_path, monkeypatch
) -> None:
    from secret_store.factory import _default_file_root

    monkeypatch.delenv("OH_SECRETS_DIR", raising=False)
    monkeypatch.setattr("pathlib.Path.home", lambda: tmp_path)
    assert _default_file_root() == tmp_path / ".oharness" / "secrets"
    (tmp_path / ".openharness" / "secrets").mkdir(parents=True)
    assert _default_file_root() == tmp_path / ".openharness" / "secrets"
    (tmp_path / ".oharness" / "secrets").mkdir(parents=True)
    assert _default_file_root() == tmp_path / ".oharness" / "secrets"
