"""Fernet-backed file SecretsStore — used when ``OH_SECRETS=file``.

DPAPI-free: the Fernet key is derived from the absolute store path via
PBKDF2-HMAC-SHA256 so the same directory decrypts across process restarts
on this machine. Prefer ``OH_SECRETS=keychain`` for desktop installs.
"""

from __future__ import annotations

import base64
import hashlib
import re
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_SAFE_REF = re.compile(r"[^A-Za-z0-9._-]+")


def _fernet_for_root(root: Path) -> Fernet:
    """Derive a Fernet key from the machine-local absolute store path."""
    material = str(root.resolve()).encode("utf-8")
    # Frozen pre-rebrand domain tag: changing it would make existing files undecryptable.
    salt = hashlib.sha256(b"openharness.file-secrets.v1:" + material).digest()
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=390_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(material))
    return Fernet(key)


def _filename_for_ref(ref: str) -> str:
    digest = hashlib.sha256(ref.encode("utf-8")).hexdigest()[:16]
    safe = _SAFE_REF.sub("_", ref).strip("._-")[:48] or "ref"
    return f"{safe}.{digest}.bin"


class FileSecrets:
    def __init__(self, root: Path | str) -> None:
        self._root = Path(root)
        self._root.mkdir(parents=True, exist_ok=True)
        self._fernet = _fernet_for_root(self._root)

    def _path(self, ref: str) -> Path:
        return self._root / _filename_for_ref(ref)

    def put(self, ref: str, value: str) -> None:
        token = self._fernet.encrypt(value.encode("utf-8"))
        self._path(ref).write_bytes(token)

    def get(self, ref: str) -> str | None:
        path = self._path(ref)
        if not path.is_file():
            return None
        try:
            return self._fernet.decrypt(path.read_bytes()).decode("utf-8")
        except InvalidToken:
            return None

    def delete(self, ref: str) -> None:
        path = self._path(ref)
        if path.is_file():
            path.unlink()

    def exists(self, ref: str) -> bool:
        return self._path(ref).is_file()

    def __repr__(self) -> str:
        return f"FileSecrets(root={self._root!s})"
