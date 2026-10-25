"""OS keychain SecretsStore via the optional ``keyring`` package.

Install with ``pip install keyring`` (or the commented optional line in
``requirements.txt``). Selected when ``OH_SECRETS=keychain``.

The keyring backend is injectable so unit tests never touch the real OS
credential store.
"""

from __future__ import annotations

from typing import Protocol


class KeyringBackend(Protocol):
    def get_password(self, service: str, username: str) -> str | None: ...

    def set_password(self, service: str, username: str, password: str) -> None: ...

    def delete_password(self, service: str, username: str) -> None: ...


def _default_keyring() -> KeyringBackend:
    try:
        import keyring
    except ImportError as exc:  # pragma: no cover - exercised via factory
        raise ImportError(
            "OH_SECRETS=keychain requires the optional 'keyring' package. "
            "Install with: pip install keyring"
        ) from exc
    return keyring


class KeychainSecrets:
    """SecretsStore backed by an OS keychain (or a test double)."""

    SERVICE = "oharness"
    LEGACY_SERVICE = "openharness"  # pre-rebrand entries, read-through and migrated on first get

    def __init__(
        self,
        *,
        service: str = SERVICE,
        backend: KeyringBackend | None = None,
    ) -> None:
        self._service = service
        self._kr = backend if backend is not None else _default_keyring()

    def put(self, ref: str, value: str) -> None:
        self._kr.set_password(self._service, ref, value)

    def get(self, ref: str) -> str | None:
        value = self._kr.get_password(self._service, ref)
        if value is None and self._service == self.SERVICE:
            value = self._kr.get_password(self.LEGACY_SERVICE, ref)
            if value is not None:
                self._kr.set_password(self._service, ref, value)
                self._kr.delete_password(self.LEGACY_SERVICE, ref)
        return value

    def delete(self, ref: str) -> None:
        if not self.exists(ref):
            return
        self._kr.delete_password(self._service, ref)
    def exists(self, ref: str) -> bool:
        return self.get(ref) is not None

    def __repr__(self) -> str:
        return f"KeychainSecrets(service={self._service!r})"
