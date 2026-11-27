"""Durable checkpoints and human decisions for a live supervised run."""
from __future__ import annotations

import json

from sqlalchemy import select

from factory import network_supervision as supervision, service
from factory.orm import WorkItem, WorkItemEvent


async def make_supervisor(db, item, run_id, definition, agent_id, cancel, scrub, journal):
    key = supervision.policy_key(definition, agent_id)
    rows = await db.scalars(select(WorkItemEvent).join(WorkItem, WorkItem.id == WorkItemEvent.work_item_id)
                            .where(WorkItem.factory_id == item.factory_id, WorkItemEvent.type == 'network_approved',
                                   WorkItemEvent.actor_kind == 'human'))
    grants = set()
    for row in rows:
        data = json.loads(row.data_json)
        if data.get('policy_key') == key and data.get('decision') == 'host':
            grants.update(data.get('hosts') or [])

    async def checkpoint(request):
        await db.refresh(item)
        if item.status != 'running':
            raise service.FactoryError('run_not_running')
        item.status = 'awaiting_human'
        await service.add_event(db, item, 'checkpoint_requested', ('foreman', None), {
            'kind': 'question', 'question_id': request['id'], 'question': request['reason'], 'network_request': request,
        })
        await db.commit()
        await journal('network_checkpoint', {'isolation': 'none', 'network_request': request})

    return supervision.Supervisor(run_id, item.id, definition, agent_id, checkpoint, cancel=cancel, grants=grants, scrub=scrub,
                                  audit=journal)


async def expire(db, item, run_id=None):
    question = await service._open_question(db, item)
    data = json.loads(question.data_json) if question else {}
    request = data.get('network_request')
    if request and (run_id is None or request.get('run_id') == run_id):
        await service.add_event(db, item, 'checkpoint_resolved', ('system', None), {
            'kind': 'question', 'question_id': data['question_id'], 'expired': True,
        })
        if item.status == 'awaiting_human':
            item.status = 'queued'
        if item.status == 'parked' and item.parked_from == 'awaiting_human':
            item.parked_from = 'queued'
        if item.status == 'claimed':
            claim = json.loads(item.claim_json or '{}')
            if claim.get('from_status') == 'awaiting_human':
                item.claim_json = json.dumps({**claim, 'from_status': 'queued'})
        return True
    return False


async def decide(db, item_id, request_id, decision, actor):
    if actor[0] != 'human':
        raise service.FactoryError('human_only', 403, 'Network approval requires a person.')
    try:
        found = supervision.pending(item_id, request_id)
    except ValueError as exc:
        raise service.FactoryError('network_approval_expired', 409, str(exc)) from exc
    if decision == 'host' and not found.request['can_remember']:
        raise service.FactoryError('host_approval_unavailable', 422)
    # Claim before awaiting database work, so simultaneous clicks cannot create two decisions.
    found.claimed = True
    try:
        item = await service.get(db, item_id)
        question = await service._open_question(db, item)
        data = json.loads(question.data_json) if question else {}
        if (item.status != 'awaiting_human' or data.get('question_id') != request_id
                or not data.get('network_request') or found.supervisor.cancel.is_set()):
            raise service.FactoryError('network_approval_expired')
        audit = {'request_id': request_id, 'run_id': found.supervisor.run_id, 'decision': decision,
                 'agent_id': found.supervisor.agent_id, 'policy_key': found.supervisor.key,
                 'argv': found.request['argv'], 'hosts': found.request['hosts'], 'isolation': 'none'}
        await service.add_event(db, item, 'network_denied' if decision == 'deny' else 'network_approved', actor, audit)
        await service.add_event(db, item, 'checkpoint_resolved', actor, {'kind': 'question', 'question_id': request_id})
        item.status = 'running'
        await db.commit()
        # Consent becomes executable only after its audit has committed.
        if not found.supervisor.cancel.is_set() and not found.future.done():
            if decision == 'host':
                found.supervisor.grants.add(found.request['hosts'][0])
            found.future.set_result(decision != 'deny')
        return item
    except BaseException:
        await db.rollback()
        raise
    finally:
        found.claimed = False
