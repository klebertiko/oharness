"""Definition versions: activate, canary, promote, abort, rollback and routing of new work items (ADR 0056).

The log in `factory_versions` is the only state. A work item is fixed to the version it was born under (`factory_version`), so none of
this touches an item already in flight.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from factory.definition import canonical_json
from factory.orm import DefinitionVersion
from factory.service import FactoryError

CANARY_PERCENT_RANGE = (1, 50)


@dataclass(frozen=True)
class State:
    stable: DefinitionVersion | None
    canary: DefinitionVersion | None
    lineage: tuple[DefinitionVersion, ...] = ()  # stable versions, oldest first; a rollback goes to the one before the last


def in_canary(item_id: str, percent: int) -> bool:
    """Deterministic: the same item id always lands on the same side (a hash of the id, not a random draw)."""
    return int(hashlib.sha256(item_id.encode('utf-8')).hexdigest()[:8], 16) % 100 < percent


async def _log(db: AsyncSession, factory_id: str) -> list[DefinitionVersion]:
    return list(await db.scalars(select(DefinitionVersion).where(DefinitionVersion.factory_id == factory_id).order_by(DefinitionVersion.id)))


def fold(rows: list[DefinitionVersion]) -> State:
    lineage: list[DefinitionVersion] = []
    canary = None
    for row in rows:
        if row.kind in ('activate', 'promote'):
            lineage.append(row)
            canary = None
        elif row.kind == 'rollback':
            known = [i for i, v in enumerate(lineage) if v.hash == row.hash]
            lineage = lineage[:known[-1] + 1] if known else [*lineage, row]  # going back drops what was left behind
            lineage[-1] = row
            canary = None
        elif row.kind == 'canary':
            canary = row
        elif row.kind == 'abort':
            canary = None
    return State(lineage[-1] if lineage else None, canary, tuple(lineage))


async def state(db: AsyncSession, factory_id: str) -> State:
    return fold(await _log(db, factory_id))


async def version_for_new_item(db: AsyncSession, factory_id: str, item_id: str) -> str | None:
    current = await state(db, factory_id)
    if current.canary is not None and in_canary(item_id, current.canary.percent or 0):
        return current.canary.hash
    return current.stable.hash if current.stable else None


def _row(factory_id: str, definition: dict, hash_: str, kind: str, actor: str, previous: str | None, *, percent: int | None = None,
         label: str | None = None) -> DefinitionVersion:
    return DefinitionVersion(factory_id=factory_id, hash=hash_, definition_json=canonical_json(definition), kind=kind,
                             mode='canary' if kind == 'canary' else 'stable', percent=percent, label=label, previous_hash=previous,
                             activated_by=actor)


async def activate(db: AsyncSession, definition: dict, hash_: str, actor: str, *, mode: str = 'stable', percent: int | None = None,
                   label: str | None = None) -> DefinitionVersion:
    """`definition` must already be validated: the caller refuses an invalid one before it gets here."""
    factory_id = definition['name']
    current = await state(db, factory_id)
    if current.canary is not None:
        raise FactoryError('canary_active', 409, 'A canary is running: promote it or abort it first.')
    if current.stable is not None and current.stable.hash == hash_:
        raise FactoryError('unchanged', 409, 'This version is already the active one.')
    if mode == 'canary':
        if current.stable is None:
            raise FactoryError('no_stable', 409, 'A canary needs an active version to compare against.')
        low, high = CANARY_PERCENT_RANGE
        if percent is None or not low <= percent <= high:
            raise FactoryError('invalid_percent', 422, f'percent must be between {low} and {high}.')
        row = _row(factory_id, definition, hash_, 'canary', actor, current.stable.hash, percent=percent, label=label)
    else:
        row = _row(factory_id, definition, hash_, 'activate', actor, current.stable.hash if current.stable else None, label=label)
    db.add(row)
    await db.commit()
    return row


async def promote(db: AsyncSession, factory_id: str, actor: str) -> DefinitionVersion:
    current = await state(db, factory_id)
    if current.canary is None:
        raise FactoryError('no_canary', 409, 'There is no canary to promote.')
    row = _row(factory_id, json.loads(current.canary.definition_json), current.canary.hash, 'promote', actor,
               current.stable.hash if current.stable else None)
    db.add(row)
    await db.commit()
    return row


async def abort(db: AsyncSession, factory_id: str, actor: str) -> DefinitionVersion:
    current = await state(db, factory_id)
    if current.canary is None or current.stable is None:
        raise FactoryError('no_canary', 409, 'There is no canary to abort.')
    row = _row(factory_id, json.loads(current.stable.definition_json), current.stable.hash, 'abort', actor, current.stable.hash)
    db.add(row)
    await db.commit()
    return row


async def rollback(db: AsyncSession, factory_id: str, actor: str, to: str | None = None) -> DefinitionVersion:
    current = await state(db, factory_id)
    if current.canary is not None:
        raise FactoryError('canary_active', 409, 'A canary is running: abort it first.')
    if current.stable is None:
        raise FactoryError('no_stable', 409, 'No version is active yet.')
    if to is None:
        if len(current.lineage) < 2:
            raise FactoryError('nothing_to_roll_back', 409, 'This is the first version: there is nothing to go back to.')
        target = current.lineage[-2]
    else:
        # only a version that was once the stable one: a canary that was aborted never earned that
        target = next((v for v in reversed(current.lineage) if v.hash == to), None)
        if target is None:
            raise FactoryError('unknown_version', 404, 'No such version among the ones that were active.')
    if target.hash == current.stable.hash:
        raise FactoryError('unchanged', 409, 'This version is already the active one.')
    row = _row(factory_id, json.loads(target.definition_json), target.hash, 'rollback', actor, current.stable.hash)
    db.add(row)
    await db.commit()
    return row


async def snapshot(db: AsyncSession, factory_id: str, hash_: str) -> DefinitionVersion:
    found = await db.scalar(select(DefinitionVersion).where(DefinitionVersion.factory_id == factory_id, DefinitionVersion.hash == hash_)
                            .order_by(DefinitionVersion.id).limit(1))
    if found is None:
        raise FactoryError('unknown_version', 404, 'No such version for this factory.')
    return found


async def history(db: AsyncSession, factory_id: str) -> list[DefinitionVersion]:
    return await _log(db, factory_id)
