"""`/factory/secrets` (ADR 0057): a person creates, replaces and deletes Forja secrets; the list shows names and dates. No route returns a value."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory.auth import actor_for
from factory.runner import MIN_SECRET_LENGTH
from factory.secrets_orm import SecretIndex

router = APIRouter(prefix='/factory/secrets', tags=['factory'])
NAME = r'^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$'
MAX_VALUE_CHARS = 8192
MIN_VALUE_CHARS = MIN_SECRET_LENGTH


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
async def put_secret(request: Request, name: str = Path(pattern=NAME), db: AsyncSession = Depends(get_db)):
    _human(request)
    try:  # parsed by hand: a validation error from the framework would echo the value back
        value = (await request.json()).get('value')
    except (ValueError, AttributeError):
        value = None
    if not isinstance(value, str) or not MIN_VALUE_CHARS <= len(value) <= MAX_VALUE_CHARS:  # a shorter value could not be removed from output
        raise HTTPException(status_code=422, detail={'code': 'invalid_value', 'message': f'The value must be text of {MIN_VALUE_CHARS} to {MAX_VALUE_CHARS} characters.'})
    _store(request).put(f'forja/{name}', value)
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
