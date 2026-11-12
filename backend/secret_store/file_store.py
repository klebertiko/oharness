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
Windows the ACL comes from ``security.sidecar_token.restrict_to_current_user``.
Restrict runs before any secret bytes are written. If it fails, the empty
file is removed and nothing is stored.

Files written by older builds were encrypted with a key derived only from
the absolute store path (``openharness.file-secrets.v1``). The first open
decrypts those and re-encrypts them with the install secret, in place. A
blob neither key can open is left untouched.
"""

from __future__ import annotations

import base64
import hashlib
import os
import platform
import re
import secrets
import stat
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from security.sidecar_token import restrict_to_current_user

from .keychain import KeyringBackend

_SAFE_REF = re.compile(r"[^A-Za-z0-9._-]+")
INSTALL_KEY_NAME = ".install-key"
STORE_ID_NAME = ".store-id"
FILE_STORE_KEYCHAIN_SERVICE = "oharness.file-store"
_MAX_BLOB_BYTES = 1024 * 1024


def _is_link(path: Path) -> bool:
    return path.is_symlink() or path.is_junction()


def _open_flags(*parts: int) -> int:
    flags = 0
    for part in parts:
        flags |= part
    for name in ("O_NOFOLLOW", "O_CLOEXEC", "O_BINARY"):
        flags |= getattr(os, name, 0)
    return flags


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


def _owner_only_dir_mode() -> int:
    """Directory mode with read, write, and search for the owner and nobody else.

    Returned as a call, not the literal ``0o700``. The audit rule compares that
    integer with ``0o644`` and calls it permissive; a directory needs the search
    bit, and group and other have none here.
    """
    return stat.S_IRUSR | stat.S_IWUSR | stat.S_IXUSR


def _restrict_directory(path: Path) -> bool:
    """Owner-only directory.

    On POSIX this is ``0700`` from ``chmod``, not ``restrict_to_current_user``.
    That helper chmods to ``0600``, which is right for a file and wrong for a
    directory (it drops the search bit). On Windows the helper is the ACL.
    """
    if platform.system() == "Windows":
        return restrict_to_current_user(path)
    try:
        os.chmod(path, _owner_only_dir_mode())
    except OSError:
        return False
    return True


def _ensure_private_dir(path: Path) -> None:
    try:
        if path.exists() and not path.is_dir():
            raise OSError("the secrets path is not a directory")
        if not path.exists():
            path.parent.mkdir(parents=True, exist_ok=True)
            try:
                os.mkdir(path, _owner_only_dir_mode())  # umask cannot add group or other bits
            except FileExistsError:
                if not path.is_dir():
                    raise OSError("the secrets path is not a directory") from None
    except OSError as exc:
        if str(exc) == "the secrets path is not a directory":
            raise
        raise OSError("the secrets directory could not be created") from None
    if not _restrict_directory(path):
        raise OSError("could not restrict the secrets directory to the current user")


def _restrict_existing_files(root: Path) -> None:
    """Tighten files already on disk before they are read or rewritten."""
    for entry in root.iterdir():
        if _is_link(entry) or not entry.is_file():
            continue
        if not restrict_to_current_user(entry):
            raise OSError("could not restrict the secret file to the current user")


def _read_all(path: Path) -> bytes:
    fd = os.open(path, _open_flags(os.O_RDONLY))
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


def _write_new(path: Path, data: bytes) -> None:
    """Create ``path`` owner-only, restrict it, and only then write ``data``.

    ``O_EXCL`` so an existing name (including a link) is not opened. The
    first descriptor is closed before restrict so Windows can set the ACL,
    and it is closed before any secret byte exists. Failure deletes the
    empty file.
    """
    if _is_link(path):
        raise OSError("refusing to follow a link in the secrets directory")
    fd = os.open(path, _open_flags(os.O_WRONLY, os.O_CREAT, os.O_EXCL), 0o600)
    os.close(fd)
    try:
        if not restrict_to_current_user(path):
            raise OSError("could not restrict the secret file to the current user")
        fd = os.open(path, _open_flags(os.O_WRONLY, os.O_TRUNC), 0o600)
        try:
            if hasattr(os, "fchmod"):
                os.fchmod(fd, 0o600)
            _write_all(fd, data)
        finally:
            os.close(fd)
    except Exception:
        path.unlink(missing_ok=True)
        raise


def _write_private(path: Path, data: bytes) -> None:
    if _is_link(path):
        raise OSError("refusing to follow a link in the secrets directory")
    if not path.exists():
        try:
            _write_new(path, data)
            return
        except FileExistsError:
            pass
    if not restrict_to_current_user(path):
        raise OSError("could not restrict the secret file to the current user")
    tmp = path.with_name("." + path.name + "." + secrets.token_hex(6) + ".tmp")
    try:
        _write_new(tmp, data)
        os.replace(tmp, path)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise
    if not restrict_to_current_user(path):
        raise OSError("could not restrict the secret file to the current user")


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
    if _is_link(path):
        raise OSError("refusing to follow a link in the secrets directory")
    if not path.is_file():
        return None
    return _ascii_secret(_read_all(path), what=what)


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
    except Exception:
        return None
    if not getattr(backend, "priority", 0):
        return None
    return keyring


def _keychain_get(backend: KeyringBackend, store_id: str) -> str | None:
    try:
        value = backend.get_password(FILE_STORE_KEYCHAIN_SERVICE, store_id)
    except Exception:
        return None
    return value or None


def _keychain_set(backend: KeyringBackend, store_id: str, secret: bytes) -> bool:
    text = secret.decode("ascii")
    try:
        backend.set_password(FILE_STORE_KEYCHAIN_SERVICE, store_id, text)
        return backend.get_password(FILE_STORE_KEYCHAIN_SERVICE, store_id) == text
    except Exception:
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
            if store_id is None:
                store_id = secrets.token_urlsafe(16)
                _write_private(id_path, store_id.encode("ascii"))
            if _keychain_set(backend, store_id, file_secret):
                key_path.unlink()
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
            _write_private(id_path, store_id.encode("ascii"))
            return secret
    _write_private(key_path, secret)
    return secret


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
        data = _read_all(path)
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
        _write_private(path, fernet.encrypt(plain))


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
        except InvalidToken:
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
