"""Drafts a person can edit, discard, or send. The model can only draft.

Sending needs one human decision bound to the hash of the content and the
destination. Editing invalidates that decision. Until a connector exists, the
only destination is the clipboard.
"""
from __future__ import annotations

import hashlib
import json
import uuid
from typing import Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from nilo.orm import NiloDraft
from run_store import redact_value

CLIPBOARD = "clipboard"
DRAFT_TOOL = {
    "type": "function",
    "function": {
        "name": "draft_message",
        "description": "Prepare a message for the person to review. It is not sent.",
        "parameters": {
            "type": "object",
            "properties": {
                "target": {"type": "string"},
                "subject": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["body"],
        },
    },
}


class DraftError(Exception):
    def __init__(self, code: str, status: int) -> None:
        self.code = code
        self.status = status


class OutboundPort(Protocol):
    """A connector sends only after a person has approved this exact draft."""

    async def send(self, draft: dict, approval: dict) -> None: ...


def content_hash(connector: str, address: str, subject: str, body: str) -> str:
    raw = "\n".join([connector, address, subject, body])
    return hashlib.sha256(raw.encode()).hexdigest()


def _clean(text: str) -> str:
    return redact_value(text or "")


def _public(row: NiloDraft) -> dict:
    return {
        "id": row.id,
        "target": {"connector": row.connector, "address": row.address},
        "subject": row.subject,
        "body": row.body,
        "hash": row.content_hash,
        "approval_id": None if row.approval_used else row.approval_id,
        "origin": json.loads(row.origin_json or "{}"),
    }


def _check_target(connector: str, address: str) -> None:
    if connector != CLIPBOARD or address != "local":
        raise DraftError("nilo.drafts.error.destination", 422)


async def create(db: AsyncSession, *, connector: str, address: str, subject: str, body: str, origin: dict | None = None) -> dict:
    _check_target(connector, address)
    clean_body = _clean(body)
    clean_subject = _clean(subject)
    if not clean_body.strip():
        raise DraftError("nilo.drafts.error.empty", 422)
    row = NiloDraft(
        connector=connector,
        address=address,
        subject=clean_subject,
        body=clean_body,
        content_hash=content_hash(connector, address, clean_subject, clean_body),
        origin_json=json.dumps(origin or {}),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return _public(row)


async def update(db: AsyncSession, draft_id: str, *, subject: str | None = None, body: str | None = None) -> dict:
    row = await db.get(NiloDraft, draft_id)
    if row is None:
        raise DraftError("nilo.drafts.error.notFound", 404)
    if subject is not None:
        row.subject = _clean(subject)
    if body is not None:
        row.body = _clean(body)
    row.content_hash = content_hash(row.connector, row.address, row.subject, row.body)
    row.approval_id = None
    row.approval_hash = None
    row.approval_used = False
    await db.commit()
    await db.refresh(row)
    return _public(row)


async def approve(db: AsyncSession, draft_id: str) -> dict:
    row = await db.get(NiloDraft, draft_id)
    if row is None:
        raise DraftError("nilo.drafts.error.notFound", 404)
    row.approval_id = uuid.uuid4().hex
    row.approval_hash = row.content_hash
    row.approval_used = False
    await db.commit()
    await db.refresh(row)
    return {"approval_id": row.approval_id, "hash": row.content_hash}


async def send(db: AsyncSession, draft_id: str, approval_id: str | None, port: OutboundPort | None = None) -> dict:
    row = await db.get(NiloDraft, draft_id)
    if row is None:
        raise DraftError("nilo.drafts.error.notFound", 404)
    if not approval_id or approval_id != row.approval_id or row.approval_used or row.approval_hash != row.content_hash:
        raise DraftError("nilo.drafts.error.approval", 409)
    approval = {"approval_id": approval_id, "hash": row.content_hash}
    if port is not None:
        await port.send(_public(row), approval)
    row.approval_used = True
    await db.commit()
    return {"sent": True, "destination": row.connector}


async def remove(db: AsyncSession, draft_id: str) -> None:
    row = await db.get(NiloDraft, draft_id)
    if row is None:
        raise DraftError("nilo.drafts.error.notFound", 404)
    await db.delete(row)
    await db.commit()


def routine_wants_to_send(body: str) -> dict:
    """A routine never sends. The attempt becomes a draft the person can send later."""
    return {"kind": "draft", "connector": CLIPBOARD, "address": "local", "body": body}
