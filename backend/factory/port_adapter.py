"""`FactoryPort` of the intake package (B) over the Forja service (issue #332): `factory.port_adapter:build_port`.

The port is synchronous and the service is asynchronous, so the adapter owns one background thread with an event loop and an engine of its own
on the same database (the sidecar keeps its own, so no connection is ever used from two loops). Callers may be synchronous (the CLI, the MCP
server) or inside a running loop. Everything the draft carries from outside is untrusted data: the owner's `instructions` and `token_ceiling` go
to their own columns and never mix with the origin text.
"""
from __future__ import annotations

import asyncio
import os
import threading
from datetime import datetime, timedelta, timezone

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database import DATABASE_URL, Base
from factory import service
from factory.models import ActionBody, Source, WorkItemCreate
from factory.orm import WorkItem, WorkItemArtifact
from factory_intake.port import Claim, FactoryError, ReleaseResult, SourceRef, SubmitResult, WorkItemDraft, WorkItemView

DEFAULT_FACTORY = 'default'
TIMEOUT_S = 60
_ACTOR = ('agent', 'port')


class ForjaPort:
    def __init__(self, factory_id: str, database_url: str = DATABASE_URL):
        self.factory_id = factory_id
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(target=self._loop.run_forever, name='forja-port', daemon=True)
        self._thread.start()
        self._engine = create_async_engine(database_url, echo=False)
        self._sessions = async_sessionmaker(self._engine, expire_on_commit=False)
        self._call(self._create_tables())

    # ------------------------------------------------------------------------------------------------------------------ bridge

    def _call(self, coroutine):
        return asyncio.run_coroutine_threadsafe(coroutine, self._loop).result(TIMEOUT_S)

    async def _create_tables(self) -> None:
        """Only what the port touches, so a bare database (the CLI before the app ever ran) works."""
        from factory.orm import WorkItemEvent, WorkItemRun

        tables = [m.__table__ for m in (WorkItem, WorkItemEvent, WorkItemRun, WorkItemArtifact)]
        async with self._engine.begin() as connection:
            await connection.run_sync(lambda sync: Base.metadata.create_all(sync, tables=tables))

    def close(self) -> None:
        if self._loop.is_closed():
            return
        self._call(self._engine.dispose())
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=10)
        self._loop.close()

    def _run(self, work):
        """`work(db)` inside one session on the adapter loop; the service errors become port errors with the same stable code."""
        async def go():
            async with self._sessions() as db:
                return await work(db)
        try:
            return self._call(go())
        except service.FactoryError as exc:
            raise FactoryError(exc.code, exc.detail) from None

    # ---------------------------------------------------------------------------------------------------------------------- view

    @staticmethod
    async def _view(db, item: WorkItem) -> WorkItemView:
        pr = await db.scalar(select(WorkItemArtifact.ref).where(WorkItemArtifact.work_item_id == item.id, WorkItemArtifact.kind == 'pr')
                             .order_by(WorkItemArtifact.created_at.desc()).limit(1))
        import json
        claim = json.loads(item.claim_json) if item.claim_json else None
        return WorkItemView(
            id=item.id, state=item.status, stage=item.stage,
            source=SourceRef(kind=item.source_kind, ref=item.source_ref[:200], url=item.source_url, thread_ref=item.thread_ref),
            title=item.title, cost_tokens=item.cost_tokens, pr_url=pr, created_at=item.created_at.isoformat() + 'Z', updated_at=item.updated_at.isoformat() + 'Z',
            claim=Claim(holder=claim['holder'], worktree_ref=claim.get('worktree_ref')) if claim else None)

    # ----------------------------------------------------------------------------------------------------------------- the port

    def submit(self, draft: WorkItemDraft) -> SubmitResult:
        try:
            body = WorkItemCreate(factory_id=self.factory_id, title=draft.title[:200], source=Source(kind=draft.source.kind, ref=draft.source.ref, url=draft.source.url,
                                                                                                   thread_ref=draft.source.thread_ref),
                                  origin_context={'text': draft.body}, labels=list(draft.labels), requested_by=draft.requested_by or None,
                                  idempotency_key=draft.idempotency_key, agent=draft.agent, automation=draft.automation)
        except ValidationError:
            raise FactoryError('invalid_draft', 'The request does not fit the Forja: check the agent and automation ids and the field sizes.') from None

        async def work(db):
            item, created, replay = await service.create(db, body, ('source', (draft.requested_by or draft.source.kind)[:200]),
                                                         instructions=draft.instructions or None, token_ceiling=draft.token_ceiling)
            return SubmitResult(item=await self._view(db, item), created=created, replay=replay)
        return self._run(work)

    def get(self, item_id: str) -> WorkItemView:
        async def work(db):
            return await self._view(db, await service.get(db, item_id))
        return self._run(work)

    def list(self, state=None, source=None, limit: int = 50) -> list[WorkItemView]:
        async def work(db):
            items = await service.list_items(db, self.factory_id, status=state, source_kind=source, limit=limit)
            return [await self._view(db, i) for i in items]
        return self._run(work)

    def _act(self, item_id: str, body: ActionBody, actor=_ACTOR) -> WorkItemView:
        async def work(db):
            item = await service.apply_action(db, await service.get(db, item_id), body, actor)
            return await self._view(db, item)
        return self._run(work)

    def comment(self, item_id: str, text: str, author: str) -> None:
        self._act(item_id, ActionBody(action='note', text=text[:20000]), ('source', author[:200]))

    def cancel(self, item_id: str) -> WorkItemView:
        return self._act(item_id, ActionBody(action='cancel'))

    def claim(self, item_id: str, holder: str, worktree_ref: str | None = None) -> WorkItemView:
        return self._act(item_id, ActionBody(action='claim', holder=holder, worktree_ref=worktree_ref))

    def release(self, item_id: str, result: ReleaseResult) -> WorkItemView:
        return self._act(item_id, ActionBody(action='release', summary=result.summary, branch=result.branch, status=result.status))

    def metrics(self, window_days: int = 7) -> dict:
        from factory import metrics

        now = datetime.now(timezone.utc).replace(tzinfo=None)
        days = max(1, min(int(window_days), 365))

        async def work(db):
            return await metrics.compute(db, window=None, since=(now - timedelta(days=days)).isoformat(), factory_id=self.factory_id)
        return self._run(work)


def build_port(factory_id: str | None = None) -> ForjaPort:
    """The port for one Forja: the id given, else `OH_FORJA_ID`, else `default`."""
    return ForjaPort(factory_id or os.environ.get('OH_FORJA_ID') or DEFAULT_FACTORY)
