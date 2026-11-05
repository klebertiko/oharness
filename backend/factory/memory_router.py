"""`/factory/memory` routes (ADR 0054). A person writes, edits, reviews and clears notes; an agent can only add its own (marked unreviewed)."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from factory import memory
from factory.auth import actor_for
from factory.orm import AgentMemory
from factory.service import FactoryError

router = APIRouter(prefix='/factory/memory', tags=['factory'])
ID = r'^[a-z0-9][a-z0-9-]{0,62}$'


class NoteBody(BaseModel):
    factory_id: str = Field(pattern=ID)
    agent_id: str = Field(pattern=ID)
    text: str = Field(max_length=5000)  # the real limit is the one of the agent, checked with a clear reason
    pinned: bool = False
    source_run_id: str | None = Field(default=None, max_length=200)


class NotePatch(BaseModel):
    text: str | None = Field(default=None, max_length=5000)
    pinned: bool | None = None
    reviewed: bool | None = None


def _json(n: AgentMemory) -> dict:
    return {'id': n.id, 'factory_id': n.factory_id, 'agent_id': n.agent_id, 'text': n.text, 'origin': n.origin, 'pinned': n.pinned,
            'reviewed': n.reviewed, 'source_run_id': n.source_run_id, 'created_at': n.created_at.isoformat() + 'Z', 'updated_at': n.updated_at.isoformat() + 'Z'}


def _http(exc: FactoryError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={'code': exc.code, 'message': exc.detail})


def _human(request: Request) -> None:
    if actor_for(request)[0] != 'human':
        raise HTTPException(status_code=403, detail={'code': 'human_only', 'message': 'Editing or clearing memory needs the human credential of the app.'})


@router.get('')
async def list_notes(factory_id: str, agent_id: str, db: AsyncSession = Depends(get_db)):
    return {'notes': [_json(n) for n in await memory.notes(db, factory_id, agent_id)]}


@router.post('', status_code=201)
async def add_note(body: NoteBody, request: Request, db: AsyncSession = Depends(get_db)):
    origin = 'human' if actor_for(request)[0] == 'human' else 'agent'
    try:
        return _json(await memory.add(db, body.factory_id, body.agent_id, body.text, origin=origin, pinned=body.pinned, source_run_id=body.source_run_id))
    except FactoryError as exc:
        raise _http(exc) from None


@router.patch('/{note_id}')
async def edit_note(note_id: str, body: NotePatch, request: Request, db: AsyncSession = Depends(get_db)):
    _human(request)
    try:
        return _json(await memory.update(db, note_id, text=body.text, pinned=body.pinned, reviewed=body.reviewed))
    except FactoryError as exc:
        raise _http(exc) from None


@router.delete('/{note_id}', status_code=204)
async def delete_note(note_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _human(request)
    try:
        await memory.remove(db, note_id)
    except FactoryError as exc:
        raise _http(exc) from None
    return Response(status_code=204)


@router.delete('')
async def clear_notes(factory_id: str, agent_id: str, request: Request, db: AsyncSession = Depends(get_db)):
    _human(request)
    return {'deleted': await memory.clear(db, factory_id, agent_id)}
