"""Fernet-backed file SecretsStore — used when ``OH_SECRETS=file``.

The encryption key is a per-install random secret, not the store path. When
the optional ``keyring`` package has a working OS backend, that secret is
stored in the keychain (service ``oharness.file-store``). Without one, it is
stored in ``.install-key`` inside the vault directory.

That file fallback is a real limitation: the key sits next to the ciphertext,
and any process running as the same user can read both. Mode ``0600`` (and
the Windows ACL) stops other users. It does not stop other processes of this
user. Prefer ``OH_SECRETS=keychain`` — which stores the credentials
themselves in the keychain — or install ``keyring`` so only the wrapping
secret is there. See ADR 0070.

The directory is created mode ``0700`` and each file mode ``0600``. On
Windows the ACL comes from ``security.sidecar_token.restrict_to_current_user``
(a reset, then only this user). On POSIX every mode is set with ``fchmod`` on
the descriptor that was opened without following links, so no step re-resolves
a path. A vault that is a link or junction is refused on every platform.

A secret file is never created in place. It is staged under a temporary name
(created ``O_EXCL``, restricted, then written) and published with
``os.link``, which is atomic and fails if the name exists. The final name is
therefore never empty, and a writer that dies leaves nothing at it. If the
restriction fails, the staged file is removed and nothing is stored. The vault
must be on a file system that supports hard links (any local NTFS, ext4,
APFS); on one that does not, opening fails closed.

Files written by older builds were encrypted with a key derived only from
the absolute store path (``openharness.file-secrets.v1``). The first open
decrypts those and re-encrypts them with the install secret, in place. A
blob neither key can open is left untouched.
"""

from __future__ import annotations

import base64
import contextlib
import errno
import hashlib
import os
import platform
import re
import secrets
import stat
import time
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from security.sidecar_token import restrict_fd_to_current_user, restrict_to_current_user

from .keychain import KeyringBackend

_SAFE_REF = re.compile(r"[^A-Za-z0-9._-]+")
INSTALL_KEY_NAME = ".install-key"
STORE_ID_NAME = ".store-id"
FILE_STORE_KEYCHAIN_SERVICE = "oharness.file-store"
_MAX_BLOB_BYTES = 1024 * 1024
_WINNER_READ_ATTEMPTS = 50
_WINNER_READ_DELAY_S = 0.02
# An empty key/id file this old was left by a writer that died (older builds created
# the name, then wrote). Nothing was ever encrypted under it, so it is safe to drop.
_STALE_EMPTY_S = 30.0
_STALE_TMP_S = 60.0
# ``os.replace`` onto a name a reader holds open can fail on Windows with these codes for a moment
# (access denied, sharing violation: antivirus and indexers also open files briefly). Bounded, then
# the put fails closed with the last error.
_REPLACE_BUSY_WINERRORS = (5, 32)
_REPLACE_ATTEMPTS = 20
_REPLACE_DELAY_S = 0.025
_USE_POSIX_RENAME = True  # Windows: swap the name even while a reader has the old file open
_OWNER_RWX = stat.S_IRWXU
_OWNER_RW = stat.S_IRUSR | stat.S_IWUSR


def _is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def _open_flags(*parts: int) -> int:
    flags = 0
    for part in parts:
        flags |= part
    for name in ("O_NOFOLLOW", "O_CLOEXEC", "O_BINARY"):
        flags |= getattr(os, name, 0)
    return flags


_REPARSE_LINK_TAGS = (0xA000000C, 0xA0000003)  # IO_REPARSE_TAG_SYMLINK, IO_REPARSE_TAG_MOUNT_POINT


def _is_link_stat(info: os.stat_result) -> bool:
    return stat.S_ISLNK(info.st_mode) or getattr(info, "st_reparse_tag", 0) in _REPARSE_LINK_TAGS


