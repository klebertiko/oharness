"""Persistence of pre-tool hooks. A row that no longer validates is returned as an invalid (blocking) hook."""
import json

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from models import ToolHook
from .hooks import Hook, validate_hook


async def put_hook(db: AsyncSession, hook_id: str, body: dict) -> Hook:
    hook = validate_hook(hook_id, body)
    values = dict(argv_json=json.dumps(hook.argv), tools_json=json.dumps(list(hook.tools)), timeout_s=float(hook.timeout_s))
    for attempt in range(2):
        row = await db.get(ToolHook, hook.id)
        if row is None:
            db.add(ToolHook(id=hook.id, **values))
        else:
            for key, value in values.items():
                setattr(row, key, value)
        try:
            await db.commit()
            return hook
        except IntegrityError:  # a concurrent PUT created the row first: update it instead
            await db.rollback()
            if attempt:
                raise
    return hook


async def delete_hook(db: AsyncSession, hook_id: str) -> bool:
    result = await db.execute(delete(ToolHook).where(ToolHook.id == hook_id))
    await db.commit()
    return bool(result.rowcount)


async def load_hooks(db: AsyncSession) -> list[Hook]:
    hooks = []
    for row in (await db.scalars(select(ToolHook).order_by(ToolHook.created_at, ToolHook.id))).all():
        try:
            hooks.append(validate_hook(row.id, {'argv': json.loads(row.argv_json), 'tools': json.loads(row.tools_json),
                                                'timeout_s': row.timeout_s}))
        except (ValueError, TypeError):
            # Cannot be evaluated: block every tool rather than silently drop the gate.
            hooks.append(Hook(id=row.id, argv=[], timeout_s=1, tools=('exec', 'read', 'discover'), invalid=True))
    return hooks
