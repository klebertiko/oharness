"""SecretsStore protocol — MemorySecrets + FileSecrets roundtrips."""

from __future__ import annotations

import base64
import getpass
import hashlib
import logging
import os
import subprocess
from pathlib import Path

import pytest
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from secret_store import file_store
from secret_store.base import SecretsStore
from secret_store.file_store import (
    FILE_STORE_KEYCHAIN_SERVICE,
    INSTALL_KEY_NAME,
    STORE_ID_NAME,
    FileSecrets,
    _filename_for_ref,
)
from secret_store.memory import MemorySecrets
from security import sidecar_token


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


def _path_derived_fernet(root: Path) -> Fernet:
    """The pre-fix derivation: the Fernet key is only the absolute store path.

    Kept in the test, not imported, so a migration that forgets the old
    inputs cannot decrypt a fixture this helper wrote.
    """
    material = str(root.resolve()).encode("utf-8")
    salt = hashlib.sha256(b"openharness.file-secrets.v1:" + material).digest()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390_000,
    )
    return Fernet(base64.urlsafe_b64encode(kdf.derive(material)))


def test_secret_bytes_hit_the_vault_path_only_after_restrict(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Create is already owner-only, and restrict runs before any secret bytes.

    A permissive umask must not leave a window: the mode argument of mkdir/open
    is 0700/0600, which umask can only narrow. Restrict then sees that mode,
    and the plaintext is not in the file yet.
    """
    real = sidecar_token.restrict_to_current_user
    seen = {"files": 0, "dirs": 0, "plain": False}

    def spy(path: Path) -> bool:
        if path.is_file():
            seen["files"] += 1
            if SECRET_VALUE.encode() in path.read_bytes():
                seen["plain"] = True
            if os.name != "nt":
                assert path.stat().st_mode & 0o777 == 0o600
                assert path.parent.stat().st_mode & 0o777 == 0o700
        elif path.is_dir():
            seen["dirs"] += 1
        return real(path)

    monkeypatch.setattr(sidecar_token, "restrict_to_current_user", spy)
    if hasattr(file_store, "restrict_to_current_user"):
        monkeypatch.setattr(file_store, "restrict_to_current_user", spy)
    parent_mode = tmp_path.stat().st_mode
    vault = tmp_path / "vault"
    old = os.umask(0)
    try:
        FileSecrets(vault).put(SECRET_REF, SECRET_VALUE)
    finally:
        os.umask(old)
    assert seen["files"] >= 1
    assert seen["plain"] is False
    assert tmp_path.stat().st_mode == parent_mode
    if os.name != "nt":
        assert vault.stat().st_mode & 0o777 == 0o700
        files = [path for path in vault.iterdir() if path.is_file()]
        assert files
        assert all(path.stat().st_mode & 0o777 == 0o600 for path in files)
    else:
        assert seen["dirs"] >= 1


def test_new_ciphertext_is_not_decryptable_from_the_store_path(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    FileSecrets(vault).put(SECRET_REF, SECRET_VALUE)
    blob = next(vault.glob("*.bin")).read_bytes()
    with pytest.raises(InvalidToken):
        _path_derived_fernet(vault).decrypt(blob)


def test_legacy_path_derived_files_migrate_without_losing_secrets(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    os.chmod(vault, 0o755)
    legacy = _path_derived_fernet(vault)
    other_ref = "oharness/other-provider"
    first = vault / _filename_for_ref(SECRET_REF)
    second = vault / _filename_for_ref(other_ref)
    first.write_bytes(legacy.encrypt(SECRET_VALUE.encode()))
    second.write_bytes(legacy.encrypt(b"second-value"))
    os.chmod(first, 0o644)
    os.chmod(second, 0o644)
    note = vault / "notes.txt"
    note.write_bytes(b"leave-me")
    store = FileSecrets(vault)
    assert store.get(SECRET_REF) == SECRET_VALUE
    assert store.get(other_ref) == "second-value"
    assert note.read_bytes() == b"leave-me"
    for path in (first, second):
        with pytest.raises(InvalidToken):
            legacy.decrypt(path.read_bytes())
    if os.name != "nt":
        assert vault.stat().st_mode & 0o777 == 0o700
        assert first.stat().st_mode & 0o777 == 0o600
        assert second.stat().st_mode & 0o777 == 0o600
    migrated = first.read_bytes()
    again = FileSecrets(vault)
    assert again.get(SECRET_REF) == SECRET_VALUE
    assert again.get(other_ref) == "second-value"
    assert first.read_bytes() == migrated


def test_an_undecryptable_blob_is_left_in_place(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    blob = vault / _filename_for_ref(SECRET_REF)
    blob.write_bytes(b"not-a-token")
    store = FileSecrets(vault, use_keychain=False)
    assert store.get(SECRET_REF) is None
    assert store.exists(SECRET_REF) is True
    assert blob.read_bytes() == b"not-a-token"


def test_without_a_keychain_the_install_secret_is_a_user_only_file(tmp_path: Path) -> None:
    """The documented limitation: no keychain, the key is a file beside the ciphertext."""
    vault = tmp_path / "vault"
    FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    key = vault / INSTALL_KEY_NAME
    assert key.is_file()
    ciphertext = next(vault.glob("*.bin")).read_bytes()
    assert key.read_bytes() not in ciphertext
    assert SECRET_VALUE.encode() not in key.read_bytes()
    if os.name != "nt":
        assert key.stat().st_mode & 0o777 == 0o600


def test_two_vaults_do_not_share_an_install_secret(tmp_path: Path) -> None:
    source = tmp_path / "source"
    other = tmp_path / "other"
    FileSecrets(source, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    blob = next(source.glob("*.bin"))
    other.mkdir()
    (other / blob.name).write_bytes(blob.read_bytes())
    assert FileSecrets(other, use_keychain=False).get(SECRET_REF) is None


def test_no_secret_is_written_when_restrict_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_store, "restrict_to_current_user", lambda path: False)
    vault = tmp_path / "vault"
    with pytest.raises(OSError):
        FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    assert vault.is_dir()
    assert list(vault.glob("*.bin")) == []
    assert not (vault / INSTALL_KEY_NAME).exists()
    for path in vault.rglob("*"):
        if path.is_file():
            assert SECRET_VALUE.encode() not in path.read_bytes()


def test_a_linked_secret_file_is_not_written_through(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"keep")
    store = FileSecrets(vault, use_keychain=False)
    link = vault / _filename_for_ref(SECRET_REF)
    try:
        link.symlink_to(outside)
    except (OSError, NotImplementedError):
        pytest.skip("symbolic links are not available here")
    with pytest.raises(OSError):
        store.put(SECRET_REF, SECRET_VALUE)
    assert outside.read_bytes() == b"keep"


class _FakeKeyring:
    def __init__(self) -> None:
        self._data: dict[tuple[str, str], str] = {}

    def get_password(self, service: str, username: str) -> str | None:
        return self._data.get((service, username))

    def set_password(self, service: str, username: str, password: str) -> None:
        self._data[(service, username)] = password

    def delete_password(self, service: str, username: str) -> None:
        self._data.pop((service, username), None)


class _BrokenKeyring:
    def get_password(self, service: str, username: str) -> str | None:
        raise RuntimeError("keychain down")

    def set_password(self, service: str, username: str, password: str) -> None:
        raise RuntimeError("keychain down")

    def delete_password(self, service: str, username: str) -> None:
        raise RuntimeError("keychain down")


def test_install_secret_is_kept_in_the_keychain_when_a_backend_is_given(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    keyring = _FakeKeyring()
    FileSecrets(vault, keyring_backend=keyring).put(SECRET_REF, SECRET_VALUE)
    assert not (vault / INSTALL_KEY_NAME).exists()
    store_id = (vault / STORE_ID_NAME).read_text(encoding="ascii")
    assert keyring.get_password(FILE_STORE_KEYCHAIN_SERVICE, store_id)
    assert FileSecrets(vault, keyring_backend=keyring).get(SECRET_REF) == SECRET_VALUE
    blob = next(vault.glob("*.bin")).read_bytes()
    with pytest.raises(OSError):
        FileSecrets(vault, use_keychain=False)
    assert next(vault.glob("*.bin")).read_bytes() == blob
    assert FileSecrets(vault, keyring_backend=keyring).get(SECRET_REF) == SECRET_VALUE


def test_a_different_keychain_does_not_replace_the_ciphertext(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    FileSecrets(vault, keyring_backend=_FakeKeyring()).put(SECRET_REF, SECRET_VALUE)
    blob = next(vault.glob("*.bin")).read_bytes()
    with pytest.raises(OSError):
        FileSecrets(vault, keyring_backend=_FakeKeyring())
    assert next(vault.glob("*.bin")).read_bytes() == blob


def test_file_install_secret_moves_to_the_keychain_without_losing_secrets(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    key = (vault / INSTALL_KEY_NAME).read_bytes()
    keyring = _FakeKeyring()
    assert FileSecrets(vault, keyring_backend=keyring).get(SECRET_REF) == SECRET_VALUE
    assert not (vault / INSTALL_KEY_NAME).exists()
    store_id = (vault / STORE_ID_NAME).read_text(encoding="ascii")
    assert keyring.get_password(FILE_STORE_KEYCHAIN_SERVICE, store_id) == key.decode("ascii")
    assert FileSecrets(vault, keyring_backend=keyring).get(SECRET_REF) == SECRET_VALUE


def test_a_broken_keychain_keeps_the_file_key(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    assert FileSecrets(vault, keyring_backend=_BrokenKeyring()).get(SECRET_REF) == SECRET_VALUE
    assert (vault / INSTALL_KEY_NAME).is_file()


def test_an_available_keyring_receives_the_install_secret(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    keyring = _FakeKeyring()
    monkeypatch.setattr(file_store, "_load_keyring", lambda: keyring)
    vault = tmp_path / "vault"
    FileSecrets(vault).put(SECRET_REF, SECRET_VALUE)
    assert not (vault / INSTALL_KEY_NAME).exists()
    assert FileSecrets(vault).get(SECRET_REF) == SECRET_VALUE


def test_use_keychain_false_does_not_consult_keyring(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    def boom() -> None:
        raise AssertionError("keyring consulted")

    monkeypatch.setattr(file_store, "_load_keyring", boom)
    FileSecrets(tmp_path, use_keychain=False).put(SECRET_REF, SECRET_VALUE)


@pytest.mark.skipif(os.name != "nt", reason="reads the Windows ACL")
def test_vault_path_acl_is_limited_to_the_current_user(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    for path in [vault, *[entry for entry in vault.iterdir() if entry.is_file()]]:
        listing = subprocess.run(  # nosemgrep: opengrep-rules.python.lang.security.audit.dangerous-subprocess-use-audit
            ["icacls", str(path)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout
        entries = [line.strip() for line in listing.splitlines()[:-2] if "(" in line]
        names = " ".join(entries).lower()
        assert getpass.getuser().lower() in names
        assert not any(
            word in names
            for word in ("everyone", "builtin" + chr(92) + "users", "authenticated users", "(i)")
        )
