"""`/factory/secrets` (ADR 0057): a person creates, replaces and deletes Forja secrets; the list shows names and dates. No route returns a value."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory.auth import actor_for
from factory.secrets_orm import SecretIndex

router = APIRouter(prefix='/factory/secrets', tags=['factory'])
NAME = r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'
MAX_VALUE_CHARS = 8192


class SecretBody(BaseModel):
    value: str = Field(min_length=1, max_length=MAX_VALUE_CHARS)


def _human(request: Request) -> None:
    if actor_for(request)[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'Secrets are managed with the human credential of the app.'})


def _store(request: Request):
    return request.app.state.secrets_store


@router.get('')
async def list_secrets(db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(SecretIndex).order_by(SecretIndex.name))
    return {'secrets': [{'name': r.name, 'reference': f'forja/{r.name}', 'updated_at': r.updated_at.isoformat() + 'Z'} for r in rows]}


@router.put('/{name}')
async def put_secret(request: Request, body: SecretBody, name: str = Path(pattern=NAME), db: AsyncSession = Depends(get_db)):
    _human(request)
    _store(request).put(f'forja/{name}', body.value)
    row = await db.get(SecretIndex, name)
    if row is None:
        db.add(SecretIndex(name=name))
    else:
        row.updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await db.commit()
    return {'name': name, 'reference': f'forja/{name}'}


@router.delete('/{name}', status_code=204)
async def delete_secret(request: Request, name: str = Path(pattern=NAME), db: AsyncSession = Depends(get_db)):
    _human(request)
    _store(request).delete(f'forja/{name}')
    row = await db.get(SecretIndex, name)
    if row is not None:
        await db.delete(row)
        await db.commit()
    return Response(status_code=204)
