"""`/factory/inbox` (ADR 0058): what waits for a person. Reading is open to the sidecar token; marking done by hand is the person's own."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import inbox
from factory.auth import actor_for
from factory.service import FactoryError

router = APIRouter(prefix='/factory/inbox', tags=['factory'])


def _human(request: Request) -> None:
    if actor_for(request)[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'The inbox is a personal queue: it needs the human credential of the app.'})


@router.get('')
async def get_inbox(factory_id: str | None = None, include_info: bool = False, include_resolved: bool = False, db: AsyncSession = Depends(get_db)):
    found = await inbox.entries(db, factory_id, include_info=include_info, include_resolved=include_resolved)
    return {'entries': found, 'count': sum(1 for e in found if not e['resolved'] and e['type'] != 'question_answered')}


@router.post('/{key}/resolve', status_code=204)
async def resolve(key: str, request: Request, db: AsyncSession = Depends(get_db)):
    _human(request)
    try:
        await inbox.resolve(db, key, actor_for(request))
    except FactoryError as exc:
        raise HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail}) from None
    return Response(status_code=204)


@router.delete('/{key}/resolve', status_code=204)
async def undo(key: str, request: Request, db: AsyncSession = Depends(get_db)):
    _human(request)
    await inbox.undo(db, key, actor_for(request))
    return Response(status_code=204)
