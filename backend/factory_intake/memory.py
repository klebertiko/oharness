"""In-memory ``FactoryPort`` for tests and for developing the intake side before the foundation (package A) is wired in."""
from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone

from .port import Claim, FactoryError, ReleaseResult, WorkItemDraft, WorkItemView, WorkState


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryFactory:
    def __init__(self) -> None:
        self._items: dict[str, WorkItemView] = {}
        self._by_key: dict[tuple[str, str], str] = {}
        self.comments: dict[str, list[tuple[str, str]]] = {}
        self._lock = threading.RLock()

    def submit(self, draft: WorkItemDraft) -> WorkItemView:
        with self._lock:
            key = (draft.source.kind, draft.idempotency_key)  # keys are scoped to their source: one source cannot read another's item
            if key in self._by_key:
                return self._items[self._by_key[key]]
            now = _now()
            item = WorkItemView(id=uuid.uuid4().hex[:12], state="queued", source=draft.source, title=draft.title, created_at=now, updated_at=now)
            self._items[item.id] = item
            self._by_key[key] = item.id
            return item

    def _get(self, item_id: str) -> WorkItemView:
        try:
            return self._items[item_id]
        except KeyError:
            raise FactoryError("not_found", "no such work item") from None

    def _set(self, item: WorkItemView, **changes) -> WorkItemView:
        updated = item.model_copy(update={**changes, "updated_at": _now()})
        self._items[item.id] = updated
        return updated

    def get(self, item_id: str) -> WorkItemView:
        with self._lock:
            return self._get(item_id)

    def list(self, state: WorkState | None = None, source=None, limit: int = 50) -> list[WorkItemView]:
        with self._lock:
            items = [i for i in self._items.values() if (state is None or i.state == state) and (source is None or i.source.kind == source)]
        return items[:limit]

    def comment(self, item_id: str, text: str, author: str) -> None:
        with self._lock:
            self._get(item_id)
            self.comments.setdefault(item_id, []).append((author, text))

    def cancel(self, item_id: str) -> WorkItemView:
        with self._lock:
            item = self._get(item_id)
            if item.state in ("done", "failed", "cancelled"):
                raise FactoryError("already_finished", f"work item is {item.state}")
            return self._set(item, state="cancelled", claim=None)

    def claim(self, item_id: str, holder: str) -> WorkItemView:
        with self._lock:
            item = self._get(item_id)
            if item.state not in ("queued", "running", "waiting_human"):
                raise FactoryError("not_claimable", f"work item is {item.state}")
            return self._set(item, state="claimed", claim=Claim(holder=holder))

    def release(self, item_id: str, result: ReleaseResult) -> WorkItemView:
        with self._lock:
            item = self._get(item_id)
            if item.state != "claimed":
                raise FactoryError("not_claimed", "work item is not claimed")
            return self._set(item, state="waiting_human" if result.status == "needs_review" else "queued", claim=None)

    def metrics(self, window_days: int = 7) -> dict:
        with self._lock:
            counts: dict[str, int] = {}
            for item in self._items.values():
                counts[item.state] = counts.get(item.state, 0) + 1
            return {"window_days": window_days, "by_state": counts, "cost_tokens": sum(i.cost_tokens for i in self._items.values())}
