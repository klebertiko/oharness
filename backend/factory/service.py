"""Work item service (ADR 0053, 0055): every write goes through here, so redaction, history and the stage table apply once.

Text from outside (issue bodies, messages) is stored as data and is never an instruction; nothing here reads it as one.
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from factory.models import ORIGIN_LIMIT_BYTES, ActionBody, WorkItemCreate
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory.stages import CLOSED_STATUSES, may_enter, pairs_for_column, column_of
from run_store import redact_value


class FactoryError(Exception):
    def __init__(self, code: str, status: int = 409, detail: str = ''):
        super().__init__(code)
        self.code, self.status, self.detail = code, status, detail or code


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _clip(text: str) -> tuple[str, bool]:
    raw = text.encode('utf-8')
    if len(raw) <= ORIGIN_LIMIT_BYTES:
        return text, False
    # Truncation is visible: the marker and the flag say text was cut; nothing is dropped in silence.
    return raw[:ORIGIN_LIMIT_BYTES].decode('utf-8', 'ignore') + '\n[truncated]', True


async def add_event(db: AsyncSession, item: WorkItem, type_: str, actor: tuple[str, str | None], data: dict | None = None) -> WorkItemEvent:
    last = await db.scalar(select(WorkItemEvent.sequence).where(WorkItemEvent.work_item_id == item.id)
                           .order_by(WorkItemEvent.sequence.desc()).limit(1))
    event = WorkItemEvent(work_item_id=item.id, sequence=(last or 0) + 1, type=type_, actor_kind=actor[0], actor_id=actor[1],
                          data_json=json.dumps(redact_value(data or {})))
    db.add(event)
    item.updated_at = _now()
    return event


def _move(item: WorkItem, stage: str, status: str) -> None:
    item.stage, item.status = stage, status
    if status in CLOSED_STATUSES:
        item.closed_at = _now()


async def create(db: AsyncSession, body: WorkItemCreate, actor: tuple[str, str | None] = ('system', None), *,
                 instructions: str | None = None, token_ceiling: int | None = None) -> tuple[WorkItem, bool, bool]:
    """Returns (item, created, replay). replay: the same idempotency key was delivered before. Neither: an open item
    already holds this source reference, and the caller adds its message as a note."""
    src = body.source
    # Stored and looked-up values are the same (redacted) strings, so de-duplication compares what was written.
    ref = redact_value(src.ref)
    if body.idempotency_key:
        same = await db.scalar(select(WorkItem).where(WorkItem.factory_id == body.factory_id, WorkItem.source_kind == src.kind,
                                                      WorkItem.idempotency_key == body.idempotency_key))
        if same:
            return same, False, True
    open_item = await _open_by_source(db, body.factory_id, src.kind, ref)
    if open_item:
        return open_item, False, False
    previous = await db.scalar(select(WorkItem).where(WorkItem.factory_id == body.factory_id, WorkItem.source_kind == src.kind,
                                                      WorkItem.source_ref == ref).order_by(WorkItem.created_at.desc()).limit(1))
    text, truncated = _clip(redact_value(body.origin_context.text))
    item = WorkItem(factory_id=body.factory_id, title=redact_value(body.title), source_kind=src.kind, source_subtype=src.subtype,
                    source_ref=ref, source_url=redact_value(src.url) if src.url else None,
                    thread_ref=redact_value(src.thread_ref) if src.thread_ref else None, origin_text=text, origin_truncated=truncated,
                    origin_attachments_json=json.dumps(redact_value([a.model_dump() for a in body.origin_context.attachments])),
                    labels_json=json.dumps(redact_value(body.labels)), requested_by=redact_value(body.requested_by) if body.requested_by else None,
                    idempotency_key=body.idempotency_key, reopens=previous.id if previous else None, agent=body.agent, automation=body.automation,
                    instructions=redact_value(instructions) if instructions else None, token_ceiling=token_ceiling, stage='intake', status='queued')
    db.add(item)
    try:
        await db.flush()
    except IntegrityError:
        # Lost a race with a concurrent delivery of the same reference: the database decides, not this code.
        await db.rollback()
        winner = await db.scalar(select(WorkItem).where(WorkItem.factory_id == body.factory_id, WorkItem.source_kind == src.kind,
                                                        WorkItem.idempotency_key == body.idempotency_key)) if body.idempotency_key else None
        if winner:
            return winner, False, True
        winner = await _open_by_source(db, body.factory_id, src.kind, ref)
        if winner:
            return winner, False, False
        raise
    await add_event(db, item, 'created', actor, {'source': src.kind, 'reopens': item.reopens, 'origin_truncated': truncated})
    await db.commit()
    return item, True, False


async def _open_by_source(db: AsyncSession, factory_id: str, kind: str, ref: str) -> WorkItem | None:
    return await db.scalar(select(WorkItem).where(WorkItem.factory_id == factory_id, WorkItem.source_kind == kind,
                                                  WorkItem.source_ref == ref, WorkItem.status.not_in(CLOSED_STATUSES)))


async def get(db: AsyncSession, item_id: str) -> WorkItem:
    item = await db.get(WorkItem, item_id)
    if item is None:
        raise FactoryError('not_found', 404)
    return item


async def list_items(db: AsyncSession, factory_id: str | None = None, column: str | None = None, stage: str | None = None,
                     status: str | None = None, source_kind: str | None = None, limit: int = 50, cursor: str | None = None) -> list[WorkItem]:
    q = select(WorkItem)
    if factory_id:
        q = q.where(WorkItem.factory_id == factory_id)
    if column:
        pairs = pairs_for_column(column)
        if not pairs:
            raise FactoryError('unknown_column', 422)
        q = q.where(tuple_(WorkItem.stage, WorkItem.status).in_(pairs))
    if stage:
        q = q.where(WorkItem.stage == stage)
    if status:
        q = q.where(WorkItem.status == status)
    if source_kind:
        q = q.where(WorkItem.source_kind == source_kind)
    if cursor:
        anchor = await db.get(WorkItem, cursor)
        if anchor is None:
            raise FactoryError('bad_cursor', 422)
        q = q.where(tuple_(WorkItem.created_at, WorkItem.id) < (anchor.created_at, anchor.id))
    q = q.order_by(WorkItem.created_at.desc(), WorkItem.id.desc()).limit(max(1, min(limit, 200)))
    return list((await db.scalars(q)).all())


async def events(db: AsyncSession, item_id: str, after: int = 0, limit: int = 100) -> list[WorkItemEvent]:
    await get(db, item_id)
    q = select(WorkItemEvent).where(WorkItemEvent.work_item_id == item_id, WorkItemEvent.sequence > after) \
        .order_by(WorkItemEvent.sequence).limit(max(1, min(limit, 500)))
    return list((await db.scalars(q)).all())


async def artifacts(db: AsyncSession, item_id: str) -> list[WorkItemArtifact]:
    return list((await db.scalars(select(WorkItemArtifact).where(WorkItemArtifact.work_item_id == item_id)
                                  .order_by(WorkItemArtifact.created_at))).all())


async def runs(db: AsyncSession, item_id: str) -> list[WorkItemRun]:
    return list((await db.scalars(select(WorkItemRun).where(WorkItemRun.work_item_id == item_id)
                                  .order_by(WorkItemRun.created_at))).all())


async def add_artifact(db: AsyncSession, item: WorkItem, kind: str, ref: str, label: str, actor: tuple[str, str | None]) -> WorkItemArtifact:
    art = WorkItemArtifact(work_item_id=item.id, kind=kind, ref=redact_value(ref), label=redact_value(label))
    db.add(art)
    await add_event(db, item, 'artifact_added', actor, {'kind': kind, 'ref': ref, 'label': label})
    return art


async def link_run(db: AsyncSession, item: WorkItem, run_id: str, stage: str, actor: tuple[str, str | None],
                   agent_id: str | None = None, role: str | None = None) -> None:
    db.add(WorkItemRun(work_item_id=item.id, run_id=run_id, stage=stage, agent_id=agent_id, role=role))
    await add_event(db, item, 'run_linked', actor, {'run_id': run_id, 'stage': stage, 'agent_id': agent_id})
    await db.commit()


async def enter_stage(db: AsyncSession, item: WorkItem, stage: str, actor: tuple[str, str | None], status: str = 'queued',
                      reason: str = '', cause: str = '') -> None:
    """Move along the stage table. Skipped stages are recorded; a move the table does not allow is an error, not an adjustment."""
    if item.status in CLOSED_STATUSES:
        raise FactoryError('closed')
    if not may_enter(item.stage, stage):
        raise FactoryError('stage_not_allowed', detail=f'{item.stage} -> {stage}')
    order = ('intake', 'triage', 'spec', 'implement', 'review', 'verify', 'handoff', 'monitor')
    if order.index(stage) > order.index(item.stage):
        for skipped in order[order.index(item.stage) + 1:order.index(stage)]:
            await add_event(db, item, 'stage_skipped', actor, {'stage': skipped, 'reason': reason})
    elif stage == 'implement':
        await add_event(db, item, 'verify_failed' if cause == 'verify_failed' else 'returned_to_implement', actor, {'reason': reason})
    _move(item, stage, status)
    await add_event(db, item, 'stage_entered', actor, {'stage': stage, 'status': status})


async def request_checkpoint(db: AsyncSession, item: WorkItem, actor: tuple[str, str | None], kind: str, question: str = '',
                             question_id: str | None = None) -> None:
    """Pause for a person: `spec`, `question` or `handoff`. Only a human-class action resolves it."""
    # Every checkpoint carries an id, so a resolution always names what it resolves.
    _move(item, item.stage, 'awaiting_human')
    await add_event(db, item, 'checkpoint_requested', actor, {'kind': kind, 'question': question, 'question_id': question_id or str(uuid.uuid4())})


async def _open_question(db: AsyncSession, item: WorkItem) -> WorkItemEvent | None:
    rows = await db.scalars(select(WorkItemEvent).where(WorkItemEvent.work_item_id == item.id,
                                                        WorkItemEvent.type.in_(('checkpoint_requested', 'checkpoint_resolved')))
                            .order_by(WorkItemEvent.sequence.desc()))
    resolved: set[str] = set()
    for row in rows:
        data = json.loads(row.data_json)
        if row.type == 'checkpoint_resolved' and data.get('question_id'):
            resolved.add(data['question_id'])
        elif row.type == 'checkpoint_requested' and data.get('kind') == 'question' and data.get('question_id') not in resolved:
            return row
    return None


async def apply_action(db: AsyncSession, item: WorkItem, body: ActionBody, actor: tuple[str, str | None]) -> WorkItem:
    """The only door for decisions. Whether the caller may use a human-only action is checked by the caller (credential class)."""
    a = body.action
    if item.status in CLOSED_STATUSES and a not in ('note',):
        raise FactoryError('closed')
    if a == 'note':
        await add_event(db, item, 'note', actor, {'text': body.text or ''})
    elif a == 'cancel':
        _move(item, item.stage, 'cancelled')
        await add_event(db, item, 'cancelled', actor, {'note': body.note})
    elif a == 'park':
        if item.status in ('parked', 'claimed'):
            raise FactoryError('cannot_park')
        await add_event(db, item, 'parked', actor, {'from_status': item.status})
        item.parked_from = item.status
        _move(item, item.stage, 'parked')
    elif a == 'resume':
        if item.status != 'parked':
            raise FactoryError('not_parked')
        # A pending human checkpoint survives a park: resume restores what was waiting, it never clears it.
        _move(item, item.stage, item.parked_from if item.parked_from in ('awaiting_human', 'waiting_merge') else 'queued')
        item.parked_from = None
        await add_event(db, item, 'resumed', actor)
    elif a == 'edit_spec':
        if body.text is None or body.base_revision is None:
            raise FactoryError('missing_fields', 422)
        if item.stage not in ('triage', 'spec') and not (item.stage == 'implement' and item.status == 'queued'):
            raise FactoryError('spec_locked')
        if body.base_revision != item.spec_revision:
            raise FactoryError('stale_revision')
        item.spec_text, item.spec_revision, item.approved_revision = redact_value(body.text), item.spec_revision + 1, None
        await add_event(db, item, 'spec_edited', actor, {'revision': item.spec_revision})
    elif a == 'approve_spec':
        if item.stage != 'spec' or item.status != 'awaiting_human':
            raise FactoryError('no_spec_checkpoint')
        if not item.spec_text or body.revision != item.spec_revision:
            raise FactoryError('stale_revision')
        item.approved_revision = item.spec_revision
        await add_event(db, item, 'spec_approved', actor, {'revision': item.spec_revision})
        await add_event(db, item, 'checkpoint_resolved', actor, {'kind': 'spec'})
        await enter_stage(db, item, 'implement', actor)
    elif a == 'answer':
        question = await _open_question(db, item)
        if question is None or not body.text or item.status != 'awaiting_human':
            raise FactoryError('no_open_question')
        if body.question_id and body.question_id != json.loads(question.data_json).get('question_id'):
            raise FactoryError('no_open_question')
        await add_event(db, item, 'checkpoint_resolved', actor,
                        {'kind': 'question', 'question_id': json.loads(question.data_json).get('question_id'), 'answer': body.text})
        _move(item, item.stage, 'queued')
    elif a == 'request_changes':
        if item.stage not in ('review', 'handoff', 'verify'):
            raise FactoryError('stage_not_allowed')
        await add_event(db, item, 'changes_requested', actor, {'note': body.note})
        await enter_stage(db, item, 'implement', actor, reason=body.note or '', cause='changes_requested')
    elif a == 'confirm_merged':
        if item.stage != 'handoff' or item.status != 'waiting_merge':
            raise FactoryError('not_waiting_merge')
        await add_event(db, item, 'merge_observed', actor, {'via': 'human_confirmation'})
        _move(item, item.stage, 'done')
        await add_event(db, item, 'completed', actor)
    elif a == 'advance':
        if item.status in ('claimed', 'parked') or await _open_question(db, item):
            raise FactoryError('cannot_advance')
        target = {'intake': 'triage', 'triage': 'spec', 'spec': 'implement', 'implement': 'review', 'review': 'handoff',
                  'verify': 'review'}.get(item.stage)
        if target is None:
            raise FactoryError('cannot_advance')
        if item.stage == 'spec' and item.approved_revision != item.spec_revision:
            raise FactoryError('spec_not_approved')
        await add_event(db, item, 'advanced', actor)
        await enter_stage(db, item, target, actor, status='waiting_merge' if target == 'handoff' else 'queued')
    elif a == 'claim':
        if item.status == 'claimed' or not body.holder:
            raise FactoryError('cannot_claim')
        item.claim_json = json.dumps({'holder': redact_value(body.holder), 'from_status': item.status})
        _move(item, item.stage, 'claimed')
        await add_event(db, item, 'claimed', actor, {'holder': body.holder})
    elif a == 'release':
        if item.status != 'claimed' or body.status is None:
            raise FactoryError('not_claimed')
        prior = json.loads(item.claim_json or '{}').get('from_status') or 'queued'
        pending = prior in ('awaiting_human', 'waiting_merge', 'parked')
        # A release never completes the item and never clears a human checkpoint. Finished local work goes to review, but only from a
        # stage where implementation happens and with no checkpoint pending; abandoned work gets its earlier status back.
        if body.status == 'needs_review' and (pending or item.stage not in ('implement', 'review', 'verify')):
            raise FactoryError('release_not_allowed', detail='use status abandoned, or resolve the pending checkpoint first')
        item.claim_json = None
        if body.branch:
            await add_artifact(db, item, 'diff', body.branch, 'released branch', actor)
        await add_event(db, item, 'released', actor, {'summary': body.summary, 'status': body.status})
        if body.status == 'needs_review':
            if item.stage != 'review':
                await enter_stage(db, item, 'review', actor, reason='released for review')
            else:
                _move(item, 'review', 'queued')
        else:
            _move(item, item.stage, prior)
    await db.commit()
    return item


def column(item: WorkItem) -> str:
    return column_of(item.stage, item.status)