def _open_fd(path: Path, flags: int, *, write_dac: bool = False) -> int:
    """``os.open`` on POSIX. On Windows a read-only open goes through ``CreateFileW`` with every
    share mode, ``FILE_SHARE_DELETE`` included: ``os.open`` omits it, and a reader opened that way
    makes ``os.replace`` of the name fail with ``WinError 5`` until the reader closes.
    """
    if platform.system() != "Windows" or flags & (os.O_WRONLY | os.O_RDWR):
        return os.open(path, flags)
    from security import win_files

    access = win_files.GENERIC_READ | (win_files.WRITE_DAC if write_dac else 0)
    return win_files.open_file(
        path, access=access, disposition=win_files.OPEN_EXISTING, binary_flags=os.O_RDONLY | getattr(os, "O_BINARY", 0)
    )


def _open_checked(path: Path, flags: int, *, write_dac: bool = False) -> int:
    """Open a regular file and refuse it if the name is a link.

    ``O_NOFOLLOW`` covers POSIX at open. Windows has no such flag, so ``lstat`` must also not
    report a symlink or reparse point at the name: a link swapped in after a ``_is_link`` check
    opens its target, and ``lstat`` still sees the link. A name that now points at a *different
    regular file* is not refused: ``put`` swaps the inode with ``os.replace``, and a reader that
    opened the old one still holds a complete, consistent copy.
    """
    fd = _open_fd(path, flags, write_dac=write_dac)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError("the secret path is not a regular file")
        try:
            named = os.lstat(path)
        except FileNotFoundError:
            named = None  # replaced or removed since the open: the descriptor is still a regular file
        if named is not None and _is_link_stat(named):
            raise OSError("refusing to follow a link in the secrets directory")
    except BaseException:
        os.close(fd)
        raise
    return fd


