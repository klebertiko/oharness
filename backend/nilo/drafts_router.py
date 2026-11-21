"""`/nilo/drafts`. The model prepares. A person approves one exact version, then sends."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from nilo import drafts
from nilo.drafts import DraftError

router = APIRouter(prefix="/nilo/drafts", tags=["nilo"])


class Target(BaseModel):
    connector: str
    address: str


class DraftBody(BaseModel):
    target: Target
    subject: str = ""
    body: str = Field(min_length=1)
    origin: dict = Field(default_factory=dict)


class DraftPatch(BaseModel):
    subject: str | None = None
    body: str | None = None


class SendBody(BaseModel):
    approval_id: str | None = None


def _http(exc: DraftError) -> HTTPException:
    return HTTPException(status_code=exc.status, detail={"code": exc.code})


@router.post("", status_code=201)
async def create_draft(body: DraftBody, db: AsyncSession = Depends(get_db)):
    try:
        return await drafts.create(
            db, connector=body.target.connector, address=body.target.address,
            subject=body.subject, body=body.body, origin=body.origin,
        )
    except DraftError as exc:
        raise _http(exc) from None


@router.patch("/{draft_id}")
async def edit_draft(draft_id: str, body: DraftPatch, db: AsyncSession = Depends(get_db)):
    try:
        return await drafts.update(db, draft_id, subject=body.subject, body=body.body)
    except DraftError as exc:
        raise _http(exc) from None


@router.post("/{draft_id}/approve")
async def approve_draft(draft_id: str, db: AsyncSession = Depends(get_db)):
    try:
        return await drafts.approve(db, draft_id)
    except DraftError as exc:
        raise _http(exc) from None


@router.post("/{draft_id}/send")
async def send_draft(draft_id: str, body: SendBody, db: AsyncSession = Depends(get_db)):
    try:
        return await drafts.send(db, draft_id, body.approval_id)
    except DraftError as exc:
        raise _http(exc) from None


@router.delete("/{draft_id}", status_code=204)
async def discard_draft(draft_id: str, db: AsyncSession = Depends(get_db)):
    try:
        await drafts.remove(db, draft_id)
    except DraftError as exc:
        raise _http(exc) from None
    return Response(status_code=204)
