"""Save a blueprint as a trial, ask whether an automation would fire, and check a workflow from Nilo."""
from __future__ import annotations

import json
from pathlib import Path

import anyio
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import versions
from factory.auth import actor_for
from factory.definition import hash_of, load
from factory.improvement import limits
from factory.nilo_setup import compose
from factory.service import FactoryError
from factory_intake.automations import Event, Trigger, explain_trigger

router = APIRouter(prefix='/factory/blueprint', tags=['factory'])


class SaveBody(BaseModel):
    model_config = {'extra': 'ignore'}
    factory_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    blueprint: dict
    stages: dict | None = None


class WouldFireBody(BaseModel):
    model_config = {'extra': 'ignore'}
    provider: str
    event: str
    filter: dict = Field(default_factory=dict)
    fields: dict = Field(default_factory=dict)
    payload: dict | None = None


class NiloBody(BaseModel):
    model_config = {'extra': 'ignore'}
    recipe: str = Field(pattern=r'^[a-z0-9-]{1,40}$')
    name: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    request: str = Field(default='', max_length=500)


def _human(request: Request) -> str:
    kind, who = actor_for(request)
    if kind != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'Changing the blueprint needs the human credential of the app.'})
    return who or 'human'


@router.post('')
async def save(body: SaveBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = _human(request)
    current = await versions.state(db, body.factory_id)
    if current.stable is None:
        raise HTTPException(status_code=409, detail={'code': 'no_stable', 'message': 'There is no active definition to edit.'})
    before = json.loads(current.stable.definition_json)
    after = json.loads(json.dumps(before))
    after['blueprint'] = body.blueprint
    if body.stages is not None:
        after['stages'] = body.stages
    reasons = limits.check(before, after)
    if reasons:
        return {'status': 'rejected', 'reasons': reasons}
    try:
        row = await versions.activate(db, after, hash_of(after), actor, mode='canary', percent=10, label='blueprint')
    except FactoryError as exc:
        raise HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail}) from None
    return {'hash': row.hash, 'kind': row.kind, 'mode': row.mode, 'percent': row.percent, 'status': 'canary'}


@router.post('/would-fire')
async def would_fire(body: WouldFireBody):
    trigger = Trigger(body.provider, body.event, body.filter)
    event = Event(body.provider, body.event, fields=body.fields, payload=body.payload)
    failed = explain_trigger(trigger, event)
    return {'fires': not failed, 'failed': failed}


@router.post('/nilo')
async def nilo(body: NiloBody):
    try:
        files = compose(body.recipe, body.name, body.request)
    except ValueError:
        raise HTTPException(status_code=422, detail={'code': 'unknown_recipe', 'message': 'That workflow is not one Nilo can build.'}) from None

    def _load() -> dict:
        import tempfile
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for rel, text in files.items():
                path = root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding='utf-8')
            loaded = load(root)
            return {'ok': loaded.ok, 'errors': [issue.as_dict() for issue in loaded.issues if issue.severity == 'error'],
                    'review_required': bool((loaded.definition or {}).get('stages', {}).get('review', {}).get('required'))}
    return await anyio.to_thread.run_sync(_load)