def _legacy_fernet_for_root(root: Path) -> Fernet:
    """Pre-fix key: PBKDF2 of the absolute path only. Migration, not new data.

    The salt domain ``openharness.file-secrets.v1`` is frozen. Changing it
    would make files written before the install secret unreadable.
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


def _new_install_secret() -> bytes:
    """A Fernet key: 32 random bytes, already urlsafe-base64.

    The value is the key. It is not stretched: it is not a password, and a
    fast hash of it would not add secrecy.
    """
    return Fernet.generate_key()


def _fernet_for_secret(secret: bytes) -> Fernet:
    try:
        return Fernet(secret)
    except (ValueError, TypeError):
        raise OSError("the file-store key is not usable") from None


def _filename_for_ref(ref: str) -> str:
    digest = hashlib.sha256(ref.encode("utf-8")).hexdigest()[:16]
    safe = _SAFE_REF.sub("_", ref).strip("._-")[:48] or "ref"
    return f"{safe}.{digest}.bin"


def _restrict_directory(path: Path) -> bool:
    """Owner-only directory.

    A link or junction in place of the vault is refused on every platform: it
    would aim the restriction, and every later write, at its target. On POSIX
    the directory is opened once without following links, checked through that
    descriptor (a directory, owned by this user), and set to ``0700`` with
    ``fchmod`` on the same descriptor. A folder another user owns is refused:
    fail closed. This is not ``restrict_to_current_user``, which chmods to
    ``0600`` and would drop the search bit a directory needs. On Windows the
    helper resets and sets the ACL (``/L``, so it never follows a link).
    """
    if _is_link(path):
        raise OSError("the secrets path is a link or not a directory")
    if platform.system() == "Windows":
        return restrict_to_current_user(path)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0))
    except OSError as exc:
        if exc.errno in (errno.ELOOP, errno.ENOTDIR):
            raise OSError("the secrets path is a link or not a directory") from None
        return False
    try:
        info = os.fstat(fd)
        if not stat.S_ISDIR(info.st_mode):
            raise OSError("the secrets path is a link or not a directory")
        if info.st_uid != os.geteuid():
            raise OSError("the secrets directory belongs to another user")
        try:
            os.fchmod(fd, _OWNER_RWX)  # a directory needs the search bit: 0700
        except OSError:
            return False
    finally:
        os.close(fd)
    return True


def _ensure_private_dir(path: Path) -> None:
    try:
        if path.exists() and not path.is_dir():
            raise OSError("the secrets path is not a directory")
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.mkdir(path, 0o700)  # umask cannot add group or other bits
            except FileExistsError:
                if not path.is_dir():
                    raise OSError("the secrets path is not a directory") from None
    except OSError as exc:
        if str(exc) == "the secrets path is not a directory":
            raise
        raise OSError("the secrets directory could not be created") from None
    if not _restrict_directory(path):
        raise OSError("could not restrict the secrets directory to the current user")


def _restrict_file(path: Path) -> bool:
    """Owner-only mode for a file already on disk.

    Both platforms open the file once, refuse anything but a regular file (a link included) and
    restrict *that open file*: POSIX ``fchmod`` on a non-blocking descriptor (so a FIFO cannot hang
    the open), Windows the DACL on a ``WRITE_DAC`` handle. No step re-resolves the name.
    """
    windows = platform.system() == "Windows"
    flags = _open_flags(os.O_RDONLY, 0 if windows else getattr(os, "O_NONBLOCK", 0))
    try:
        fd = _open_checked(path, flags, write_dac=True) if windows else _open_checked(path, flags)
    except FileNotFoundError:
        return True  # another process removed it first: nothing left to restrict
    except OSError:
        return False
    try:
        return restrict_fd_to_current_user(fd)
    finally:
        os.close(fd)


def _is_tmp_name(name: str) -> bool:
    return name.startswith(".") and name.endswith(".tmp")


def _sweep_stale_tmp(root: Path) -> None:
    """Remove staged files a dead writer left. A staged key file holds the whole key.

    One younger than ``_STALE_TMP_S`` may be a live writer's, mid-``put``: it is never touched.
    """
    now = time.time()
    for entry in root.iterdir():
        if not _is_tmp_name(entry.name) or _is_link(entry):
            continue
        try:
            if entry.is_file() and now - entry.stat().st_mtime > _STALE_TMP_S:
                entry.unlink()
        except FileNotFoundError:
            continue


def _restrict_existing_files(root: Path) -> None:
    """Tighten files already on disk before they are read or rewritten.

    A staged ``.tmp`` is another process's put in flight (it is created owner-only): skipped.
    """
    _sweep_stale_tmp(root)
    for entry in root.iterdir():
        if _is_tmp_name(entry.name) or _is_link(entry) or not entry.is_file():
            continue
        if not _restrict_file(entry):
            raise OSError("could not restrict the secret file to the current user")


def _read_all(path: Path) -> bytes:
    fd = _open_checked(path, _open_flags(os.O_RDONLY, getattr(os, "O_NONBLOCK", 0)))
    try:
        chunks: list[bytes] = []
        size = 0
        while True:
            block = os.read(fd, 65536)
            if not block:
                break
            size += len(block)
            if size > _MAX_BLOB_BYTES:
                raise OSError("the secrets file is too large")
            chunks.append(block)
        return b"".join(chunks)
    finally:
        os.close(fd)


def _write_all(fd: int, data: bytes) -> None:
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise OSError("could not write the secret file")
        view = view[written:]


def _create_staged(tmp: Path) -> int:
    """Create ``tmp`` exclusively (a name that exists, link included, is never opened).

    Windows opens it with ``WRITE_DAC`` so the ACL can be set on the open handle.
    """
    if platform.system() == "Windows":
        from security import win_files

        return win_files.open_file(
            tmp,
            access=win_files.GENERIC_WRITE | win_files.WRITE_DAC,
            disposition=win_files.CREATE_NEW,
            binary_flags=os.O_WRONLY | getattr(os, "O_BINARY", 0),
        )
    return os.open(tmp, _open_flags(os.O_WRONLY, os.O_CREAT, os.O_EXCL), 0o600)


def _stage_private(path: Path, data: bytes) -> Path:
    """A complete, owner-only copy of ``data`` under a temporary name beside ``path``.

    Created exclusively and restricted *through the open descriptor* before any secret byte is
    written (``fchmod``; on Windows the DACL on the handle), so no name is re-resolved between the
    check and the restriction. Any failure removes the staged file.
    """
    tmp = path.with_name("." + path.name + "." + secrets.token_hex(6) + ".tmp")
    fd = _create_staged(tmp)
    try:
        if not restrict_fd_to_current_user(fd):
            raise OSError("could not restrict the secret file to the current user")
        _write_all(fd, data)
    except BaseException:
        os.close(fd)
        tmp.unlink(missing_ok=True)
        raise
    os.close(fd)
    return tmp


def _write_new(path: Path, data: bytes) -> None:
    """Publish ``data`` at ``path`` only if the name is free; ``FileExistsError`` if not.

    ``os.link`` from a complete staged file is atomic and refuses an existing
    name (a link too), so the name is never visible empty and nothing is
    written through whatever was there.
    """
    tmp = _stage_private(path, data)
    try:
        os.link(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _replace_once(src: Path, dst: Path) -> None:
    """Swap ``src`` over ``dst``. Windows first tries a POSIX-semantics rename, which succeeds while a
    reader still has ``dst`` open; if the system refuses it, ``os.replace`` is the fallback.
    """
    if _USE_POSIX_RENAME and platform.system() == "Windows":
        from security import win_files

        try:
            win_files.rename_replace(src, dst)
            return
        except OSError:
            pass  # not supported here, or a reader without FILE_SHARE_DELETE: the plain replace decides
    os.replace(src, dst)


def _replace_retrying(src: Path, dst: Path) -> None:
    """The swap, retried a bounded number of times while Windows reports the name busy.

    Only ``WinError 5`` and ``32`` are retried, and only ``_REPLACE_ATTEMPTS`` times; the last
    error is then raised, so a vault that stays locked fails closed instead of looping.
    """
    for attempt in range(_REPLACE_ATTEMPTS):
        try:
            _replace_once(src, dst)
            return
        except PermissionError as exc:
            if getattr(exc, "winerror", None) not in _REPLACE_BUSY_WINERRORS or attempt == _REPLACE_ATTEMPTS - 1:
                raise
            time.sleep(_REPLACE_DELAY_S)


def _write_private(path: Path, data: bytes) -> None:
    """Write ``data`` at ``path``, replacing a value already there.

    No ``exists()`` probe: the publish itself decides. A name that exists (or
    appears meanwhile) is replaced by the staged file with ``os.replace``, which
    swaps the name and never writes through a link that was there.
    """
    if _is_link(path):
        raise OSError("refusing to follow a link in the secrets directory")
    tmp = _stage_private(path, data)
    try:
        try:
            os.link(tmp, path)
        except FileExistsError:
            _replace_retrying(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def _ascii_secret(raw: bytes, *, what: str) -> bytes:
    text = raw.strip()
    if not text or len(text) > 512:
        raise OSError(f"the file-store {what} is not usable")
    try:
        text.decode("ascii")
    except UnicodeDecodeError:
        raise OSError(f"the file-store {what} is not usable") from None
    return text


def _read_named(path: Path, *, what: str) -> bytes | None:
    """The secret at ``path``; ``None`` when there is no such file.

    A file seen empty is a first open in progress (an older build created the
    name before it wrote), so wait a short, bounded time for the bytes, as
    ``_read_winner`` does. One that is still empty and old was left by a writer
    that died; nothing was encrypted under it, so it is removed and read as
    absent. A recent empty file is never deleted: its writer may be alive.
    """
    for _ in range(_WINNER_READ_ATTEMPTS):
        if _is_link(path):
            raise OSError("refusing to follow a link in the secrets directory")
        try:
            data = _read_all(path)
        except FileNotFoundError:
            return None
        if data.strip():
            return _ascii_secret(data, what=what)
        time.sleep(_WINNER_READ_DELAY_S)
    try:
        age = time.time() - path.stat().st_mtime
    except FileNotFoundError:
        return None
    if age > _STALE_EMPTY_S:
        path.unlink(missing_ok=True)
        return None
    raise OSError(f"the file-store {what} is not usable")


def _load_keyring() -> KeyringBackend | None:
    """The OS keychain when ``keyring`` imports and has a real backend.

    A missing package, or the fail/null backend (priority 0), means the
    install secret goes to the user-only file instead. Callers that must
    not touch the real keychain pass a backend or set ``use_keychain=False``.
    """
    try:
        import keyring
    except ImportError:
        return None
    try:
        backend = keyring.get_keyring()
    except Exception:  # noqa: BLE001 - any third-party backend failure means "no keychain", not a crash
        return None
    if not getattr(backend, "priority", 0):
        return None
    return keyring


def _keychain_get(backend: KeyringBackend, store_id: str) -> str | None:
    try:
        value = backend.get_password(FILE_STORE_KEYCHAIN_SERVICE, store_id)
    except Exception:  # noqa: BLE001 - a failing backend reads as absent; the file key is the fallback
        return None
    return value or None


def _keychain_set(backend: KeyringBackend, store_id: str, secret: bytes) -> bool:
    text = secret.decode("ascii")
    try:
        backend.set_password(FILE_STORE_KEYCHAIN_SERVICE, store_id, text)
        return backend.get_password(FILE_STORE_KEYCHAIN_SERVICE, store_id) == text
    except Exception:  # noqa: BLE001 - a failing backend means the secret stays in the key file
        return False


def _load_or_create_secret(root: Path, backend: KeyringBackend | None) -> bytes:
    """The install secret. The on-disk key wins while it exists; then the keychain.

    A store id with no key file means the secret lives only in the keychain.
    A missing or failing keychain then raises, instead of minting a new
    secret that could no longer open the ciphertext.
    """
    key_path = root / INSTALL_KEY_NAME
    id_path = root / STORE_ID_NAME
    file_secret = _read_named(key_path, what="key file")
    store_id_bytes = _read_named(id_path, what="id file")
    store_id = store_id_bytes.decode("ascii") if store_id_bytes is not None else None

    if file_secret is not None:
        if backend is not None:
            _move_key_to_keychain(backend, key_path, id_path, store_id, file_secret)
        return file_secret

    if store_id is not None:
        if backend is None:
            raise OSError("the file-store key is in the OS keychain, which is unavailable")
        found = _keychain_get(backend, store_id)
        if not found:
            raise OSError("the file-store key is in the OS keychain, which could not be read")
        return found.encode("utf-8")

    secret = _new_install_secret()
    if backend is not None:
        store_id = secrets.token_urlsafe(16)
        if _keychain_set(backend, store_id, secret):
            try:
                _write_new(id_path, store_id.encode("ascii"))
            except FileExistsError:
                # Another process opened this new vault first. Adopt its id
                # and keychain secret; ours was never used for ciphertext.
                _keychain_forget(backend, store_id)
                winner_id = _read_winner(id_path, what="id file").decode("ascii")
                found = _keychain_get(backend, winner_id)
                if not found:
                    raise OSError("the file-store key is in the OS keychain, which could not be read") from None
                return found.encode("utf-8")
            return secret
    try:
        _write_new(key_path, secret)
    except FileExistsError:
        # Lost the create race: the winner's key is the one on disk, so use
        # it instead of overwriting it out from under the other process.
        return _read_winner(key_path, what="key file")
    return secret


def _move_key_to_keychain(
    backend: KeyringBackend, key_path: Path, id_path: Path, store_id: str | None, file_secret: bytes
) -> None:
    """Move the key file's secret into the keychain, without clobbering anything.

    The store id is created exclusively: if another process wrote one first,
    adopt it. A keychain entry that already holds a *different* secret is
    another process's: refuse with an error and change nothing, so neither
    side's ciphertext is made unreadable by an overwrite.
    """
    if store_id is None:
        candidate = secrets.token_urlsafe(16)
        try:
            _write_new(id_path, candidate.encode("ascii"))
            store_id = candidate
        except FileExistsError:
            store_id = _read_winner(id_path, what="id file").decode("ascii")
    text = file_secret.decode("ascii")
    existing = _keychain_get(backend, store_id)
    if existing is not None and existing != text:
        raise OSError(
            "the vault has two different install secrets (one in the OS keychain, one in the key file), "
            "usually from two processes opening a new vault at once; remove the key file or the keychain "
            "entry (service oharness.file-store) to choose which to keep"
        )
    if existing == text or _keychain_set(backend, store_id, file_secret):
        key_path.unlink(missing_ok=True)


def _read_winner(path: Path, *, what: str) -> bytes:
    """The value another process just created at ``path``."""
    found = _read_named(path, what=what)
    if found is None:
        raise OSError(f"the file-store {what} is not usable")
    return found


def _keychain_forget(backend: KeyringBackend, store_id: str) -> None:
    # Best effort: an orphan entry holds a secret that encrypts nothing.
    with contextlib.suppress(Exception):
        backend.delete_password(FILE_STORE_KEYCHAIN_SERVICE, store_id)


def _identity(path: Path) -> tuple[int, int, int] | None:
    try:
        info = os.lstat(path)
    except FileNotFoundError:
        return None
    return (info.st_ino, info.st_mtime_ns, info.st_size)


def _migrate_legacy(root: Path, fernet: Fernet) -> None:
    blobs = [
        entry
        for entry in root.iterdir()
        if not _is_link(entry)
        and entry.is_file()
        and not entry.name.startswith(".")
        and entry.suffix == ".bin"
    ]
    if not blobs:
        return
    legacy: Fernet | None = None
    for path in blobs:
        seen = _identity(path)
        try:
            data = _read_all(path)
        except FileNotFoundError:
            continue
        try:
            fernet.decrypt(data)
            continue
        except InvalidToken:
            pass  # not the install key; the legacy path key is tried next
        if legacy is None:
            legacy = _legacy_fernet_for_root(root)
        try:
            plain = legacy.decrypt(data)
        except InvalidToken:
            continue
        _replace_if_unchanged(path, fernet.encrypt(plain), seen)


def _replace_if_unchanged(path: Path, data: bytes, seen: tuple[int, int, int] | None) -> None:
    """Rewrite ``path`` unless it changed since ``seen``: a ``put`` that landed meanwhile wins.

    Stage first, compare right before the swap, so the window is the gap between ``lstat`` and
    ``os.replace``, not the whole read-decrypt-encrypt.
    """
    tmp = _stage_private(path, data)
    try:
        if _identity(path) == seen:
            _replace_retrying(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


class FileSecrets:
    def __init__(
        self,
        root: Path | str,
        *,
        keyring_backend: KeyringBackend | None = None,
        use_keychain: bool = True,
    ) -> None:
        self._root = Path(root)
        _ensure_private_dir(self._root)
        _restrict_existing_files(self._root)
        if not use_keychain:
            backend = None
        elif keyring_backend is not None:
            backend = keyring_backend
        else:
            backend = _load_keyring()
        self._fernet = _fernet_for_secret(_load_or_create_secret(self._root, backend))
        _migrate_legacy(self._root, self._fernet)

    def _path(self, ref: str) -> Path:
        return self._root / _filename_for_ref(ref)

    def put(self, ref: str, value: str) -> None:
        _write_private(self._path(ref), self._fernet.encrypt(value.encode("utf-8")))

    def get(self, ref: str) -> str | None:
        path = self._path(ref)
        if _is_link(path) or not path.is_file():
            return None
        try:
            plain = self._fernet.decrypt(_read_all(path))
        except (InvalidToken, FileNotFoundError):
            return None
        try:
            return plain.decode("utf-8")
        except UnicodeDecodeError:
            return None

    def delete(self, ref: str) -> None:
        path = self._path(ref)
        if _is_link(path) or path.is_file():
            path.unlink()

    def exists(self, ref: str) -> bool:
        path = self._path(ref)
        return not _is_link(path) and path.is_file()

    def __repr__(self) -> str:
        return f"FileSecrets(root={self._root!s})"
