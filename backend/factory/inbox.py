"""The inbox of human decisions (ADR 0058), derived from the work items on every read.

Nothing is stored about what is waiting, so an entry leaves by itself the moment it stops being true. Six kinds: a question asked, a
question answered (information), a spec to review, work ready for review, blocked, and failed. Blocked and failed show only when nothing
else on the item waits for the person. A person can mark an entry done by hand and undo it; that choice is the only thing stored.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from factory import service
from factory.inbox_orm import InboxDismissal
from factory.orm import WorkItem, WorkItemEvent
from factory.stages import CLOSED_STATUSES

TYPES = ('question', 'question_answered', 'spec_review', 'handoff_ready', 'blocked', 'failed')
ACTIONS = {
    'question': ['answer'], 'question_answered': [], 'spec_review': ['approve_spec', 'edit_spec'],
    'handoff_ready': ['confirm_merged', 'request_changes'], 'blocked': ['advance', 'cancel'], 'failed': ['note'],
}
FAILED_WINDOW = timedelta(days=7)
LIMIT = 200


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _entry(kind: str, item: WorkItem, event: WorkItemEvent | None, summary: str = '') -> dict:
    sequence = event.sequence if event else 0
    since = (event.at if event else item.updated_at).isoformat() + 'Z'
    return {'id': f'{kind}:{item.id}:{sequence}', 'type': kind, 'work_item_id': item.id, 'factory_id': item.factory_id, 'title': item.title,
            'stage': item.stage, 'status': item.status, 'since': since, 'summary': summary, 'actions': list(ACTIONS[kind]), 'resolved': False}


def _derive(item: WorkItem, events: list[WorkItemEvent], include_info: bool) -> list[dict]:
    def last(*types: str) -> WorkItemEvent | None:
        return next((e for e in reversed(events) if e.type in types), None)

    def data(event: WorkItemEvent | None) -> dict:
        return json.loads(event.data_json) if event else {}

    out: list[dict] = []
    if item.status == 'failed':
        if item.closed_at and _now() - item.closed_at <= FAILED_WINDOW:
            failed = last('failed')
            out.append(_entry('failed', item, failed or (events[-1] if events else None), str(data(failed).get('reason') or '')))
        return out
    if item.status in CLOSED_STATUSES:
        return out
    if item.status == 'awaiting_human':
        resolved = {data(e).get('question_id') for e in events if e.type == 'checkpoint_resolved'}
        requests = [e for e in events if e.type == 'checkpoint_requested']
        asked = next((e for e in reversed(requests) if data(e).get('kind') == 'question' and data(e).get('question_id') not in resolved), None)
        spec = next((e for e in reversed(requests) if data(e).get('kind') == 'spec'), None)
        if item.stage == 'spec' and spec is not None and item.spec_text and item.approved_revision != item.spec_revision:
            out.append(_entry('spec_review', item, spec, f'Revision {item.spec_revision}'))
        elif asked is not None:
            out.append(_entry('question', item, asked, str(data(asked).get('question') or '')))
        else:
            out.append(_entry('blocked', item, events[-1] if events else None, 'Waiting for a person to decide how this continues.'))
    elif item.status == 'waiting_merge' and item.stage == 'handoff':
        out.append(_entry('handoff_ready', item, last('checkpoint_requested') or (events[-1] if events else None), 'Ready for a person to review and merge.'))
    elif include_info:
        answered, moved = last('checkpoint_resolved'), last('stage_entered', 'checkpoint_requested')
        if answered is not None and data(answered).get('kind') == 'question' and (moved is None or answered.sequence > moved.sequence):
            out.append(_entry('question_answered', item, answered, 'A question on this item was answered.'))
    return out


async def entries(db: AsyncSession, factory_id: str | None = None, *, include_info: bool = False, include_resolved: bool = False) -> list[dict]:
    query = select(WorkItem).where(or_(WorkItem.status.not_in(CLOSED_STATUSES), WorkItem.status == 'failed'))
    if factory_id:
        query = query.where(WorkItem.factory_id == factory_id)
    items = list(await db.scalars(query.order_by(WorkItem.updated_at.desc()).limit(LIMIT)))
    dismissed = {d.key for d in await db.scalars(select(InboxDismissal))}
    found: list[dict] = []
    for item in items:
        events = list(await db.scalars(select(WorkItemEvent).where(WorkItemEvent.work_item_id == item.id).order_by(WorkItemEvent.sequence)))
        for entry in _derive(item, events, include_info):
            entry['resolved'] = entry['id'] in dismissed
            if include_resolved or not entry['resolved']:
                found.append(entry)
    return sorted(found, key=lambda e: e['since'], reverse=True)


async def resolve(db: AsyncSession, key: str) -> None:
    """Mark a currently derived entry done by hand. An id that is not in the inbox right now is an error."""
    if key not in {e['id'] for e in await entries(db, include_info=True, include_resolved=True)}:
        raise service.FactoryError('not_found', 404)
    if await db.get(InboxDismissal, key) is None:
        db.add(InboxDismissal(key=key))
        await db.commit()


async def undo(db: AsyncSession, key: str) -> None:
    row = await db.get(InboxDismissal, key)
    if row is not None:
        await db.delete(row)
        await db.commit()
