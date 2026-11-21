"""`/nilo/memory`. A person writes, edits and forgets. A proposal is the only write Nilo can make."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from nilo import memory
from nilo.memory import MemoryError

router = APIRouter(prefix="/nilo/memory", tags=["nilo"])


class MemoryBody(BaseModel):
    kind: str
    scope: str
    text: str = Field(max_length=4000)
    pinned: bool = False


class ProposalBody(BaseModel):
    kind: str
    scope: str
    text: str = Field(max_length=4000)
    source_thread_id: str | None = None


class MemoryPatch(BaseModel):
    text: str | None = Field(default=None, max_length=4000)
    pinned: bool | None = None
    status: str | None = None


def _http(exc: MemoryError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={"code": exc.code})


@router.get("")
async def list_memories(scope: str | None = None, kind: str | None = None, db: AsyncSession = Depends(get_db)):
    return await memory.list_items(db, scope=scope, kind=kind)


@router.get("/export")
async def export_memories(db: AsyncSession = Depends(get_db)):
    return {"items": await memory.list_items(db)}


@router.post("", status_code=201)
async def add_memory(body: MemoryBody, db: AsyncSession = Depends(get_db)):
    try:
        return await memory.create(db, kind=body.kind, scope=body.scope, text=body.text, pinned=body.pinned)
    except MemoryError as exc:
        raise _http(exc) from None


@router.post("/proposals", status_code=201)
async def propose_memory(body: ProposalBody, db: AsyncSession = Depends(get_db)):
    try:
        return await memory.propose(db, kind=body.kind, scope=body.scope, text=body.text, source_thread_id=body.source_thread_id)
    except MemoryError as exc:
        raise _http(exc) from None


@router.patch("/{item_id}")
async def edit_memory(item_id: str, body: MemoryPatch, db: AsyncSession = Depends(get_db)):
    try:
        return await memory.update(db, item_id, text=body.text, pinned=body.pinned, status=body.status)
    except MemoryError as exc:
        raise _http(exc) from None


@router.delete("/{item_id}", status_code=204)
async def forget_memory(item_id: str, db: AsyncSession = Depends(get_db)):
    try:
        await memory.remove(db, item_id)
    except MemoryError as exc:
        raise _http(exc) from None
    return Response(status_code=204)


@router.delete("")
async def forget_everything(all: bool = Query(False), confirm: str | None = None, db: AsyncSession = Depends(get_db)):
    if not all:
        raise HTTPException(status_code=422, detail={"code": "nilo.memory.error.confirm"})
    try:
        return {"deleted": await memory.forget_all(db, confirm)}
    except MemoryError as exc:
        raise _http(exc) from None
