"""The Flow switch's global default: one row, off until someone turns it on (ADR 0065)."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from models import FlowConfig

_ROW_ID = "global"


async def get_enabled(db: AsyncSession) -> bool:
    row = await db.get(FlowConfig, _ROW_ID)
    return bool(row.enabled) if row else False


async def set_enabled(db: AsyncSession, enabled: bool) -> bool:
    row = await db.get(FlowConfig, _ROW_ID)
    if row is None:
        row = FlowConfig(id=_ROW_ID)
        db.add(row)
    row.enabled = enabled
    await db.commit()
    return enabled


def resolve_flow_switch(run_setting: bool | None, default: bool) -> bool:
    """A run's own setting wins; `None` means "use the global default"."""
    return default if run_setting is None else run_setting
