"""Guards every inbound path shares (ADR 0059): authenticity, replay, rate, size, untrusted-text handling and secret references.

Nothing here executes or interprets text from outside. ``fence_untrusted`` is for *displaying* such text to a model as quoted data; it
does not make it safe to obey, which is why the factory never grants permissions based on it (permissions and human checkpoints do).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import math
import re
import threading
import time
from collections import OrderedDict
from typing import Callable

from sandbox.secrets import redact

SECRET_REF_PREFIX = "factory/"
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
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest().encode()
    if not hmac.compare_digest(signature[len(prefix):].strip().lower().encode("utf-8", "replace"), expected):  # bytes: a non-ASCII header must be a 401, not a TypeError
        raise Rejected("bad_signature", "signature does not match", 401)


def verify_standard_webhooks(secret: str, headers: dict, body: bytes, now: float | None = None, tolerance: float = 300.0) -> None:
    """Standard Webhooks (Svix-compatible): signature = base64(HMAC-SHA256(key, "<id>.<timestamp>.<body>")) in ``webhook-signature`` as
    ``v1,<sig>`` (several, space separated); key = base64 of the secret after an optional ``whsec_`` prefix. Timestamps older than five
    minutes (or in the future) are refused."""
    if not secret:
        raise Rejected("no_secret", "no webhook secret is configured", 503)
    msg_id, stamp, sig = headers.get("webhook-id"), headers.get("webhook-timestamp"), headers.get("webhook-signature")
    if not (msg_id and stamp and sig):
        raise Rejected("bad_signature", "missing signature headers", 401)
    try:
        issued = float(stamp)
        key = base64.b64decode(secret.removeprefix("whsec_"), validate=True)
    except ValueError:
        raise Rejected("bad_signature", "malformed signature headers", 401) from None
    if not math.isfinite(issued) or abs((time.time() if now is None else now) - issued) > tolerance:
        raise Rejected("stale", "signature timestamp is outside the accepted window", 401)
    expected = base64.b64encode(hmac.new(key, f"{msg_id}.{stamp}.".encode() + body, hashlib.sha256).digest()).decode()
    candidates = [part[3:] for part in sig.split() if part.startswith("v1,")]
    if not any(hmac.compare_digest(c.encode("utf-8", "replace"), expected.encode()) for c in candidates):
        raise Rejected("bad_signature", "signature does not match", 401)


def verify_bearer(expected: str, header: str | None) -> None:
    """Constant-time check of ``Authorization: Bearer <token>`` against a token read from the secrets store."""
    if not expected:
        raise Rejected("no_token", "no endpoint token is configured", 503)
    presented = header[7:].strip() if header and header.lower().startswith("bearer ") else ""
    if not hmac.compare_digest(presented.encode(), expected.encode()):
        raise Rejected("unauthorized", "missing or invalid token", 401)


class ReplayGuard:
    """Remembers delivery ids for ``ttl`` seconds. A repeated id, or a timestamp outside the window (or not a finite number), is refused.

    Bounded, and bounded safely: expired ids are dropped, but a full table of still-valid ids refuses new deliveries (503) instead of
    evicting one, so flooding the table cannot make an old signed delivery replayable."""

    def __init__(self, ttl: float = 600.0, max_entries: int = 10_000, clock: Callable[[], float] = time.time):
        self.ttl, self.max_entries, self._clock = ttl, max_entries, clock
        self._seen: OrderedDict[str, float] = OrderedDict()
        self._lock = threading.Lock()

    def forget(self, delivery_id: str) -> None:
        """Let a delivery be retried: used when handling it failed after it was recorded."""
        with self._lock:
            self._seen.pop(delivery_id, None)

    def check(self, delivery_id: str, timestamp: float | None = None) -> None:
        now = self._clock()
        if timestamp is not None and (not math.isfinite(timestamp) or abs(now - timestamp) > self.ttl):
            raise Rejected("stale", "delivery timestamp is outside the accepted window", 400)
        with self._lock:
            while self._seen and next(iter(self._seen.values())) < now - self.ttl:
                self._seen.popitem(last=False)
            if delivery_id in self._seen:
                raise Rejected("replay", "delivery already processed", 409)
            if len(self._seen) >= self.max_entries:
                raise Rejected("busy", "too many recent deliveries; retry later", 503)
            self._seen[delivery_id] = now


class RateLimiter:
    """Token bucket per key (a source, a client token): ``burst`` at once, ``per_second`` sustained.

    A throttled key is never forgotten to make room: when the table is full, buckets that have refilled completely are dropped, and if it
    is still full a *new* key is refused."""

    def __init__(self, per_second: float = 1.0, burst: int = 10, clock: Callable[[], float] = time.monotonic, max_keys: int = 10_000):
        self.per_second, self.burst, self._clock, self.max_keys = per_second, burst, clock, max_keys
        self._buckets: dict[str, tuple[float, float]] = {}
        self._lock = threading.Lock()

    def _refilled(self, tokens: float, last: float, now: float) -> float:
        return min(float(self.burst), tokens + (now - last) * self.per_second)

    def allow(self, key: str) -> bool:
        with self._lock:
            now = self._clock()
            if key not in self._buckets and len(self._buckets) >= self.max_keys:
                self._buckets = {k: v for k, v in self._buckets.items() if self._refilled(v[0], v[1], now) < self.burst}
                if len(self._buckets) >= self.max_keys:
                    return False
            tokens, last = self._buckets.get(key, (float(self.burst), now))
            tokens = self._refilled(tokens, last, now)
            allowed = tokens >= 1.0
            self._buckets[key] = (tokens - 1.0 if allowed else tokens, now)
            return allowed

    def require(self, key: str) -> None:
        if not self.allow(key):
            raise Rejected("rate_limited", "too many requests", 429)


_FENCE_TAG = re.compile(r"<(\s*/?\s*untrusted)", re.IGNORECASE)


def fence_untrusted(source: str, text: str, limit: int = 20_000) -> str:
    """Quote outside text as data for a model prompt. Secrets are redacted first (then the text is cut), and any ``<untrusted`` or
    ``</untrusted`` in the text, in any case or spacing, is broken up so the text cannot forge or close the fence. This labels data; it
    does not make instructions inside it safe to obey (ADR 0059)."""
    clean = _FENCE_TAG.sub("<\u200b\\1", redact(text)[0][:limit])
    return f"<untrusted source={source!r}>\n{clean}\n</untrusted>"


def safe_for_log(text: str, limit: int = 200) -> str:
    """One line for a log: redacted first, then collapsed and cut to ``limit``. Never the raw outside text, never a secret."""
    return " ".join(redact(text)[0].split())[:limit]


def secret_ref(name: str) -> str:
    """The opaque reference under which the secrets store holds a factory credential (never the credential itself)."""
    if not name or not all(ch.isalnum() or ch in "-_." for ch in name):
        raise ValueError("secret names use letters, digits, '-', '_' and '.'")
    return SECRET_REF_PREFIX + name
