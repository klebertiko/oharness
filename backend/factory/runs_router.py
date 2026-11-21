"""`/factory/runs`: the live runs, and the two things a person can do to one — stop it, or steer it."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import dispatch, loop, service
from factory.auth import actor_for

router = APIRouter(prefix='/factory', tags=['factory'])


class StartBody(BaseModel):
    repo: str = Field(min_length=1, max_length=4096)


class SteerBody(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


def _human(request: Request) -> None:
    if actor_for(request)[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'Starting, stopping or steering a run needs the human credential of the app.'})


@router.get('/runs')
async def list_runs():
    return loop.snapshot()


@router.post('/work-items/{item_id}/run')
async def start_run(item_id: str, body: StartBody, request: Request, db: AsyncSession = Depends(get_db)):
    from routers.execution import _validated_project_cwd

    _human(request)
    cwd = await _validated_project_cwd(db, body.repo)
    if cwd is None:
        raise HTTPException(status_code=404, detail={'code': 'unknown_workspace', 'message': 'The workspace is not a project registered in OHarness.'})
    try:
        item = await service.get(db, item_id)
    except service.FactoryError as exc:
        raise HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail})
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
async def stop_run(run_id: str, request: Request):
    _human(request)
    try:
        loop.stop(run_id)
    except KeyError:
        raise HTTPException(status_code=404, detail={'code': 'no_such_run', 'message': 'That run is not going.'})
    return Response(status_code=204)


@router.post('/runs/{run_id}/steer')
async def steer_run(run_id: str, body: SteerBody, request: Request):
    _human(request)
    try:
        loop.steer(run_id, body.text)
    except KeyError:
        raise HTTPException(status_code=404, detail={'code': 'no_such_run', 'message': 'That run is not going.'})
    return {'accepted': True}
