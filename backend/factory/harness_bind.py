"""Binds an agent's engine to a harness that exists in the Studio.

The value is the harness id. A missing id refuses the run before a worktree is created. Nothing here reads or shows a file name.
"""
from __future__ import annotations

from factory.dispatch import DispatchError
from models import Harness


async def engine_id(db, agent: dict) -> str | None:
    engine = agent.get('engine')
    if not engine:
        return None
    row = await db.get(Harness, str(engine))
    if row is None:
        raise DispatchError('that engine is not in the Studio')
    return row.id
