"""`/factory/runs`: the live runs, and the two things a person can do to one — stop it, or steer it."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated

import anyio
from fastapi import APIRouter, Depends, HTTPException, Path as PathParam, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import definition as definition_files
from factory import dispatch, loop, service
from factory.auth import actor_for

router = APIRouter(prefix='/factory', tags=['factory'])


RunId = Annotated[str, PathParam(pattern=r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')]
ItemId = Annotated[str, PathParam(pattern=r'^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$')]


class StartBody(BaseModel):
    model_config = {'extra': 'forbid'}
    repo: str = Field(min_length=1, max_length=4096)


class SteerBody(BaseModel):
    model_config = {'extra': 'forbid'}
    text: str = Field(min_length=1, max_length=2000)


def _human(request: Request) -> None:
    if actor_for(request)[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'Starting, stopping or steering a run needs the human credential of the app.'})


@router.get('/runs')
async def list_runs():
    return loop.snapshot()


# root path -> (stat of forja.yaml, the name it gave): the folder is loaded again only when that file changes.
_FORJA_NAMES: dict[str, tuple[tuple[int, int], str | None]] = {}


def _forja_of(root: str) -> str | None:
    """The name of the Forja a project folder defines, or None when it has no valid definition."""
    folder = Path(root) / '.oharness' / 'forja'
    try:
        stat = (folder / 'forja.yaml').stat()
    except OSError:
        _FORJA_NAMES.pop(root, None)
        return None
    signature = (stat.st_mtime_ns, stat.st_size)
    known = _FORJA_NAMES.get(root)
    if known and known[0] == signature:
        return known[1]
    try:
        loaded = definition_files.load(folder)
    except definition_files.DefinitionNotFound:
        loaded = None
    name = (loaded.definition or {}).get('name') if loaded is not None and loaded.ok else None
    _FORJA_NAMES[root] = (signature, name)
    return name


async def _repositories_for(db: AsyncSession, factory_id: str) -> list[dict]:
    """Registered projects whose definition is the one of this Forja: an item runs only in one of them."""
    from models import CoworkProject

    projects = list(await db.scalars(select(CoworkProject).order_by(CoworkProject.name)))

    def scan() -> list[dict]:
        return [{'id': project.id, 'name': project.name, 'root_path': project.root_path}
                for project in projects if _forja_of(project.root_path) == factory_id]
    return await anyio.to_thread.run_sync(scan)


@router.get('/work-items/{item_id}/repositories')
async def item_repositories(item_id: ItemId, request: Request, db: AsyncSession = Depends(get_db)):
    _human(request)  # it names folders on this machine
    try:
        item = await service.get(db, item_id)
    except service.FactoryError as exc:
        raise HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail}) from None
    return {'repositories': await _repositories_for(db, item.factory_id)}


@router.post('/work-items/{item_id}/run')
async def start_run(item_id: ItemId, body: StartBody, request: Request, db: AsyncSession = Depends(get_db)):
    from routers.execution import _validated_project_cwd

    _human(request)
    cwd = await _validated_project_cwd(db, body.repo)
    if cwd is None:
        raise HTTPException(status_code=404, detail={'code': 'unknown_workspace', 'message': 'The workspace is not a project registered in OHarness.'})
    try:
        item = await service.get(db, item_id)
    except service.FactoryError as exc:
        raise HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail})
    if cwd not in {str(Path(row['root_path']).resolve()) for row in await _repositories_for(db, item.factory_id)}:
        raise HTTPException(status_code=409, detail={'code': 'wrong_repository', 'message': "That project does not define this item's Forja."})
    definition = await service._definition_of(db, item)
    if not definition:
        raise HTTPException(status_code=409, detail={'code': 'no_definition', 'message': 'This item has no definition to run from.'})
    try:
        run_id = await loop.start(item.id, definition, Path(cwd), request.app.state.secrets_store)
    except dispatch.DispatchError as exc:
        raise HTTPException(status_code=409, detail={'code': 'cannot_run', 'message': str(exc)})
    row = loop.BOARD.get(run_id)
    return {'run_id': run_id, 'status': row.status if row else 'error'}


@router.post('/runs/{run_id}/stop')
async def stop_run(run_id: RunId, request: Request):
    _human(request)
    try:
        loop.stop(run_id)
    except loop.TooLate:
        raise HTTPException(status_code=409, detail={'code': 'too_late', 'message': 'The run is already finishing its stage; it can no longer be stopped.'}) from None
    except KeyError:
        raise HTTPException(status_code=404, detail={'code': 'no_such_run', 'message': 'That run is not going.'})
    return Response(status_code=204)


@router.post('/runs/{run_id}/steer')
async def steer_run(run_id: RunId, body: SteerBody, request: Request):
    _human(request)
    try:
        loop.steer(run_id, body.text)
    except loop.TooLate:
        raise HTTPException(status_code=409, detail={'code': 'too_late', 'message': 'The run is already finishing its stage; it no longer reads messages.'}) from None
    except KeyError:
        raise HTTPException(status_code=404, detail={'code': 'no_such_run', 'message': 'That run is not going.'})
    except loop.SteeringFull:
        raise HTTPException(status_code=429, detail={'code': 'steering_full', 'message': 'The run has not read the earlier messages yet.'})
    except ValueError:
        raise HTTPException(status_code=422, detail={'code': 'looks_secret', 'message': 'A message to a run never carries a credential.'})
    return {'accepted': True}
