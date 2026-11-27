"""Save a blueprint as a trial, ask whether an automation would fire, and check a workflow from Nilo."""
from __future__ import annotations

import json
from pathlib import Path

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import blueprint as blueprint_rules
from factory import definition_rules as rules
from factory import versions
from factory.auth import actor_for
from factory.definition import hash_of, load, validate
from factory.improvement import limits
from factory.nilo_setup import compose
from factory.service import FactoryError
from factory_intake.automations import Event, Trigger, explain_trigger

router = APIRouter(prefix='/factory/blueprint', tags=['factory'])


BODY_MAX_BYTES = 64 * 1024
NAME = r'^[a-z0-9][a-z0-9_.-]{0,63}$'


def _bounded(value):
    if value is not None and len(json.dumps(value)) > BODY_MAX_BYTES:
        raise ValueError(f'at most {BODY_MAX_BYTES} bytes')
    return value


# A person edits the blueprint here, so only the blueprint is free; every other field keeps the rules of a proposal.
FREE = (r'blueprint\..+', r'blueprint')
HASH = r'^[0-9a-f]{64}$'


class SaveBody(BaseModel):
    model_config = {'extra': 'forbid'}
    factory_id: str = Field(pattern=rules.ID_PATTERN)
    base_hash: str = Field(pattern=HASH)  # the version the editor loaded: a save from an older one is refused
    blueprint: dict
    stages: dict | None = None
    preview: bool = False

    @field_validator('blueprint', 'stages')
    @classmethod
    def _small(cls, value):
        return _bounded(value)


class Facts(BaseModel):
    model_config = {'extra': 'forbid'}
    labels: list[str] = Field(default_factory=list, max_length=50)
    stage: str = Field(default='', max_length=40)
    returns: int = Field(default=0, ge=0, le=1000)
    answer: str = Field(default='', max_length=64)


class SimulateBody(BaseModel):
    model_config = {'extra': 'forbid'}
    factory_id: str = Field(pattern=rules.ID_PATTERN)
    facts: Facts = Field(default_factory=Facts)
    blueprint: dict | None = None  # a draft; without it, the active blueprint

    @field_validator('blueprint')
    @classmethod
    def _small(cls, value):
        return _bounded(value)


class WouldFireBody(BaseModel):
    model_config = {'extra': 'forbid'}
    provider: str = Field(pattern=NAME)
    event: str = Field(pattern=NAME)
    filter: dict = Field(default_factory=dict)
    fields: dict = Field(default_factory=dict)
    payload: dict | None = None

    @field_validator('filter', 'fields', 'payload')
    @classmethod
    def _small(cls, value):
        return _bounded(value)


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


async def _stable(db: AsyncSession, factory_id: str):
    current = await versions.state(db, factory_id)
    if current.stable is None:
        raise HTTPException(status_code=404, detail={'code': 'no_stable', 'message': 'There is no active definition for this factory.'})
    return current.stable


def removed(before: dict | None, after: dict | None) -> list[dict]:
    """Entries, routes and gates of the active blueprint that the new one no longer has."""
    out = []
    for kind in ('entry', 'routes', 'gates'):
        kept = list((after or {}).get(kind) or [])
        for rule in (before or {}).get(kind) or []:
            if rule in kept:
                kept.remove(rule)
            else:
                out.append({'kind': kind, 'rule': rule})
    return out


@router.get('')
async def read(factory_id: str = Query(pattern=rules.ID_PATTERN), db: AsyncSession = Depends(get_db)):
    stable = await _stable(db, factory_id)
    definition = json.loads(stable.definition_json)
    return {'hash': stable.hash, 'blueprint': definition.get('blueprint') or {}, 'stages': definition.get('stages') or {}}


@router.post('/simulate')
async def simulate(body: SimulateBody, db: AsyncSession = Depends(get_db)):
    blueprint = body.blueprint
    if blueprint is None:
        blueprint = json.loads((await _stable(db, body.factory_id)).definition_json).get('blueprint') or {}
    return {'path': blueprint_rules.simulate(blueprint, body.facts.model_dump())}


@router.post('')
async def save(body: SaveBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = _human(request)
    stable = await _stable(db, body.factory_id)
    if stable.hash != body.base_hash:
        raise HTTPException(status_code=409, detail={'code': 'stale', 'message': 'The active definition changed since the editor loaded it. Load it again.'})
    before = json.loads(stable.definition_json)
    after = json.loads(json.dumps(before))
    after['blueprint'] = body.blueprint
    if body.stages is not None:
        after['stages'] = body.stages
    # Every gate, mode and scorer rule still applies, and no route may jump a required stage.
    reasons = limits.check(before, after, free=FREE)
    if after.get('name') != body.factory_id:
        reasons.append({'code': 'wrong_factory', 'path': 'name', 'message': 'The active definition is for another factory.'})
    reasons += [{'code': 'invalid_definition', 'path': issue.path, 'message': issue.message} for issue in validate(after) if issue.severity == 'error']
    reasons += blueprint_rules.problems(after)
    gone = removed(before.get('blueprint'), after.get('blueprint'))
    if body.preview:
        return {'status': 'preview', 'removed': gone, 'reasons': reasons}
    if reasons:
        return {'status': 'rejected', 'reasons': reasons, 'removed': gone}
    try:
        row = await versions.activate(db, after, hash_of(after), actor, mode='canary', percent=10, label='blueprint')
    except FactoryError as exc:
        raise HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail}) from None
    return {'hash': row.hash, 'kind': row.kind, 'mode': row.mode, 'percent': row.percent, 'status': 'canary', 'removed': gone}


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
