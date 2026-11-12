"""The inbox of human decisions (ADR 0058), derived from the work items on every read.

Nothing is stored about what is waiting, so an entry leaves by itself the moment it stops being true. Six kinds: a question asked, a
question answered (information), a spec to review, work ready for review, blocked, and failed. Blocked and failed show only when nothing
else on the item waits for the person. A person can mark an entry done by hand and undo it. That choice is stored, and the work item's
history records who did it and when (`inbox_resolved`, `inbox_restored`). An open question stays open until it is answered: the event is
the trail, not the answer.

The id of an entry carries the event that made it true (the question asked, the spec revision, the handoff), so a later question or a new
spec revision on the same item is a new entry, while a note on a blocked item does not bring a resolved entry back.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from factory import service
from factory.inbox_orm import InboxDismissal
from factory.orm import WorkItem, WorkItemEvent

TYPES = ('question', 'question_answered', 'spec_review', 'handoff_ready', 'blocked', 'failed')
ACTIONS = {
    'question': ['answer'], 'question_answered': [], 'spec_review': ['approve_spec', 'edit_spec'],
    'handoff_ready': ['confirm_merged', 'request_changes'], 'blocked': ['advance', 'cancel'], 'failed': ['note'],
}
FAILED_WINDOW = timedelta(days=7)
DISMISSAL_KEEP = timedelta(days=30)
SUMMARY_CHARS = 500
LIMIT = 500
# Marking the inbox done is an audit of the entry, not a new reason for it. A note already worked this way for a blocked item.
# Skipping them keeps the entry id stable, so the dismissal still matches.
_AUDIT = frozenset({'inbox_resolved', 'inbox_restored'})
_NOT_IDENTITY = frozenset({'note'}) | _AUDIT


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _entry(kind: str, item: WorkItem, event: WorkItemEvent | None, summary: str = '') -> dict:
    sequence = event.sequence if event else 0
    since = (event.at if event else item.updated_at).isoformat() + 'Z'
    return {'id': f'{kind}:{item.id}:{sequence}', 'type': kind, 'work_item_id': item.id, 'factory_id': item.factory_id, 'title': item.title,
            'stage': item.stage, 'status': item.status, 'since': since, 'summary': summary[:SUMMARY_CHARS], 'actions': list(ACTIONS[kind]), 'resolved': False}


def _data(event: WorkItemEvent | None) -> dict:
    return json.loads(event.data_json) if event else {}


def _before_audit(events: list[WorkItemEvent]) -> WorkItemEvent | None:
    """The last event that is not an inbox audit. Used when an entry has no event of its own, so resolving does not rename it."""
    return next((event for event in reversed(events) if event.type not in _AUDIT), None)


def _entry_ref(key: str) -> tuple[str, str] | None:
    """`kind:work_item_id:sequence`. The work item id is a UUID, so it holds no colon."""
    kind, _, rest = key.partition(':')
    item_id, sep, sequence = rest.rpartition(':')
    if kind not in TYPES or not sep or not item_id or not sequence.isdigit():
        return None
    return kind, item_id


def _derive(item: WorkItem, events: list[WorkItemEvent], include_info: bool) -> list[dict]:
    def last(*types: str, where=None) -> WorkItemEvent | None:
        return next((e for e in reversed(events) if e.type in types and (where is None or where(e))), None)

    out: list[dict] = []
    if item.status == 'failed':
        if item.closed_at and _now() - item.closed_at <= FAILED_WINDOW:
            failed = last('failed')
            out.append(_entry('failed', item, failed or _before_audit(events), str(_data(failed).get('reason') or '')))
        return out
    if item.status == 'awaiting_human':
        resolved = {_data(e).get('question_id') for e in events if e.type == 'checkpoint_resolved'}
        asked = last('checkpoint_requested', where=lambda e: _data(e).get('kind') == 'question' and _data(e).get('question_id') not in resolved)
        spec_event = last('checkpoint_requested', 'spec_edited', 'spec_proposed', where=lambda e: e.type != 'checkpoint_requested' or _data(e).get('kind') == 'spec')
        if item.stage == 'spec' and spec_event is not None and item.spec_text and item.approved_revision != item.spec_revision:
            out.append(_entry('spec_review', item, spec_event, f'Revision {item.spec_revision}'))
        if asked is not None:
            out.append(_entry('question', item, asked, str(_data(asked).get('question') or '')))
        if not out:
            quiet = next((e for e in reversed(events) if e.type not in _NOT_IDENTITY), None)  # a note does not change what is blocking
            out.append(_entry('blocked', item, quiet, 'Waiting for a person to decide how this continues.'))
    elif item.status == 'waiting_merge' and item.stage == 'handoff':
        arrived = last('stage_entered', 'checkpoint_requested', where=lambda e: _data(e).get('stage') == 'handoff' or _data(e).get('kind') == 'handoff')
        out.append(_entry('handoff_ready', item, arrived or _before_audit(events), 'Ready for a person to review and merge.'))
    elif include_info and item.status in ('queued', 'running'):
        answered, moved = last('checkpoint_resolved'), last('stage_entered', 'checkpoint_requested')
        if answered is not None and _data(answered).get('kind') == 'question' and (moved is None or answered.sequence > moved.sequence):
            out.append(_entry('question_answered', item, answered, 'A question on this item was answered.'))
    return out


async def entries(db: AsyncSession, factory_id: str | None = None, *, include_info: bool = False, include_resolved: bool = False) -> list[dict]:
    """Only the items that can have an entry are read, whatever else the Forja holds, and their events come in one query."""
    open_for_a_person = WorkItem.status.in_(('awaiting_human', 'waiting_merge'))
    recent_failure = and_(WorkItem.status == 'failed', WorkItem.closed_at >= _now() - FAILED_WINDOW)
    wanted = or_(open_for_a_person, recent_failure, WorkItem.status.in_(('queued', 'running'))) if include_info else or_(open_for_a_person, recent_failure)
    query = select(WorkItem).where(wanted)
    if factory_id:
        query = query.where(WorkItem.factory_id == factory_id)
    items = list(await db.scalars(query.order_by(WorkItem.updated_at.desc()).limit(LIMIT)))
    by_item: dict[str, list[WorkItemEvent]] = {item.id: [] for item in items}
    if items:
        rows = await db.scalars(select(WorkItemEvent).where(WorkItemEvent.work_item_id.in_(by_item)).order_by(WorkItemEvent.work_item_id, WorkItemEvent.sequence))
        for event in rows:
            by_item[event.work_item_id].append(event)
    dismissed = set(await db.scalars(select(InboxDismissal.key)))
    found: list[dict] = []
    for item in items:
        for entry in _derive(item, by_item[item.id], include_info):
            entry['resolved'] = entry['id'] in dismissed
            if include_resolved or not entry['resolved']:
                found.append(entry)
    return sorted(found, key=lambda e: e['since'], reverse=True)


async def _audit(db: AsyncSession, item_id: str, type_: str, actor: tuple[str, str | None], key: str, entry_type: str) -> None:
    item = await db.get(WorkItem, item_id)
    if item is None:  # the choice is still stored; there is no item left to attach the trail to
        return
    await service.add_event(db, item, type_, actor, {'entry_id': key, 'entry_type': entry_type})


async def resolve(db: AsyncSession, key: str, actor: tuple[str, str | None]) -> None:
    """Mark a currently derived entry done by hand. An id that is not in the inbox right now is an error.

    The question (or the block) stays as it was. The history records who hid it and when, the first time.
    """
    current = {e['id']: e for e in await entries(db, include_info=True, include_resolved=True)}
    entry = current.get(key)
    if entry is None:
        raise service.FactoryError('not_found', 404)
    await db.execute(delete(InboxDismissal).where(InboxDismissal.at < _now() - DISMISSAL_KEEP))  # old choices about entries long gone
    if await db.get(InboxDismissal, key) is None:
        db.add(InboxDismissal(key=key))
        await _audit(db, entry['work_item_id'], 'inbox_resolved', actor, key, entry['type'])
    await db.commit()


async def undo(db: AsyncSession, key: str, actor: tuple[str, str | None]) -> None:
    """Bring a hand-resolved entry back, and record who undid it. Undoing something that was not resolved does nothing."""
    row = await db.get(InboxDismissal, key)
    if row is None:
        return
    await db.delete(row)
    ref = _entry_ref(key)
    if ref is not None:
        await _audit(db, ref[1], 'inbox_restored', actor, key, ref[0])
    await db.commit()
