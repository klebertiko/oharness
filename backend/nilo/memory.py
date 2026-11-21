"""Memories Nilo may use. A person writes one directly. Nilo only proposes.

Nothing is taken from a file, a tool result, or an event. A proposal stays out
of the prompt until the person activates it. A limit that would be exceeded
refuses the write and says why.
"""
from __future__ import annotations

import asyncio
import re

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from models import CoworkProject
from nilo.name_lock import FIXED_NAME_ERROR, rename_refusal
from nilo.orm import NiloMemory
from nilo.voice import MemoryBlock
from run_store import redact_value

KINDS = ("profile", "rule", "fact")
MAX_ITEMS = 300
MAX_CHARS = 600
MAX_INJECTED = 6_000
FORGET_PHRASE = "esquecer tudo"
REMEMBER_TOOL = {
    "type": "function",
    "function": {
        "name": "remember",
        "description": "Propose one memory. It is not kept until the person agrees.",
        "parameters": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": list(KINDS)},
                "text": {"type": "string"},
            },
            "required": ["kind", "text"],
        },
    },
}

_SCOPE = re.compile(r"^(global|workspace:[A-Za-z0-9_-]{1,64})$")
_BEARER = re.compile(r"[Bb]earer\s+[A-Za-z0-9._~+/=-]{16,}")
_URL_PASSWORD = re.compile(r"(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]{0,30}://[^\s/:@]+:[^\s/@]{3,}@")
_WRITES = asyncio.Lock()


class MemoryError(Exception):
    def __init__(self, code: str, status: int) -> None:
        self.code = code
        self.status = status


def proposal_from(source: str, text: str) -> dict | None:
    """A proposal may come only from the person's own message, never from a file or a tool."""
    if source != "user" or not (text or "").strip():
        return None
    return {"text": text}


def _clean(text: str) -> str:
    plain = "".join(char for char in " ".join(text.split()) if char.isprintable())
    for _ in range(2):
        plain = _URL_PASSWORD.sub("[redacted:credential]", _BEARER.sub("[redacted:credential]", redact_value(plain)))
    return plain


def _check(kind: str, scope: str, text: str) -> str:
    if kind not in KINDS:
        raise MemoryError("nilo.memory.error.badKind", 422)
    if not _SCOPE.fullmatch(scope or ""):
        raise MemoryError("nilo.memory.error.badScope", 422)
    if rename_refusal(text):
        raise MemoryError(FIXED_NAME_ERROR, 422)
    clean = _clean(text)
    if not clean.strip():
        raise MemoryError("nilo.memory.error.empty", 422)
    if len(clean) > MAX_CHARS:
        raise MemoryError("nilo.memory.error.tooLong", 422)
    if rename_refusal(clean):
        raise MemoryError(FIXED_NAME_ERROR, 422)
    return clean


async def _room(db: AsyncSession, adding: bool) -> None:
    count = await db.scalar(select(func.count()).select_from(NiloMemory))
    if adding and (count or 0) >= MAX_ITEMS:
        raise MemoryError("nilo.memory.error.tooMany", 409)


def _row(item: NiloMemory) -> dict:
    return {
        "id": item.id,
        "kind": item.kind,
        "scope": item.scope,
        "text": item.text,
        "origin": item.origin,
        "status": item.status,
        "pinned": bool(item.pinned),
        "source_thread_id": item.source_thread_id,
        "created_at": item.created_at.isoformat() + "Z",
        "updated_at": item.updated_at.isoformat() + "Z",
    }


async def create(db: AsyncSession, *, kind: str, scope: str, text: str, pinned: bool = False, origin: str = "user",
                 status: str = "active", source_thread_id: str | None = None) -> dict:
    clean = _check(kind, scope, text)
    async with _WRITES:
        await _room(db, True)
        item = NiloMemory(
            kind=kind, scope=scope, text=clean, origin=origin, status=status,
            pinned=bool(pinned) and origin == "user", source_thread_id=source_thread_id,
        )
        db.add(item)
        await db.commit()
        await db.refresh(item)
        return _row(item)


async def propose(db: AsyncSession, *, kind: str, scope: str, text: str, source_thread_id: str | None) -> dict:
    return await create(db, kind=kind, scope=scope, text=text, origin="nilo", status="proposed", source_thread_id=source_thread_id)


async def list_items(db: AsyncSession, *, scope: str | None = None, kind: str | None = None) -> list[dict]:
    query = select(NiloMemory).order_by(NiloMemory.pinned.desc(), NiloMemory.updated_at.desc())
    if scope:
        query = query.where(NiloMemory.scope == scope)
    if kind:
        query = query.where(NiloMemory.kind == kind)
    rows = await db.scalars(query)
    return [_row(item) for item in rows]


async def update(db: AsyncSession, item_id: str, *, text: str | None = None, pinned: bool | None = None, status: str | None = None) -> dict:
    item = await db.get(NiloMemory, item_id)
    if item is None:
        raise MemoryError("nilo.memory.error.notFound", 404)
    if status is not None and status != "active":
        raise MemoryError("nilo.memory.error.badStatus", 422)
    if text is not None:
        item.text = _check(item.kind, item.scope, text)
    if pinned is not None:
        item.pinned = bool(pinned)
    if status == "active":
        item.status = "active"
    await db.commit()
    await db.refresh(item)
    return _row(item)


async def remove(db: AsyncSession, item_id: str) -> None:
    item = await db.get(NiloMemory, item_id)
    if item is None:
        raise MemoryError("nilo.memory.error.notFound", 404)
    await db.delete(item)
    await db.commit()


async def forget_all(db: AsyncSession, confirm: str | None) -> int:
    if confirm != FORGET_PHRASE:
        raise MemoryError("nilo.memory.error.confirm", 422)
    count = await db.scalar(select(func.count()).select_from(NiloMemory)) or 0
    await db.execute(delete(NiloMemory))
    await db.commit()
    return int(count)


async def _workspace_scope(db: AsyncSession, cwd: str | None) -> str | None:
    if not cwd:
        return None
    project = await db.scalar(select(CoworkProject).where(CoworkProject.root_path == cwd))
    if project is None:
        return None
    return f"workspace:{project.id}"


def _ordered(rows: list[NiloMemory], workspace: str | None) -> list[NiloMemory]:
    def key(item: NiloMemory) -> tuple:
        return (
            0 if item.pinned else 1,
            0 if item.kind == "rule" else 1,
            0 if workspace and item.scope == workspace else 1,
            -item.updated_at.timestamp(),
        )
    return sorted(rows, key=key)


async def block_for(db: AsyncSession, cwd: str | None) -> MemoryBlock:
    """Active memories only. Rules are instructions. Profile and facts are data."""
    rows = list(await db.scalars(select(NiloMemory).where(NiloMemory.status == "active")))
    if not rows:
        return MemoryBlock()
    workspace = await _workspace_scope(db, cwd)
    chosen = [item for item in rows if item.scope == "global" or (workspace and item.scope == workspace)]
    rules: list[str] = []
    facts: list[str] = []
    used = 0
    for item in _ordered(chosen, workspace):
        line = item.text.strip()
        if not line:
            continue
        if used + len(line) > MAX_INJECTED:
            break
        used += len(line)
        if item.kind == "rule":
            rules.append(line)
        else:
            facts.append(f"{item.kind}: {line}")
    return MemoryBlock(rules="\n".join(rules), facts="\n".join(facts))
