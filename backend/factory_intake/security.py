"""Guards every inbound path shares (ADR 0059): authenticity, replay, rate, size, untrusted-text handling and secret references.

Nothing here executes or interprets text from outside. ``fence_untrusted`` is for *displaying* such text to a model as quoted data; it
does not make it safe to obey, which is why the factory never grants permissions based on it (permissions and human checkpoints do).
"""
from __future__ import annotations

import hashlib
import hmac
import time
from collections import OrderedDict
from typing import Callable

from sandbox.secrets import redact

SECRET_REF_PREFIX = "oharness/factory/"
DEFAULT_MAX_BODY_BYTES = 256 * 1024


class Rejected(Exception):
    """An inbound request refused by a guard; ``code`` is stable, ``message`` never carries secrets or request content."""

    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def enforce_size(body: bytes, limit: int = DEFAULT_MAX_BODY_BYTES) -> bytes:
    if len(body) > limit:
        raise Rejected("too_large", f"body exceeds {limit} bytes", 413)
    return body


def verify_hmac_sha256(secret: bytes, body: bytes, signature: str | None, prefix: str = "sha256=") -> None:
    """Constant-time check of ``prefix + hex(HMAC-SHA256(secret, body))`` (GitHub's ``X-Hub-Signature-256`` shape)."""
    if not secret:
        raise Rejected("no_secret", "no webhook secret is configured", 503)
    if not signature or not signature.startswith(prefix):
        raise Rejected("bad_signature", "missing or malformed signature", 401)
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature[len(prefix):].strip().lower(), expected):
        raise Rejected("bad_signature", "signature does not match", 401)


def verify_bearer(expected: str, header: str | None) -> None:
    """Constant-time check of ``Authorization: Bearer <token>`` against a token read from the secrets store."""
    if not expected:
        raise Rejected("no_token", "no endpoint token is configured", 503)
    presented = header[7:].strip() if header and header.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(presented.encode(), expected.encode()):
        raise Rejected("unauthorized", "missing or invalid token", 401)


class ReplayGuard:
    """Remembers delivery ids for ``ttl`` seconds (bounded): a repeated id, or a timestamp outside the window, is refused."""

    def __init__(self, ttl: float = 600.0, max_entries: int = 10_000, clock: Callable[[], float] = time.time):
        self.ttl, self.max_entries, self._clock = ttl, max_entries, clock
        self._seen: OrderedDict[str, float] = OrderedDict()

    def check(self, delivery_id: str, timestamp: float | None = None) -> None:
        now = self._clock()
        if timestamp is not None and abs(now - timestamp) > self.ttl:
            raise Rejected("stale", "delivery timestamp is outside the accepted window", 400)
        while self._seen and (len(self._seen) >= self.max_entries or next(iter(self._seen.values())) < now - self.ttl):
            self._seen.popitem(last=False)
        if delivery_id in self._seen:
            raise Rejected("replay", "delivery already processed", 409)
        self._seen[delivery_id] = now


class RateLimiter:
    """Token bucket per key (a source, a client token): ``burst`` at once, ``per_second`` sustained."""

    def __init__(self, per_second: float = 1.0, burst: int = 10, clock: Callable[[], float] = time.monotonic, max_keys: int = 10_000):
        self.per_second, self.burst, self._clock, self.max_keys = per_second, burst, clock, max_keys
        self._buckets: OrderedDict[str, tuple[float, float]] = OrderedDict()

    def allow(self, key: str) -> bool:
        now = self._clock()
        tokens, last = self._buckets.pop(key, (float(self.burst), now))
        tokens = min(float(self.burst), tokens + (now - last) * self.per_second)
        allowed = tokens >= 1.0
        self._buckets[key] = (tokens - 1.0 if allowed else tokens, now)
        while len(self._buckets) > self.max_keys:
            self._buckets.popitem(last=False)
        return allowed

    def require(self, key: str) -> None:
        if not self.allow(key):
            raise Rejected("rate_limited", "too many requests", 429)


def fence_untrusted(source: str, text: str, limit: int = 20_000) -> str:
    """Quote outside text as data for a model prompt. The fence cannot be closed from inside: the closing tag is broken up in the text."""
    clean = redact(text[:limit])[0].replace("</untrusted", "<\u200b/untrusted")
    return f"<untrusted source={source!r}>\n{clean}\n</untrusted>"


def safe_for_log(text: str, limit: int = 200) -> str:
    """One redacted line for a log: never the raw outside text, never a secret."""
    return redact(" ".join(text.split())[:limit])[0]


def secret_ref(name: str) -> str:
    """The opaque reference under which the secrets store holds a factory credential (never the credential itself)."""
    if not name or not all(ch.isalnum() or ch in "-_." for ch in name):
        raise ValueError("secret names use letters, digits, '-', '_' and '.'")
    return SECRET_REF_PREFIX + name
