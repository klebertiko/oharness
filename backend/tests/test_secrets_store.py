"""SecretsStore protocol — MemorySecrets + FileSecrets roundtrips."""

from __future__ import annotations

import base64
import getpass
import hashlib
import logging
import os
import stat
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

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
    is 0700/0600, which umask can only narrow. On POSIX the open descriptor is
    restricted with fchmod; on Windows the ACL is set on the staged file. Either
    way the file is still empty when the restriction lands.
    """
    real = sidecar_token.restrict_to_current_user
    seen = {"files": 0, "dirs": 0, "plain": False}
    first_sizes: dict[Path, int] = {}
    writes: list[tuple[int, int]] = []
    real_write = file_store._write_all

    def spy(path: Path) -> bool:
        if path.is_file():
            seen["files"] += 1
            # Ciphertext never contains the plaintext, so "no SECRET_VALUE"
            # cannot catch a write that ran before restrict. Size can: the
            # first restrict of every file must see it still empty.
            first_sizes.setdefault(path, path.stat().st_size)
            if SECRET_VALUE.encode() in path.read_bytes():
                seen["plain"] = True
        elif path.is_dir():
            seen["dirs"] += 1
        return real(path)

    def write_spy(fd: int, data: bytes) -> None:
        info = os.fstat(fd)
        writes.append((info.st_size, stat.S_IMODE(info.st_mode)))
        real_write(fd, data)

    monkeypatch.setattr(sidecar_token, "restrict_to_current_user", spy)
    monkeypatch.setattr(file_store, "restrict_to_current_user", spy)
    monkeypatch.setattr(file_store, "_write_all", write_spy)
    parent_mode = tmp_path.stat().st_mode
    vault = tmp_path / "vault"
    old = os.umask(0)
    try:
        FileSecrets(vault).put(SECRET_REF, SECRET_VALUE)
    finally:
        os.umask(old)
    assert writes
    assert all(size == 0 for size, _ in writes), writes  # restricted before the first secret byte
    assert seen["plain"] is False
    assert tmp_path.stat().st_mode == parent_mode
    if os.name != "nt":
        assert all(mode == 0o600 for _, mode in writes), writes
        assert vault.stat().st_mode & 0o777 == 0o700
        files = [path for path in vault.iterdir() if path.is_file()]
        assert files
        assert all(path.stat().st_mode & 0o777 == 0o600 for path in files)
    else:
        assert seen["dirs"] >= 1
        assert seen["files"] >= 1
        assert first_sizes
        assert all(size == 0 for size in first_sizes.values()), first_sizes


def test_new_ciphertext_is_not_decryptable_from_the_store_path(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    FileSecrets(vault).put(SECRET_REF, SECRET_VALUE)
    blob = next(vault.glob("*.bin")).read_bytes()
    with pytest.raises(InvalidToken):
        _path_derived_fernet(vault).decrypt(blob)


def test_legacy_path_derived_files_migrate_without_losing_secrets(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    legacy_umask = os.umask(0o022)  # the pre-fix create: directory 0755, files 0644
    try:
        vault.mkdir()
        legacy = _path_derived_fernet(vault)
        other_ref = "oharness/other-provider"
        first = vault / _filename_for_ref(SECRET_REF)
        second = vault / _filename_for_ref(other_ref)
        first.write_bytes(legacy.encrypt(SECRET_VALUE.encode()))
        second.write_bytes(legacy.encrypt(b"second-value"))
    finally:
        os.umask(legacy_umask)
    if os.name != "nt":
        assert vault.stat().st_mode & 0o777 == 0o755
        assert first.stat().st_mode & 0o777 == 0o644
        assert second.stat().st_mode & 0o777 == 0o644
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


@pytest.mark.skipif(os.name == "nt", reason="POSIX directory mode and owner; Windows uses the ACL")
def test_a_link_in_place_of_the_vault_directory_is_refused(tmp_path: Path) -> None:
    """A link swapped in for the vault must not have its target chmodded or used."""
    target = tmp_path / "elsewhere"
    target.mkdir(mode=0o755)
    vault = tmp_path / "vault"
    vault.symlink_to(target, target_is_directory=True)
    with pytest.raises(OSError, match="link or not a directory"):
        FileSecrets(vault, use_keychain=False)
    assert target.stat().st_mode & 0o777 == 0o755
    assert list(target.iterdir()) == []


@pytest.mark.skipif(os.name == "nt", reason="POSIX directory mode and owner; Windows uses the ACL")
def test_a_vault_directory_owned_by_another_user_is_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"
    vault.mkdir(mode=0o755)
    real_euid = os.geteuid()
    monkeypatch.setattr(file_store.os, "geteuid", lambda: real_euid + 1)
    with pytest.raises(OSError, match="belongs to another user"):
        FileSecrets(vault, use_keychain=False)
    assert vault.stat().st_mode & 0o777 == 0o755
    assert list(vault.iterdir()) == []


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


def test_a_concurrent_first_open_keeps_the_winning_key_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Two processes open a new vault: the one that loses the create reads the winner's key.

    The competitor writes its key between our "no key yet" read and our create.
    Overwriting it would leave the competitor with a key that is no longer on disk.
    """
    vault = tmp_path / "vault"
    winner = Fernet.generate_key()
    real_new = file_store._new_install_secret

    def racing_new() -> bytes:
        (vault / INSTALL_KEY_NAME).write_bytes(winner)
        return real_new()

    monkeypatch.setattr(file_store, "_new_install_secret", racing_new)
    loser = FileSecrets(vault, use_keychain=False)
    monkeypatch.setattr(file_store, "_new_install_secret", real_new)
    assert (vault / INSTALL_KEY_NAME).read_bytes() == winner
    loser.put(SECRET_REF, SECRET_VALUE)
    assert FileSecrets(vault, use_keychain=False).get(SECRET_REF) == SECRET_VALUE


