"""`/factory/definition` routes (ADR 0056). The sidecar token gates every route; changing which version is active needs the human credential.

The definition is read from the `.oharness/forja` folder of a project registered in OHarness. The sidecar reads it and never writes
to it; the client names the project, never a path of its own.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Literal

import anyio
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import definition, versions
from factory.auth import actor_for
from factory.service import FactoryError

router = APIRouter(prefix='/factory/definition', tags=['factory'])
HASH = r'^[0-9a-f]{64}$'


class WorkspaceBody(BaseModel):
    workspace: str = Field(min_length=1, max_length=4096)


class ActivateBody(WorkspaceBody):
    mode: Literal['stable', 'canary'] = 'stable'
    percent: int | None = None
    label: str | None = Field(default=None, max_length=100)
    # The version the person reviewed (/validate): the folder is read again at activation, so a rewrite in between must not slip through.
    expected_hash: str = Field(pattern=HASH)


class FactoryBody(BaseModel):
    factory_id: str = Field(pattern=r'^[a-z0-9][a-z0-9-]{0,62}$')
    to: str | None = Field(default=None, pattern=HASH)


def _http(exc: FactoryError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail})


def _human(request: Request) -> str:
    kind, who = actor_for(request)
    if kind != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'Changing the active definition needs the human credential of the app.'})
    return who or 'human'


def _version_json(row: versions.DefinitionVersion) -> dict:
    return {'hash': row.hash, 'kind': row.kind, 'mode': row.mode, 'percent': row.percent, 'label': row.label,
            'previous_hash': row.previous_hash, 'activated_by': row.activated_by, 'activated_at': row.activated_at.isoformat() + 'Z'}


async def _load(db: AsyncSession, workspace: str) -> definition.Loaded:
    from routers.execution import _validated_project_cwd  # the one place that decides which folders are projects

    cwd = await _validated_project_cwd(db, workspace)
    if cwd is None:
        raise HTTPException(status_code=404, detail={'code': 'unknown_workspace', 'message': 'The workspace is not a project registered in OHarness.'})
    try:
        return await anyio.to_thread.run_sync(definition.load, Path(cwd) / '.oharness' / 'forja')
    except definition.DefinitionNotFound:
        raise HTTPException(status_code=404, detail={'code': 'no_definition', 'message': 'This project has no .oharness/forja folder.'}) from None


@router.post('/validate')
async def validate(body: WorkspaceBody, db: AsyncSession = Depends(get_db)):
    loaded = await _load(db, body.workspace)
    out: dict = {'ok': loaded.ok, 'hash': loaded.hash, 'errors': [i.as_dict() for i in loaded.issues if i.severity == 'error'],
                 'warnings': [i.as_dict() for i in loaded.issues if i.severity == 'warning'], 'active_hash': None,
                 'update_available': False, 'changes': []}
    if loaded.definition is not None:
        active = (await versions.state(db, loaded.definition['name'])).stable
        out['active_hash'] = active.hash if active else None
        out['update_available'] = loaded.ok and loaded.hash != out['active_hash']
        if active and loaded.ok:
            out['changes'] = [c.as_dict() for c in definition.diff(json.loads(active.definition_json), loaded.definition)]
    return out


@router.get('')
async def current(factory_id: str, db: AsyncSession = Depends(get_db)):
    state = await versions.state(db, factory_id)
    return {'stable': _version_json(state.stable) if state.stable else None, 'canary': _version_json(state.canary) if state.canary else None}


@router.get('/versions')
async def list_versions(factory_id: str, db: AsyncSession = Depends(get_db)):
    return {'versions': [_version_json(r) for r in await versions.history(db, factory_id)]}


@router.get('/versions/{hash_}')
async def get_version(hash_: str, factory_id: str, db: AsyncSession = Depends(get_db)):
    try:
        row = await versions.snapshot(db, factory_id, hash_)
    except FactoryError as exc:
        raise _http(exc) from None
    return _version_json(row) | {'definition': json.loads(row.definition_json)}


@router.get('/diff')
async def diff(factory_id: str, from_: str = Query(alias='from', pattern=HASH), to: str = Query(pattern=HASH), db: AsyncSession = Depends(get_db)):
    try:
        before, after = await versions.snapshot(db, factory_id, from_), await versions.snapshot(db, factory_id, to)
    except FactoryError as exc:
        raise _http(exc) from None
    changes = definition.diff(json.loads(before.definition_json), json.loads(after.definition_json))
    return {'from': from_, 'to': to, 'changes': [c.as_dict() for c in changes]}


@router.post('/activate')
async def activate(body: ActivateBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = _human(request)
    loaded = await _load(db, body.workspace)
    if not loaded.ok:
        raise HTTPException(status_code=422, detail={'code': 'invalid_definition', 'message': 'The definition is not valid; the active version is unchanged.',
                                                     'errors': [i.as_dict() for i in loaded.issues if i.severity == 'error']})
    if loaded.hash != body.expected_hash:
        raise HTTPException(status_code=409, detail={'code': 'changed_since_review', 'message': 'The definition changed after you reviewed it; review it again.'})
    try:
        row = await versions.activate(db, loaded.definition, loaded.hash, actor, mode=body.mode, percent=body.percent, label=body.label)
    except FactoryError as exc:
        raise _http(exc) from None
    return _version_json(row)


async def _simple(action, body: FactoryBody, request: Request, db: AsyncSession):
    actor = _human(request)
    try:
        return _version_json(await action(db, body.factory_id, actor))
    except FactoryError as exc:
        raise _http(exc) from None


@router.post('/promote')
async def promote(body: FactoryBody, request: Request, db: AsyncSession = Depends(get_db)):
    return await _simple(versions.promote, body, request, db)


@router.post('/abort')
async def abort(body: FactoryBody, request: Request, db: AsyncSession = Depends(get_db)):
    return await _simple(versions.abort, body, request, db)


@router.post('/rollback')
async def rollback(body: FactoryBody, request: Request, db: AsyncSession = Depends(get_db)):
    actor = _human(request)
    try:
        return _version_json(await versions.rollback(db, body.factory_id, actor, body.to))
    except FactoryError as exc:
        raise _http(exc) from None
