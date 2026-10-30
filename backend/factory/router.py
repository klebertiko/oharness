"""`/factory` routes (ADR 0053). The sidecar token (middleware) gates every route; human-only actions also need the human class."""
from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import service
from factory.auth import actor_for
from factory.models import HUMAN_ONLY_ACTIONS, ActionBody, WorkItemCreate
from factory.orm import WorkItem, WorkItemArtifact, WorkItemEvent, WorkItemRun
from factory.stages import COLUMNS, STAGES, STATUSES

router = APIRouter(prefix='/factory', tags=['factory'])


def _item_json(item: WorkItem) -> dict:
    return {
        'id': item.id, 'factory_id': item.factory_id, 'factory_version': item.factory_version, 'title': item.title,
        'source': {'kind': item.source_kind, 'subtype': item.source_subtype, 'ref': item.source_ref, 'url': item.source_url,
                   'thread_ref': item.thread_ref},
        'origin_context': {'trust': 'untrusted', 'text': item.origin_text, 'truncated': item.origin_truncated,
                           'attachments': json.loads(item.origin_attachments_json)},
        'labels': json.loads(item.labels_json), 'agent': item.agent, 'automation': item.automation,
        'token_ceiling': item.token_ceiling, 'requested_by': item.requested_by, 'reopens': item.reopens,
        'stage': item.stage, 'status': item.status, 'column': service.column(item),
        'spec': {'text': item.spec_text, 'revision': item.spec_revision, 'approved_revision': item.approved_revision},
        'claim': json.loads(item.claim_json) if item.claim_json else None,
        'cost': {'tokens': item.cost_tokens},
        'created_at': item.created_at.isoformat() + 'Z', 'updated_at': item.updated_at.isoformat() + 'Z',
        'closed_at': item.closed_at.isoformat() + 'Z' if item.closed_at else None,
    }


def _event_json(e: WorkItemEvent) -> dict:
    return {'sequence': e.sequence, 'type': e.type, 'actor': {'kind': e.actor_kind, 'id': e.actor_id},
            'data': json.loads(e.data_json), 'at': e.at.isoformat() + 'Z'}


def _artifact_json(a: WorkItemArtifact) -> dict:
    return {'id': a.id, 'kind': a.kind, 'ref': a.ref, 'label': a.label, 'created_at': a.created_at.isoformat() + 'Z'}


def _run_json(r: WorkItemRun) -> dict:
    return {'run_id': r.run_id, 'stage': r.stage, 'agent_id': r.agent_id, 'role': r.role}


def _http(exc: service.FactoryError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail})


@router.get('/vocabulary')
async def vocabulary():
    return {'stages': list(STAGES), 'statuses': list(STATUSES), 'columns': list(COLUMNS)}


@router.post('/work-items')
async def create_work_item(body: WorkItemCreate, request: Request, db: AsyncSession = Depends(get_db)):
    from fastapi.responses import JSONResponse
    try:
        item, created, replay = await service.create(db, body, actor_for(request))
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail={'code': 'conflict', 'message': 'A concurrent request changed this item; retry.'})
    # 201: new item. 200: the item that already exists (idempotent replay or an open item for the same reference).
    return JSONResponse(_item_json(item) | {'created': created, 'replay': replay}, status_code=201 if created else 200)


@router.get('/work-items')
async def list_work_items(factory_id: str | None = None, column: str | None = None, stage: str | None = None,
                          status: str | None = None, source_kind: str | None = None, limit: int = 50,
                          cursor: str | None = None, db: AsyncSession = Depends(get_db)):
    try:
        items = await service.list_items(db, factory_id, column, stage, status, source_kind, limit, cursor)
    except service.FactoryError as exc:
        raise _http(exc)
    return {'items': [_item_json(i) for i in items], 'next_cursor': items[-1].id if len(items) == max(1, min(limit, 200)) else None}


@router.get('/work-items/{item_id}')
async def get_work_item(item_id: str, db: AsyncSession = Depends(get_db)):
    try:
        item = await service.get(db, item_id)
    except service.FactoryError as exc:
        raise _http(exc)
    return _item_json(item) | {'artifacts': [_artifact_json(a) for a in await service.artifacts(db, item_id)],
                               'runs': [_run_json(r) for r in await service.runs(db, item_id)]}


@router.get('/work-items/{item_id}/events')
async def get_events(item_id: str, after: int = 0, limit: int = 100, db: AsyncSession = Depends(get_db)):
    try:
        rows = await service.events(db, item_id, after, limit)
    except service.FactoryError as exc:
        raise _http(exc)
    return {'events': [_event_json(e) for e in rows]}


@router.post('/work-items/{item_id}/actions')
async def post_action(item_id: str, body: ActionBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = actor_for(request)
    if body.action in HUMAN_ONLY_ACTIONS and actor[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only',
                                                      'message': 'This decision needs the human credential of the app.'})
    try:
        item = await service.get(db, item_id)
        item = await service.apply_action(db, item, body, actor)
    except service.FactoryError as exc:
        await db.rollback()
        raise _http(exc)
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail={'code': 'conflict', 'message': 'A concurrent request changed this item; retry.'})
    return _item_json(item)