def test_a_concurrent_first_open_keeps_the_winning_store_id(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Same race with a keychain: the loser adopts the winner's store id and keychain secret."""
    vault = tmp_path / "vault"
    keyring = _FakeKeyring()
    winner_id = "winner-store-id"
    real_new = file_store._new_install_secret

    def racing_new() -> bytes:
        winner_secret = real_new()
        keyring.set_password(FILE_STORE_KEYCHAIN_SERVICE, winner_id, winner_secret.decode("ascii"))
        (vault / STORE_ID_NAME).write_text(winner_id, encoding="ascii")
        return real_new()

    monkeypatch.setattr(file_store, "_new_install_secret", racing_new)
    loser = FileSecrets(vault, keyring_backend=keyring)
    monkeypatch.setattr(file_store, "_new_install_secret", real_new)
    assert (vault / STORE_ID_NAME).read_text(encoding="ascii") == winner_id
    loser.put(SECRET_REF, SECRET_VALUE)
    assert FileSecrets(vault, keyring_backend=keyring).get(SECRET_REF) == SECRET_VALUE


def test_two_vaults_do_not_share_an_install_secret(tmp_path: Path) -> None:
    source = tmp_path / "source"
    other = tmp_path / "other"
    FileSecrets(source, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    blob = next(source.glob("*.bin"))
    other.mkdir()
    (other / blob.name).write_bytes(blob.read_bytes())
    assert FileSecrets(other, use_keychain=False).get(SECRET_REF) is None


def _boom_fchmod(fd: int, mode: int) -> None:
    raise OSError("fchmod refused")


def _break_file_restriction(monkeypatch: pytest.MonkeyPatch) -> None:
    """Make restricting a staged file fail: fchmod on POSIX, the ACL helper on Windows."""
    if os.name != "nt":
        monkeypatch.setattr(file_store.os, "fchmod", _boom_fchmod)
    else:
        monkeypatch.setattr(file_store, "restrict_to_current_user", lambda path: False)


def test_no_secret_is_written_when_restrict_fails(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"
    store = FileSecrets(vault, use_keychain=False)
    _break_file_restriction(monkeypatch)
    with pytest.raises(OSError):
        store.put(SECRET_REF, SECRET_VALUE)
    assert list(vault.glob("*.bin")) == []
    assert [p.name for p in vault.iterdir() if p.name.endswith(".tmp")] == []  # no staged file left behind
    for path in vault.rglob("*"):
        if path.is_file():
            assert SECRET_VALUE.encode() not in path.read_bytes()


def test_a_first_open_fails_closed_when_the_key_file_cannot_be_restricted(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    monkeypatch.setattr(file_store, "_restrict_directory", lambda path: True)  # isolate the file step
    _break_file_restriction(monkeypatch)
    with pytest.raises(OSError):
        FileSecrets(vault, use_keychain=False)
    assert list(vault.iterdir()) == []


def test_a_failed_directory_restriction_is_refused(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The directory step fails closed: fchmod on POSIX, the ACL helper on Windows."""
    vault = tmp_path / "vault"
    _break_file_restriction(monkeypatch)
    with pytest.raises(OSError, match="could not restrict the secrets directory"):
        FileSecrets(vault, use_keychain=False)
    assert list(vault.iterdir()) == []


def test_the_windows_vault_directory_must_not_be_a_link(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A junction or symlink for the vault would aim icacls (and every write) at its target."""
    vault = tmp_path / "vault"
    vault.mkdir()
    restricted: list[Path] = []
    monkeypatch.setattr(file_store.platform, "system", lambda: "Windows")
    monkeypatch.setattr(file_store, "_is_link", lambda path: path == vault)
    monkeypatch.setattr(file_store, "restrict_to_current_user", lambda path: restricted.append(path) or True)
    with pytest.raises(OSError, match="link or not a directory"):
        FileSecrets(vault, use_keychain=False)
    assert restricted == []
    assert list(vault.iterdir()) == []


def _icacls_calls(monkeypatch: pytest.MonkeyPatch, target: Path) -> list[list[str]]:
    calls: list[list[str]] = []
    monkeypatch.setattr(sidecar_token.platform, "system", lambda: "Windows")
    monkeypatch.setattr(sidecar_token.getpass, "getuser", lambda: "someone")
    monkeypatch.delenv("USERNAME", raising=False)

    def fake_run(argv: list[str], **kwargs: object) -> SimpleNamespace:
        calls.append(list(argv))
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(sidecar_token.subprocess, "run", fake_run)
    assert sidecar_token.restrict_to_current_user(target) is True
    return calls


@pytest.mark.parametrize("as_directory", [True, False])
def test_windows_restrict_resets_the_acl_so_foreign_explicit_aces_go(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, as_directory: bool
) -> None:
    """``/grant:r`` leaves other principals' explicit ACEs alone: reset first, then cut inheritance."""
    target = tmp_path / "t"
    if as_directory:
        target.mkdir()
    else:
        target.write_text("x")
    calls = _icacls_calls(monkeypatch, target)
    assert len(calls) >= 2
    first, last = calls[0], calls[-1]
    assert first[0] == "icacls" and "/reset" in first
    assert "/inheritance:r" in last and any(arg.startswith("/grant:r") for arg in last)
    assert all("/L" in call for call in calls)  # act on a link itself, never on its target


def test_windows_restrict_reports_a_failed_reset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "t"
    target.write_text("x")
    monkeypatch.setattr(sidecar_token.platform, "system", lambda: "Windows")
    monkeypatch.setattr(sidecar_token.subprocess, "run", lambda argv, **k: SimpleNamespace(returncode=5 if "/reset" in argv else 0))
    assert sidecar_token.restrict_to_current_user(target) is False


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


def _no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(file_store, "_WINNER_READ_DELAY_S", 0.0)


def test_a_reader_waits_for_a_key_file_that_is_still_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """First open: the key name exists but the winner has not written yet. Wait, as _read_winner does."""
    vault = tmp_path / "vault"
    vault.mkdir()
    key = vault / INSTALL_KEY_NAME
    key.write_bytes(b"")
    winner = Fernet.generate_key()
    sleeps: list[float] = []

    def fill(delay: float) -> None:
        sleeps.append(delay)
        if len(sleeps) == 3:
            key.write_bytes(winner)

    monkeypatch.setattr(file_store.time, "sleep", fill)
    store = FileSecrets(vault, use_keychain=False)
    monkeypatch.undo()
    assert len(sleeps) == 3
    assert key.read_bytes() == winner
    store.put(SECRET_REF, SECRET_VALUE)
    assert FileSecrets(vault, use_keychain=False).get(SECRET_REF) == SECRET_VALUE


def test_a_fresh_empty_key_file_still_fails_closed(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"
    vault.mkdir()
    key = vault / INSTALL_KEY_NAME
    key.write_bytes(b"")
    _no_wait(monkeypatch)
    with pytest.raises(OSError, match="not usable"):
        FileSecrets(vault, use_keychain=False)
    assert key.exists()  # a possible live writer's file is never deleted


@pytest.mark.parametrize("name", [INSTALL_KEY_NAME, STORE_ID_NAME])
def test_a_stale_empty_secret_file_heals_instead_of_blocking_the_vault_for_good(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """An older build's winner died between create and write. Nothing was ever encrypted under it."""
    vault = tmp_path / "vault"
    vault.mkdir()
    empty = vault / name
    empty.write_bytes(b"")
    old = time.time() - 3600
    os.utime(empty, (old, old))
    _no_wait(monkeypatch)
    keyring = _FakeKeyring() if name == STORE_ID_NAME else None
    store = FileSecrets(vault, keyring_backend=keyring, use_keychain=keyring is not None)
    store.put(SECRET_REF, SECRET_VALUE)
    assert FileSecrets(vault, keyring_backend=keyring, use_keychain=keyring is not None).get(SECRET_REF) == SECRET_VALUE


def test_a_secret_file_never_appears_at_its_final_name_empty(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Publish is a link from a complete staged file: a dying writer cannot leave an empty key."""
    vault = tmp_path / "vault"
    real_link = os.link
    sizes: list[int] = []

    def spy(src: object, dst: object, **kwargs: object) -> None:
        sizes.append(os.path.getsize(src))
        real_link(src, dst, **kwargs)

    monkeypatch.setattr(file_store.os, "link", spy)
    FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    assert sizes and all(size > 0 for size in sizes), sizes
    assert not [p for p in vault.iterdir() if p.name.endswith(".tmp")]


def test_a_writer_that_dies_mid_write_leaves_no_key_and_no_stray_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"

    def die(fd: int, data: bytes) -> None:
        raise OSError("killed")

    monkeypatch.setattr(file_store, "_write_all", die)
    with pytest.raises(OSError):
        FileSecrets(vault, use_keychain=False)
    assert list(vault.iterdir()) == []
    monkeypatch.undo()
    assert FileSecrets(vault, use_keychain=False).get(SECRET_REF) is None  # the next open starts clean


def test_put_does_not_probe_the_name_before_writing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """No ``exists()`` between the check and the create: the create itself decides."""
    store = FileSecrets(tmp_path / "vault", use_keychain=False)

    def boom(self: Path, *args: object, **kwargs: object) -> bool:
        raise AssertionError("exists() probed before the write")

    monkeypatch.setattr(Path, "exists", boom)
    store.put(SECRET_REF, "first")
    store.put(SECRET_REF, "second")
    monkeypatch.undo()
    assert store.get(SECRET_REF) == "second"


def test_put_that_loses_a_create_race_replaces_through_a_staged_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    vault = tmp_path / "vault"
    store = FileSecrets(vault, use_keychain=False)
    target = vault / _filename_for_ref(SECRET_REF)
    real_link = os.link

    def racing(src: object, dst: object, **kwargs: object) -> None:
        if Path(dst) == target and not target.is_file():
            target.write_bytes(b"competitor")
        real_link(src, dst, **kwargs)

    monkeypatch.setattr(file_store.os, "link", racing)
    store.put(SECRET_REF, SECRET_VALUE)
    monkeypatch.undo()
    assert store.get(SECRET_REF) == SECRET_VALUE
    assert not [p for p in vault.iterdir() if p.name.endswith(".tmp")]


def test_the_migration_branch_adopts_a_store_id_that_appeared_in_the_race(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """A key file exists and a keychain is now available; another process just wrote .store-id.

    The migration must adopt that id, not overwrite it, and must not replace the
    secret the other process put in the keychain.
    """
    vault = tmp_path / "vault"
    FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    file_key = (vault / INSTALL_KEY_NAME).read_bytes()
    keyring = _FakeKeyring()
    winner_id = "winner-store-id"
    other_secret = Fernet.generate_key().decode("ascii")
    keyring.set_password(FILE_STORE_KEYCHAIN_SERVICE, winner_id, other_secret)

    def racing_token(nbytes: int | None = None) -> str:
        (vault / STORE_ID_NAME).write_text(winner_id, encoding="ascii")
        return "loser-store-id"

    monkeypatch.setattr(file_store.secrets, "token_urlsafe", racing_token)
    store = FileSecrets(vault, keyring_backend=keyring)
    monkeypatch.undo()
    assert (vault / STORE_ID_NAME).read_text(encoding="ascii") == winner_id
    assert keyring.get_password(FILE_STORE_KEYCHAIN_SERVICE, winner_id) == other_secret  # not clobbered
    assert (vault / INSTALL_KEY_NAME).read_bytes() == file_key  # not removed: nothing safe to migrate to
    assert store.get(SECRET_REF) == SECRET_VALUE  # still readable with the file key


def test_the_migration_moves_the_key_when_the_existing_id_holds_the_same_secret(tmp_path: Path) -> None:
    vault = tmp_path / "vault"
    FileSecrets(vault, use_keychain=False).put(SECRET_REF, SECRET_VALUE)
    file_key = (vault / INSTALL_KEY_NAME).read_bytes()
    keyring = _FakeKeyring()
    (vault / STORE_ID_NAME).write_text("existing-id", encoding="ascii")
    keyring.set_password(FILE_STORE_KEYCHAIN_SERVICE, "existing-id", file_key.decode("ascii"))
    assert FileSecrets(vault, keyring_backend=keyring).get(SECRET_REF) == SECRET_VALUE
    assert not (vault / INSTALL_KEY_NAME).exists()


@pytest.mark.skipif(os.name == "nt", reason="O_NOFOLLOW and fchmod: POSIX only")
def test_restricting_existing_files_never_chmods_through_a_link(tmp_path: Path) -> None:
    outside = tmp_path / "outside.bin"
    outside.write_bytes(b"keep")
    outside.chmod(0o644)
    vault = tmp_path / "vault"
    vault.mkdir()
    (vault / "alias.bin").symlink_to(outside)
    FileSecrets(vault, use_keychain=False)
    assert outside.stat().st_mode & 0o777 == 0o644


def test_a_link_swapped_in_after_the_link_check_is_not_read(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """The check-then-open window: with the pre-check blinded, the open itself must refuse a link."""
    vault = tmp_path / "vault"
    store = FileSecrets(vault, use_keychain=False)
    store.put(SECRET_REF, SECRET_VALUE)
    blob = vault / _filename_for_ref(SECRET_REF)
    decoy = tmp_path / "decoy.bin"
    decoy.write_bytes(blob.read_bytes())
    blob.unlink()
    try:
        blob.symlink_to(decoy)
    except (OSError, NotImplementedError):
        pytest.skip("symbolic links are not available here")
    monkeypatch.setattr(file_store, "_is_link", lambda path: False)
    with pytest.raises(OSError):
        store.get(SECRET_REF)


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
        # Fixed argv, no shell: icacls and a pytest tmp_path. The audit rule flags every subprocess call.
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
