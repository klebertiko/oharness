"""Client tokens for the integration API (ADR 0061). The secrets store holds only a SHA-256 of each token (a JSON map under one secret);
the token itself is shown once at creation. A token carries scopes and the ``source.kind`` its work is recorded under, so a client can never
pass as GitHub (and so can never make the factory answer in someone else's thread)."""
from __future__ import annotations

import hashlib
import hmac
import json
import re
import secrets
from dataclasses import dataclass

from .security import Rejected, vault_key

SCOPES = ("work:read", "work:write", "work:claim")
CLIENT_KINDS = ("cli", "mcp", "webhook", "manual")
STORE_NAME = "api-tokens"
_NAME = re.compile(r"^[a-z0-9][a-z0-9-]{0,62}$")


class TokenStoreError(RuntimeError):
    """The stored token map cannot be read."""


@dataclass(frozen=True)
class Client:
    name: str
    scopes: frozenset[str]
    source_kind: str

    def require(self, scope: str) -> None:
        if scope not in self.scopes:
            raise Rejected("forbidden", f"this token lacks the {scope} scope", 403)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


class ClientTokens:
    def __init__(self, store):
        self._store = store

    def _load(self) -> dict:
        raw = self._store.get(vault_key(STORE_NAME))
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except ValueError:
            data = None
        if not isinstance(data, dict):  # never treat an unreadable map as empty: the next create would silently revoke every client
            raise TokenStoreError("the client token map in the secrets store is unreadable")
        return data

    def _save(self, data: dict) -> None:
        self._store.put(vault_key(STORE_NAME), json.dumps(data))

    def create(self, name: str, scopes: list[str], source_kind: str = "cli") -> str:
        if not _NAME.fullmatch(name) or source_kind not in CLIENT_KINDS or not scopes or any(s not in SCOPES for s in scopes):
            raise ValueError("invalid client name, scope or source kind")
        data = self._load()
        if name in data:
            raise ValueError("a client with this name already exists")
        token = "ohf_" + secrets.token_urlsafe(32)
        data[name] = {"sha256": _digest(token), "scopes": sorted(set(scopes)), "kind": source_kind}
        self._save(data)
        return token

    def revoke(self, name: str) -> bool:
        data = self._load()
        if data.pop(name, None) is None:
            return False
        self._save(data)
        return True

    def names(self) -> list[str]:
        return sorted(self._load())

    def authenticate(self, header: str | None) -> Client:
        presented = header[7:].strip() if header and header.lower().startswith("bearer ") else ""
        digest, found = _digest(presented), None
        try:
            entries = self._load()
        except TokenStoreError:
            raise Rejected("unavailable", "client tokens are unavailable", 503) from None
        for name, entry in entries.items():  # compare against every entry: no early exit that leaks which one matched
            if isinstance(entry, dict) and hmac.compare_digest(digest, str(entry.get("sha256", ""))) and presented:
                found = Client(name, frozenset(entry.get("scopes", [])), str(entry.get("kind", "cli")))
        if found is None:
            raise Rejected("unauthorized", "missing or invalid token", 401)
        return found
