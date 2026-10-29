"""Local log of webhook deliveries (ADR 0061): what arrived, what was decided, and (for accepted ones) the redacted payload.

Rejected and duplicate entries keep metadata only. At least the newest ``KEEP`` entries and ``DAYS`` days are kept.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

from sandbox.secrets import redact

OUTCOMES = ("accepted", "duplicate", "rejected_auth", "rejected_json", "rejected_size", "rejected_rate")
KEEP, DAYS, MAX_PAYLOAD = 50, 7, 64 * 1024


class DeliveryLog:
    def __init__(self, path: str | Path, clock=time.time):
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.execute("CREATE TABLE IF NOT EXISTS deliveries (id INTEGER PRIMARY KEY, webhook TEXT, delivery_id TEXT, outcome TEXT, size INTEGER, at REAL, payload TEXT, items TEXT)")
        self._lock = threading.Lock()
        self._clock = clock

    def record(self, webhook: str, delivery_id: str, outcome: str, size: int, payload: str | None = None, items: list[str] | None = None) -> None:
        assert outcome in OUTCOMES
        stored = redact(payload)[0][:MAX_PAYLOAD] if payload is not None and outcome == "accepted" else None
        with self._lock, self._db:
            self._db.execute("INSERT INTO deliveries (webhook, delivery_id, outcome, size, at, payload, items) VALUES (?,?,?,?,?,?,?)",
                             (webhook, delivery_id[:200], outcome, size, self._clock(), stored, json.dumps(items or [])))
            self._db.execute("DELETE FROM deliveries WHERE at < ? AND id NOT IN (SELECT id FROM deliveries ORDER BY id DESC LIMIT ?)", (self._clock() - DAYS * 86400, KEEP))

    def recent(self, webhook: str, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT delivery_id, outcome, size, at, payload, items FROM deliveries WHERE webhook = ? ORDER BY id DESC LIMIT ?", (webhook, limit)).fetchall()
        return [{"delivery_id": r[0], "outcome": r[1], "size": r[2], "at": r[3], "payload": r[4], "items": json.loads(r[5])} for r in rows]

    def close(self) -> None:
        self._db.close()
